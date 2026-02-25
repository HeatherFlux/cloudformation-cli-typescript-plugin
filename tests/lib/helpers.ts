/**
 * Shared test helpers used across multiple test files.
 */
import type {
    Action,
    BaseModel,
    BaseResourceHandlerRequest,
    Dict,
    HandlerRequest,
} from '~/interface';
import type { SessionProxy, ProgressEvent } from '~/proxy';
import type {
    CloudWatchLogPublisher,
    LoggerProxy,
    S3LogHelper,
    S3LogPublisher,
} from '~/log-delivery';
import type { BaseResource } from '~/resource';

/**
 * Creates a Jest mock that resolves to `output` when called via `.send()`,
 * matching the AWS SDK v3 client pattern.
 *
 * @example
 * ```typescript
 * const mockSend = mockSendResult({ logStreams: [] });
 * (CloudWatchLogsClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));
 * ```
 */
export const mockSendResult = (output: any): jest.Mock => {
    return jest.fn().mockResolvedValue(output);
};

/**
 * Typed view of the protected internals of `BaseResource`, used in tests
 * instead of untyped bracket notation (`resource['field']`).
 *
 * Only fields/methods that are `protected` in `BaseResource` appear here.
 * Access via `asTestable(resource).field`.
 */
export interface ResourceInternals<
    T extends BaseModel = BaseModel,
    TypeConfiguration extends BaseModel = BaseModel,
> {
    loggerProxy: LoggerProxy;
    platformLoggerProxy: LoggerProxy;
    providerEventsLogger: CloudWatchLogPublisher | S3LogPublisher | null;
    s3LogHelper: S3LogHelper;
    invokeHandler(
        session: SessionProxy | null | undefined,
        request: BaseResourceHandlerRequest<T>,
        action: Action,
        callbackContext: Dict,
        typeConfiguration?: TypeConfiguration
    ): Promise<ProgressEvent<T>>;
    parseTestRequest(eventData: Dict): [BaseResourceHandlerRequest<T>, Action, Dict];
    castResourceRequest(request: HandlerRequest): BaseResourceHandlerRequest<T>;
    publishExceptionMetric(action: Action, err: Error): Promise<void>;
}

/**
 * Returns a typed view of the protected internals of a `BaseResource` instance.
 *
 * Centralises the type-safety escape hatch so that individual tests never
 * need their own `as any` casts or untyped bracket notation.
 *
 * @example
 * ```typescript
 * const r = asTestable(resource);
 * await r.invokeHandler(null, request, Action.Create, {});
 * expect(r.providerEventsLogger).toBeInstanceOf(S3LogPublisher);
 * ```
 */
export function asTestable<
    T extends BaseModel = BaseModel,
    TypeConfiguration extends BaseModel = BaseModel,
>(
    resource: BaseResource<T, TypeConfiguration>
): ResourceInternals<T, TypeConfiguration> {
    return resource as unknown as ResourceInternals<T, TypeConfiguration>;
}
