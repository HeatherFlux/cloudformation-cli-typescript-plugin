import { formatWithOptions, InspectOptions } from 'util';
import {
    CloudWatchLogsClient,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    DescribeLogGroupsCommand,
    DescribeLogStreamsCommand,
    InputLogEvent,
    LogStream,
    PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
    S3Client,
    CreateBucketCommand,
    ListObjectsV2Command,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

import { ClientConfig, SessionProxy } from './proxy';
import { MetricsPublisherProxy } from './metrics';
import { delay, ProgressTracker, Queue } from './utils';

type Console = globalThis.Console;
export type LambdaLogger = Partial<Console>;

export interface Logger {
    /**
     * Log a message to the default provider on this runtime.
     *
     * @param message        - The primary message.
     * @param optionalParams - Additional substitution values.
     */
    log(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface LogFilter {
    /** Scrub or redact `rawInput` before it is written to any log destination. */
    applyFilter(rawInput: string): string;
}

/**
 * Signals that the failed log-publish operation should be retried by `LoggerProxy`.
 *
 * `CloudWatchLogPublisher` throws this instead of mutating a property on the caught
 * error, keeping retry intent explicit and type-safe.
 */
export class RetryableLogError extends Error {
    /** Always `true` — used by `LoggerProxy` to trigger a single retry attempt. */
    readonly retryable = true;

    constructor(message: string) {
        super(message);
        this.name = 'RetryableLogError';
    }
}

/**
 * Base class for all log publishers.
 *
 * Subclasses implement `publishMessage` to write to a specific destination
 * (Lambda stdout, CloudWatch Logs, S3).  Filters registered via `addFilter`
 * are applied to every message before it reaches the destination.
 */
export abstract class LogPublisher {
    private logFilters: LogFilter[];

    constructor(...filters: readonly LogFilter[]) {
        this.logFilters = Array.from(filters);
    }

    protected abstract publishMessage(message: string, eventTime?: Date): Promise<void>;

    /**
     * Apply all registered filters to `message`, then write to the destination.
     */
    private filterMessage(message: string): string {
        let toReturn: string = message;
        this.logFilters.forEach((filter: LogFilter) => {
            toReturn = filter.applyFilter(toReturn);
        });
        return toReturn;
    }

    /** Register an additional `LogFilter` for this publisher. */
    public addFilter(filter: LogFilter): void {
        if (filter) {
            this.logFilters.push(filter);
        }
    }

    /** Filter then publish `message` with the given timestamp (defaults to now). */
    public async publishLogEvent(message: string, eventTime?: Date): Promise<void> {
        if (!eventTime) {
            eventTime = new Date();
        }
        await this.publishMessage(this.filterMessage(message), eventTime);
    }
}

/**
 * Writes log events to stdout via the provided `LambdaLogger` (typically `console`).
 *
 * This is the last-resort fallback used when CloudWatch / S3 delivery fails.
 */
export class LambdaLogPublisher extends LogPublisher {
    constructor(
        private readonly logger: LambdaLogger,
        ...logFilters: readonly LogFilter[]
    ) {
        super(...logFilters);
    }

    protected async publishMessage(message: string): Promise<void> {
        return Promise.resolve(this.logger.log?.('%s\n', message));
    }
}

/**
 * Publishes log events to a CloudWatch Logs log stream.
 *
 * Required IAM permissions:
 * - `logs:DescribeLogStreams`
 * - `logs:PutLogEvents`
 *
 * Handles sequence-token management automatically, retrying once on
 * `InvalidSequenceTokenException` and `DataAlreadyAcceptedException`.
 * On retryable errors it throws a `RetryableLogError` so that `LoggerProxy`
 * can attempt a single re-delivery.
 */
export class CloudWatchLogPublisher extends LogPublisher {
    private client: CloudWatchLogsClient;
    private queue = new Queue<void>();

    // CloudWatch Logs requires the same sequence token in each consecutive
    // PutLogEvents call for a given (log group, log stream) pair.
    // Ref: https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html
    private nextSequenceToken: string | null = null;

    constructor(
        private readonly session: SessionProxy,
        private readonly logGroupName: string,
        private readonly logStreamName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy,
        ...logFilters: readonly LogFilter[]
    ) {
        super(...logFilters);
    }

    /** (Re-)create the underlying CloudWatch Logs client with the given options. */
    public refreshClient(options?: ClientConfig): void {
        this.client = this.session.client(CloudWatchLogsClient, options);
    }

    protected async publishMessage(message: string, eventTime: Date): Promise<void> {
        if (this.skipLogging()) {
            return;
        }
        if (!this.client) {
            throw new Error(
                'CloudWatchLogs client was not initialized. You must call refreshClient() first.'
            );
        }
        return await this.queue.enqueue(async () => {
            const record: InputLogEvent = {
                message,
                timestamp: Math.round(eventTime.getTime()),
            };
            try {
                this.nextSequenceToken = await this.putLogEvents(
                    record,
                    this.nextSequenceToken
                );
                return;
            } catch (err) {
                if (err instanceof Error) {
                    const errorCode = err.name;
                    this.platformLogger.log(
                        `Error from "putLogEvents" with sequence token ${this.nextSequenceToken}`,
                        JSON.stringify(err)
                    );
                    if (
                        errorCode === 'DataAlreadyAcceptedException' ||
                        errorCode === 'InvalidSequenceTokenException' ||
                        errorCode === 'ThrottlingException'
                    ) {
                        await delay(0.25);
                        const result = (err.message || '').match(
                            /sequencetoken( is)?: (.+)/i
                        );
                        if (result?.length === 3 && result[2]) {
                            this.nextSequenceToken = result[2];
                        } else {
                            await this.populateSequenceToken();
                        }
                        await this.emitMetricsForLoggingFailure(err);
                        throw new RetryableLogError(
                            `Publishing this log event should be retried. ${err.message}`
                        );
                    } else {
                        this.platformLogger.log(
                            `An error occurred while putting log events [${message}] to resource owner account, with error: ${err.toString()}`
                        );
                    }
                }
                throw err;
            }
        });
    }

    private async putLogEvents(
        record: InputLogEvent,
        sequenceToken: string | null = null
    ): Promise<string | null> {
        // Delay to avoid throttling
        await delay(0.25);
        const response = await this.client.send(
            new PutLogEventsCommand({
                logGroupName: this.logGroupName,
                logStreamName: this.logStreamName,
                logEvents: [record],
                // sequenceToken is deprecated in newer CloudWatch Logs API versions
                // but still accepted for backward compatibility
                ...(sequenceToken ? { sequenceToken } : {}),
            })
        );
        this.platformLogger.log('Response from "putLogEvents"', response);
        if (response?.rejectedLogEventsInfo) {
            throw new Error(JSON.stringify(response.rejectedLogEventsInfo));
        }
        return response?.nextSequenceToken ?? null;
    }

    /** Fetch the current sequence token for this log stream from CloudWatch. */
    async populateSequenceToken(): Promise<string | null> {
        this.nextSequenceToken = null;
        try {
            const response = await this.client.send(
                new DescribeLogStreamsCommand({
                    logGroupName: this.logGroupName,
                    logStreamNamePrefix: this.logStreamName,
                    limit: 1,
                })
            );
            this.platformLogger.log('Response from "describeLogStreams"', response);
            if (response.logStreams?.length) {
                const logStream = response.logStreams[0] as LogStream;
                this.nextSequenceToken = logStream.uploadSequenceToken ?? null;
            }
        } catch (err) {
            this.platformLogger.log('Error from "describeLogStreams"', err);
        }
        return this.nextSequenceToken;
    }

    private skipLogging(): boolean {
        return !(this.logGroupName && this.logStreamName);
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(),
                err
            );
        }
    }
}

/**
 * Sets up a CloudWatch Logs log group and stream for resource providers.
 *
 * Required IAM permissions:
 * - `logs:CreateLogGroup`
 * - `logs:CreateLogStream`
 * - `logs:DescribeLogGroups`
 */
export class CloudWatchLogHelper {
    private client: CloudWatchLogsClient;

    constructor(
        private readonly session: SessionProxy,
        private logGroupName: string,
        private logStreamName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy
    ) {
        if (!this.logStreamName) {
            this.logStreamName = uuidv4();
        } else {
            this.logStreamName = logStreamName.replace(/:/g, '__');
        }
    }

    /** (Re-)create the underlying CloudWatch Logs client with the given options. */
    public refreshClient(options?: ClientConfig): void {
        this.client = this.session.client(CloudWatchLogsClient, options);
    }

    /**
     * Ensures the log group and stream exist, creating them if necessary.
     *
     * @returns The log stream name on success, or `null` if setup failed.
     */
    public async prepareLogStream(): Promise<string | null> {
        if (!this.client) {
            throw new Error(
                'CloudWatchLogs client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            if (!(await this.doesLogGroupExist())) {
                await this.createLogGroup();
            }
            return await this.createLogStream();
        } catch (err) {
            if (err instanceof Error) {
                this.log(
                    `Initializing logging group setting failed with error: ${err.toString()}`
                );
                await this.emitMetricsForLoggingFailure(err);
            }
        }
        return null;
    }

    private async doesLogGroupExist(): Promise<boolean> {
        let logGroupExists = false;
        try {
            const response = await this.client.send(
                new DescribeLogGroupsCommand({
                    logGroupNamePrefix: this.logGroupName,
                })
            );
            this.log('Response from "describeLogGroups"', response);
            if (response.logGroups?.length) {
                logGroupExists = response.logGroups.some((logGroup) => {
                    return logGroup.logGroupName === this.logGroupName;
                });
            }
        } catch (err) {
            if (err instanceof Error) {
                this.log(err);
                await this.emitMetricsForLoggingFailure(err);
            }
        }
        this.log(
            `Log group with name ${this.logGroupName} does${
                logGroupExists ? '' : ' not'
            } exist in resource owner account.`
        );
        return logGroupExists;
    }

    private async createLogGroup(): Promise<string> {
        try {
            this.log(`Creating Log group with name ${this.logGroupName}.`);
            const response = await this.client.send(
                new CreateLogGroupCommand({
                    logGroupName: this.logGroupName,
                })
            );
            this.log('Response from "createLogGroup"', response);
        } catch (err) {
            if (err instanceof Error && err.name !== 'ResourceAlreadyExistsException') {
                throw err;
            }
        }
        return this.logGroupName;
    }

    private async createLogStream(): Promise<string> {
        try {
            this.log(
                `Creating Log stream with name ${this.logStreamName} for log group ${this.logGroupName}.`
            );
            const response = await this.client.send(
                new CreateLogStreamCommand({
                    logGroupName: this.logGroupName,
                    logStreamName: this.logStreamName,
                })
            );
            this.log('Response from "createLogStream"', response);
        } catch (err) {
            if (err instanceof Error && err.name !== 'ResourceAlreadyExistsException') {
                throw err;
            }
        }
        return this.logStreamName;
    }

    private log(message?: unknown, ...optionalParams: unknown[]): void {
        if (this.platformLogger) {
            this.platformLogger.log(message, ...optionalParams);
        }
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(),
                err
            );
        }
    }
}

/**
 * Publishes log events to an S3 bucket as individual text files.
 *
 * Required IAM permissions:
 * - `s3:PutObject`
 */
export class S3LogPublisher extends LogPublisher {
    private client: S3Client;

    constructor(
        private readonly session: SessionProxy,
        private readonly bucketName: string,
        private readonly folderName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy,
        ...logFilters: readonly LogFilter[]
    ) {
        super(...logFilters);
    }

    /** (Re-)create the underlying S3 client with the given options. */
    public refreshClient(options?: ClientConfig): void {
        this.client = this.session.client(S3Client, options);
    }

    protected async publishMessage(message: string, eventTime: Date): Promise<void> {
        if (this.skipLogging()) {
            return;
        }
        if (!this.client) {
            throw new Error(
                'S3 client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            const timestamp = eventTime.toISOString().replace(/[^a-z0-9]/gi, '');
            const response = await this.client.send(
                new PutObjectCommand({
                    Bucket: this.bucketName,
                    Key: `${this.folderName}/${timestamp}-${Math.floor(
                        Math.random() * 100
                    )}.log`,
                    ContentType: 'text/plain',
                    Body: message,
                })
            );
            this.platformLogger.log('Response from "putObject"', response);
            return;
        } catch (err) {
            if (err instanceof Error) {
                this.platformLogger.log(
                    `An error occurred while putting log events [${message}] to resource owner account, with error: ${err.toString()}`
                );
                await this.emitMetricsForLoggingFailure(err);
                throw err;
            }
        }
    }

    private skipLogging(): boolean {
        return !(this.bucketName && this.folderName);
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(),
                err
            );
        }
    }
}

/**
 * Sets up an S3 bucket with a default folder for log delivery.
 *
 * Required IAM permissions:
 * - `s3:CreateBucket`
 * - `s3:GetObject`
 * - `s3:ListBucket`
 */
export class S3LogHelper {
    private client: S3Client;

    constructor(
        private readonly session: SessionProxy,
        private bucketName: string,
        private folderName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy
    ) {
        if (!this.folderName) {
            this.folderName = uuidv4();
        }
        this.folderName = this.folderName.replace(/[^a-z0-9!_'.*()/-]/gi, '_');
    }

    /** (Re-)create the underlying S3 client with the given options. */
    public refreshClient(options?: ClientConfig): void {
        this.client = this.session.client(S3Client, options);
    }

    /**
     * Ensures the S3 bucket and folder exist, creating them if necessary.
     *
     * @returns The folder name on success, or `null` if setup failed.
     */
    public async prepareFolder(): Promise<string | null> {
        if (!this.client) {
            throw new Error(
                'S3 client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            const folderExists = await this.doesFolderExist();
            if (folderExists === null) {
                await this.createBucket();
            }
            if (folderExists === true) {
                return this.folderName;
            } else {
                return await this.createFolder();
            }
        } catch (err) {
            if (err instanceof Error) {
                this.log(
                    `Initializing S3 bucket and folder failed with error: ${err.toString()}`
                );
                await this.emitMetricsForLoggingFailure(err);
            }
        }
        return null;
    }

    private async doesFolderExist(): Promise<boolean | null> {
        let folderExists = false;
        try {
            const response = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucketName,
                    Prefix: `${this.folderName}/`,
                })
            );
            this.log('Response from "listObjects"', response);
            if (response.Contents?.length) {
                folderExists = true;
            }
            this.log(
                `S3 folder with name ${this.folderName} does${
                    folderExists ? '' : ' not'
                } exist in bucket ${this.bucketName}.`
            );
            return folderExists;
        } catch (err) {
            if (err instanceof Error) {
                if (err.name === 'NoSuchBucket') {
                    this.log(
                        `S3 bucket with name ${this.bucketName} does not exist in resource owner account.`
                    );
                }
                this.log(err);
                await this.emitMetricsForLoggingFailure(err);
            }
            return null;
        }
    }

    private async createBucket(): Promise<string> {
        try {
            this.log(`Creating S3 bucket with name ${this.bucketName}.`);
            const response = await this.client.send(
                new CreateBucketCommand({
                    Bucket: this.bucketName,
                })
            );
            this.log('Response from "createBucket"', response);
        } catch (err) {
            if (
                err instanceof Error &&
                err.name !== 'BucketAlreadyOwnedByYou' &&
                err.name !== 'BucketAlreadyExists'
            ) {
                throw err;
            }
        }
        return this.bucketName;
    }

    private async createFolder(): Promise<string> {
        this.log(
            `Creating folder with name ${this.folderName} for bucket ${this.bucketName}.`
        );
        const response = await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucketName,
                Key: `${this.folderName}/`,
                ContentLength: 0,
            })
        );
        this.log('Response from "putObject"', response);
        return this.folderName;
    }

    private log(message?: unknown, ...optionalParams: unknown[]): void {
        if (this.platformLogger) {
            this.platformLogger.log(message, ...optionalParams);
        }
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(),
                err
            );
        }
    }
}

/**
 * Fan-out logger that dispatches to all registered `LogPublisher` instances.
 *
 * Tracks in-flight log deliveries via a `ProgressTracker` so that the Lambda
 * entrypoint can wait for all log events to be delivered before returning.
 *
 * A `fallbackLogger` (defaults to `console`) is used when all publishers fail.
 */
export class LoggerProxy implements Logger {
    private readonly logPublishers = new Array<LogPublisher>();
    readonly tracker = new ProgressTracker();
    private readonly inspectOptions: InspectOptions;
    private readonly fallbackLogger: Logger;

    constructor(defaultOptions: InspectOptions = {}, fallbackLogger: Logger = console) {
        // Allow passing Node.js inspect options,
        // and change default depth from 4 to 10
        this.inspectOptions = { depth: 10, ...defaultOptions };
        this.fallbackLogger = fallbackLogger;
    }

    /** Register a `LogPublisher` to receive future log events. */
    addLogPublisher(logPublisher: LogPublisher): void {
        if (logPublisher) {
            this.logPublishers.push(logPublisher);
        }
    }

    /** Apply `filter` to all currently registered publishers. Null/undefined filters are ignored. */
    addFilter(filter: LogFilter | null | undefined): void {
        if (!filter) return;
        this.logPublishers.forEach((logPublisher: LogPublisher) => {
            logPublisher.addFilter(filter);
        });
    }

    /** Number of currently registered log publishers. */
    get logPublisherCount(): number {
        return this.logPublishers.length;
    }

    /**
     * Mark the tracker as pending, preventing `waitCompletion` from resolving
     * until new deliveries are submitted and completed.
     */
    markPending(): void {
        this.tracker.done = false;
    }

    /** Wait for all in-flight log deliveries to complete or fail. */
    async waitCompletion(): Promise<boolean> {
        try {
            this.tracker.end();
            await this.tracker.waitCompletion();
        } catch (err) {
            this.fallbackLogger.log(err);
        }
        return true;
    }

    /**
     * Format and dispatch `message` to all registered publishers asynchronously.
     *
     * Each delivery is tracked; on a `RetryableLogError` a single re-delivery
     * attempt is made before marking the event as failed.
     */
    log(message?: unknown, ...optionalParams: unknown[]): void {
        const formatted = formatWithOptions(
            this.inspectOptions,
            message,
            ...optionalParams
        );
        const eventTime = new Date();
        for (const logPublisher of this.logPublishers) {
            this.tracker.addSubmitted();
            (async () => {
                try {
                    await logPublisher.publishLogEvent(formatted, eventTime);
                    this.tracker.addCompleted();
                } catch (err) {
                    if (err instanceof Error) {
                        // RetryableLogError means CloudWatch returned a sequence-token
                        // error; attempt a single re-delivery before giving up.
                        if ((err as RetryableLogError).retryable === true) {
                            try {
                                await logPublisher.publishLogEvent(
                                    formatted,
                                    eventTime
                                );
                                this.tracker.addCompleted();
                            } catch (retryErr) {
                                this.fallbackLogger.log(retryErr);
                                this.tracker.addFailed();
                            }
                        } else {
                            this.tracker.addFailed();
                        }
                    } else {
                        this.tracker.addFailed();
                    }
                }
            })();
        }
    }
}
