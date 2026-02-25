import {
    CloudWatchClient,
    Dimension,
    PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';

import { Logger } from './log-delivery';
import { ClientConfig, SessionProxy } from './proxy';
import { Action, MetricTypes, StandardUnit } from './interface';
import { BaseHandlerException } from './exceptions';

const METRIC_NAMESPACE_ROOT = 'AWS/CloudFormation';

export type DimensionRecord = Record<string, string>;

/**
 * Convert a `DimensionRecord` map into the array form that CloudWatch expects.
 *
 * @param dimensions - Key/value pairs where keys are dimension names
 * @returns CloudWatch `Dimension[]`
 */
export function formatDimensions(dimensions: DimensionRecord): Array<Dimension> {
    const formatted: Array<Dimension> = [];
    for (const key in dimensions) {
        const value = dimensions[key];
        const dimension: Dimension = {
            Name: key,
            Value: value,
        };
        formatted.push(dimension);
    }
    return formatted;
}

/**
 * Publishes CloudFormation resource provider metrics to CloudWatch.
 *
 * Metrics are published under the namespace
 * `AWS/CloudFormation/<ResourceType>` where `<ResourceType>` uses `/`
 * instead of `::` as the separator.
 *
 * Call `refreshClient()` after constructing to initialise the underlying
 * CloudWatch client before any publish methods are invoked.
 */
export class MetricsPublisher {
    private resourceNamespace: string;
    private client: CloudWatchClient;

    constructor(
        private readonly session: SessionProxy,
        private readonly logger: Logger,
        private readonly resourceType: string
    ) {
        this.resourceNamespace = resourceType.replace(/::/g, '/');
    }

    /** (Re-)create the underlying CloudWatch client with the given options. */
    public refreshClient(options?: ClientConfig): void {
        this.client = this.session.client(CloudWatchClient, options);
    }

    /**
     * Publish a single data point to CloudWatch.
     *
     * Throws on retryable errors (e.g. throttling) so the caller can decide
     * whether to retry.  Non-retryable errors are logged and swallowed.
     */
    async publishMetric(
        metricName: MetricTypes,
        dimensions: DimensionRecord,
        unit: StandardUnit,
        value: number,
        timestamp: Date
    ): Promise<void> {
        if (!this.client) {
            throw new Error(
                'CloudWatch client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            const response = await this.client.send(
                new PutMetricDataCommand({
                    Namespace: `${METRIC_NAMESPACE_ROOT}/${this.resourceNamespace}`,
                    MetricData: [
                        {
                            MetricName: metricName,
                            Dimensions: formatDimensions(dimensions),
                            Unit: unit,
                            Timestamp: timestamp,
                            Value: value,
                        },
                    ],
                })
            );
            this.log('Response from "putMetricData"', response);
        } catch (err) {
            if (err instanceof Error) {
                // Throttling and similar transient errors should propagate
                if (err.name === 'ThrottlingException' || err.name === 'RequestError') {
                    throw err;
                }
                this.log(`An error occurred while publishing metrics: ${err.message}`);
            }
        }
    }

    /**
     * Publish a `HandlerException` metric for an operation that threw `error`.
     */
    async publishExceptionMetric(
        timestamp: Date,
        action: Action,
        error: Error
    ): Promise<void> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyExceptionType:
                (error as BaseHandlerException).errorCode || error.constructor.name,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerException,
            dimensions,
            StandardUnit.Count,
            1.0,
            timestamp
        );
    }

    /**
     * Publish a `HandlerInvocationCount` metric for the given action.
     */
    async publishInvocationMetric(timestamp: Date, action: Action): Promise<void> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerInvocationCount,
            dimensions,
            StandardUnit.Count,
            1.0,
            timestamp
        );
    }

    /**
     * Publish a `HandlerInvocationDuration` metric for the given action.
     *
     * @param milliseconds - Wall-clock duration of the handler invocation
     */
    async publishDurationMetric(
        timestamp: Date,
        action: Action,
        milliseconds: number
    ): Promise<void> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerInvocationDuration,
            dimensions,
            StandardUnit.Milliseconds,
            milliseconds,
            timestamp
        );
    }

    /**
     * Publish a `HandlerException` metric specifically for log-delivery failures.
     *
     * Errors here are caught and logged rather than re-thrown to avoid masking
     * the original log-delivery failure.
     */
    async publishLogDeliveryExceptionMetric(
        timestamp: Date,
        error: Error
    ): Promise<void> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: 'ProviderLogDelivery',
            DimensionKeyExceptionType:
                (error as BaseHandlerException).errorCode || error.constructor.name,
            DimensionKeyResourceType: this.resourceType,
        };
        try {
            await this.publishMetric(
                MetricTypes.HandlerException,
                dimensions,
                StandardUnit.Count,
                1.0,
                timestamp
            );
        } catch (err) {
            this.log(err);
        }
    }

    private log(message?: any, ...optionalParams: any[]): void {
        if (this.logger) {
            this.logger.log(message, ...optionalParams);
        }
    }
}

/**
 * Dispatches metrics to all registered `MetricsPublisher` instances.
 *
 * The proxy pattern allows the runtime to add zero or more publishers
 * (e.g. one for provider-owned metrics) and call all of them with a
 * single method invocation.
 */
export class MetricsPublisherProxy {
    private publishers: Array<MetricsPublisher> = [];

    /** Add `metricsPublisher` to the list of targets. No-op if falsy. */
    addMetricsPublisher(metricsPublisher?: MetricsPublisher): void {
        if (metricsPublisher) {
            this.publishers.push(metricsPublisher);
        }
    }

    /** Publish an exception metric to all registered publishers. */
    async publishExceptionMetric(
        timestamp: Date,
        action: Action,
        error: Error
    ): Promise<void> {
        for (const publisher of this.publishers) {
            await publisher.publishExceptionMetric(timestamp, action, error);
        }
    }

    /** Publish an invocation count metric to all registered publishers. */
    async publishInvocationMetric(timestamp: Date, action: Action): Promise<void> {
        for (const publisher of this.publishers) {
            await publisher.publishInvocationMetric(timestamp, action);
        }
    }

    /** Publish an invocation duration metric to all registered publishers. */
    async publishDurationMetric(
        timestamp: Date,
        action: Action,
        milliseconds: number
    ): Promise<void> {
        for (const publisher of this.publishers) {
            await publisher.publishDurationMetric(timestamp, action, milliseconds);
        }
    }

    /** Publish a log delivery exception metric to all registered publishers. */
    async publishLogDeliveryExceptionMetric(
        timestamp: Date,
        error: Error
    ): Promise<void> {
        for (const publisher of this.publishers) {
            await publisher.publishLogDeliveryExceptionMetric(timestamp, error);
        }
    }
}
