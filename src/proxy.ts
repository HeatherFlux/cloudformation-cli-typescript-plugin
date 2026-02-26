import { AwsCredentialIdentity } from '@smithy/types';
import { builder, IBuilder } from '@org-formation/tombok';
import { Exclude, Expose } from 'class-transformer';

import {
    BaseDto,
    BaseResourceHandlerRequest,
    BaseModel,
    Dict,
    HandlerErrorCode,
    NextToken,
    OperationStatus,
} from './interface';

/**
 * Configuration options passed to AWS SDK v3 client constructors.
 * All AWS SDK v3 clients accept at minimum `credentials` and `region`.
 */
export interface ClientConfig {
    credentials?: AwsCredentialIdentity;
    region?: string;
    [key: string]: unknown;
}

/**
 * A session that vends pre-configured AWS SDK v3 clients.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 *
 * const s3 = session.client(S3Client);
 * await s3.send(new PutObjectCommand({ Bucket: '...', Key: '...', Body: '...' }));
 * ```
 */
export interface Session {
    /**
     * Creates a new AWS SDK v3 client, injecting the session credentials and region.
     *
     * @param ClientClass - An AWS SDK v3 client constructor (e.g. `S3Client`, `CloudWatchLogsClient`)
     * @param options     - Optional overrides merged on top of the session config
     * @returns A ready-to-use client instance
     */
    client<T>(ClientClass: new (config: ClientConfig) => T, options?: ClientConfig): T;
}

/**
 * Concrete implementation of `Session` that holds AWS credentials and region,
 * and uses them to instantiate AWS SDK v3 clients.
 *
 * Obtain an instance via `SessionProxy.getSession(credentials, region)`.
 */
export class SessionProxy implements Session {
    constructor(private readonly config: ClientConfig) {}

    /**
     * Creates an AWS SDK v3 client using the session credentials.
     *
     * @param ClientClass - An AWS SDK v3 client constructor
     * @param options     - Optional per-call overrides (e.g. a different region)
     */
    client<T>(ClientClass: new (config: ClientConfig) => T, options?: ClientConfig): T {
        return new ClientClass({ ...this.config, ...options });
    }

    /** Returns the raw config object (credentials + region) used by this session. */
    get configuration(): ClientConfig {
        return this.config;
    }

    /**
     * Factory method — returns `null` when no credentials are provided (unauthenticated path).
     *
     * @param credentials - AWS credential identity (accessKeyId + secretAccessKey + sessionToken)
     * @param region      - AWS region string, e.g. `'us-east-1'`
     */
    public static getSession(
        credentials?: AwsCredentialIdentity,
        region?: string
    ): SessionProxy | null {
        if (!credentials) {
            return null;
        }
        return new SessionProxy({ credentials, region });
    }
}

/**
 * Represents the result of a resource handler invocation.
 *
 * Use the static factory helpers instead of constructing directly:
 * - `ProgressEvent.success(model)` — terminal success
 * - `ProgressEvent.failed(errorCode, message)` — terminal failure
 * - `ProgressEvent.progress(model, ctx)` — in-progress, will be re-invoked
 */
@builder
export class ProgressEvent<
    ResourceT extends BaseModel = BaseModel,
    CallbackT = Dict,
> extends BaseDto {
    /**
     * Indicates whether the handler has reached a terminal state or is still
     * computing and requires more time to complete.
     */
    @Expose() status: OperationStatus;

    /**
     * If `OperationStatus` is `FAILED` or `IN_PROGRESS`, an error code should be
     * provided to give callers context about why the operation has not succeeded.
     */
    @Expose() errorCode?: HandlerErrorCode;

    /**
     * A human-readable message describing the current state of the operation.
     * Shown to callers in the CloudFormation console and API responses.
     */
    @Expose() message = '';

    /**
     * Arbitrary data the handler returns on an `IN_PROGRESS` response, which will
     * be passed back verbatim on the next invocation as `callbackContext`.
     * Use this to persist identifiers or polling state between retries.
     */
    @Expose() callbackContext?: CallbackT;

    /**
     * Minimum number of seconds to wait before the next callback.
     * Defaults to 0 (retry immediately).
     */
    @Expose() callbackDelaySeconds = 0;

    /**
     * The output resource instance populated by a READ handler, or by
     * CREATE/UPDATE/DELETE for final response validation/confirmation.
     */
    @Expose() resourceModel?: ResourceT;

    /**
     * Output resource instances populated by a LIST handler.
     */
    @Expose() resourceModels?: Array<ResourceT>;

    /**
     * Pagination token for LIST operations.
     * Pass this back to CloudFormation to request the next page.
     */
    @Expose() nextToken?: NextToken;

    constructor(partial?: Partial<ProgressEvent>) {
        super();
        if (partial) {
            Object.assign(this, partial);
        }
    }

    // TODO: remove workaround when decorator mutation implemented:
    // https://github.com/microsoft/TypeScript/issues/4881
    @Exclude()
    public static builder<T extends ProgressEvent>(
        _template?: Partial<T>
    ): IBuilder<T> | null {
        /* istanbul ignore next */
        return null;
    }

    /**
     * Constructs a terminal `FAILED` response.
     *
     * @param errorCode - A `HandlerErrorCode` describing the failure category
     * @param message   - Human-readable description of what went wrong
     */
    @Exclude()
    public static failed<T extends ProgressEvent>(
        errorCode: HandlerErrorCode,
        message: string
    ): T {
        const event = ProgressEvent.builder<T>()!
            .status(OperationStatus.Failed)
            .errorCode(errorCode)
            .message(message)
            .build();
        return event;
    }

    /**
     * Constructs an `IN_PROGRESS` response, optionally with a model and callback context.
     *
     * @param model - Optional partial resource model to return with the in-progress event
     * @param ctx   - Optional callback context persisted between invocations
     */
    @Exclude()
    public static progress<T extends ProgressEvent>(
        model?: BaseModel | null,
        ctx?: Dict | null
    ): T {
        const progress = ProgressEvent.builder<T>()!.status(OperationStatus.InProgress);
        if (ctx) {
            progress.callbackContext(ctx);
        }
        if (model) {
            progress.resourceModel(model);
        }
        const event = progress.build();
        return event;
    }

    /**
     * Constructs a terminal `SUCCESS` response.
     *
     * @param model - Optional resource model to return with the success event
     * @param ctx   - Optional callback context (rarely needed for terminal events)
     */
    @Exclude()
    public static success<T extends ProgressEvent>(
        model?: BaseModel | null,
        ctx?: Dict | null
    ): T {
        const event = ProgressEvent.progress<T>(model, ctx);
        event.status = OperationStatus.Success;
        return event;
    }
}

/**
 * The request object passed to every resource handler method.
 * Constructed by the runtime from the incoming CloudFormation event.
 *
 * @typeParam T - The resource model type
 */
export class ResourceHandlerRequest<
    T extends BaseModel,
> extends BaseResourceHandlerRequest<T> {}
