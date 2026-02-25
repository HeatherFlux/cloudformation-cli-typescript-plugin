import * as exceptions from '~/exceptions';
import { ProgressEvent, SessionProxy } from '~/proxy';
import {
    Action,
    BaseModel,
    BaseResourceHandlerRequest,
    HandlerErrorCode,
    HandlerRequest,
    OperationStatus,
} from '~/interface';
import {
    CloudWatchLogHelper,
    CloudWatchLogPublisher,
    LambdaLogPublisher,
    LoggerProxy,
    LogPublisher,
    S3LogHelper,
    S3LogPublisher,
} from '~/log-delivery';
import { MetricsPublisherProxy } from '~/metrics';
import { handlerEvent, HandlerSignatures, BaseResource } from '~/resource';
import { LambdaContext } from '~/interface';
import { SimpleStateModel } from '../data/sample-model';
import { asTestable } from './helpers';

// Minimal mock context - all usage in entrypoint/testEntrypoint uses optional chaining
const MOCK_CTX = {} as LambdaContext;

describe('when getting resource', () => {
    let entrypointPayload: any;
    let testEntrypointPayload: any;
    let lambdaContext: any;
    let spySession: jest.SpyInstance;
    let spySessionClient: jest.SpyInstance;
    let spyInitializeRuntime: jest.SpyInstance;
    const TYPE_NAME = 'Test::Foo::Bar';
    class MockModel extends SimpleStateModel {
        public static readonly TYPE_NAME: string = TYPE_NAME;
    }
    class Resource extends BaseResource<MockModel, MockTypeConfigurationModel> {
        /** Expose the protected static parseRequest for test assertions. */
        public static testParseRequest(eventData: any) {
            return BaseResource.parseRequest(eventData);
        }
    }

    class MockTypeConfigurationModel extends BaseModel {
        public static readonly TYPE_NAME: string = TYPE_NAME;
    }

    beforeEach(() => {
        entrypointPayload = {
            awsAccountId: '123456789012',
            bearerToken: 'e722ae60-fe62-11e8-9a0e-0ae8cc519968',
            region: 'us-east-1',
            action: 'CREATE',
            responseEndpoint: null,
            resourceType: 'AWS::Test::TestModel',
            resourceTypeVersion: '1.0',
            callbackContext: {},
            requestData: {
                callerCredentials: {
                    accessKeyId: 'IASAYK835GAIFHAHEI23',
                    secretAccessKey: '66iOGPN5LnpZorcLr8Kh25u8AbjHVllv5/poh2O0',
                    sessionToken:
                        'lameHS2vQOknSHWhdFYTxm2eJc1JMn9YBNI4nV4mXue945KPL6DHfW8EsUQT5zwssYEC1NvYP9yD6Y5s5lKR3chflOHPFsIe6eqg',
                },
                providerCredentials: {
                    accessKeyId: 'HDI0745692Y45IUTYR78',
                    secretAccessKey: '4976TUYVI234/5GW87ERYG823RF87GY9EIUH452I3',
                    sessionToken:
                        '842HYOFIQAEUDF78R8T7IU43HSADYGIFHBJSDHFA87SDF9PYvN1CEYASDUYFT5TQ97YASIHUDFAIUEYRISDKJHFAYSUDTFSDFADS',
                },
                providerLogGroupName: 'provider-logging-group-name',
                logicalResourceId: 'myBucket',
                resourceProperties: { state: 'state1' },
                previousResourceProperties: { state: 'state2' },
                stackTags: { tag1: 'abc' },
                previousStackTags: { tag1: 'def' },
                typeConfiguration: {
                    apiToken: 'fklwqrdmlsn',
                },
            },
            stackId:
                'arn:aws:cloudformation:us-east-1:123456789012:stack/sample-stack/e722ae60-fe62-11e8-9a0e-0ae8cc519968',
        };
        testEntrypointPayload = {
            credentials: {
                accessKeyId: '',
                secretAccessKey: '',
                sessionToken: '',
            },
            action: 'CREATE',
            request: {
                clientRequestToken: 'ecba020e-b2e6-4742-a7d0-8a06ae7c4b2b',
                desiredResourceState: { state: 'state1' },
                previousResourceState: { state: 'state2' },
                logicalResourceIdentifier: null,
            },
        };
        lambdaContext = {
            awsRequestId: 'a11164a0-2fe5-11eb-bc69-06d8413a1460',
            functionVersion: '$LATEST',
            memoryLimitInMB: 256,
            getRemainingTimeInMillis: () => 1000,
        };
        spySession = jest.spyOn(SessionProxy, 'getSession');
        spySessionClient = jest.spyOn<any, any>(SessionProxy.prototype, 'client');
        spyInitializeRuntime = jest.spyOn<any, any>(
            Resource.prototype,
            'initializeRuntime'
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    const getResource = (
        handlers?: HandlerSignatures<MockModel, MockTypeConfigurationModel>
    ): Resource => {
        const instance = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            handlers,
            MockTypeConfigurationModel
        );
        return instance;
    };

    test('entrypoint handler error', async () => {
        const resource = getResource();
        const event = await resource.entrypoint({}, MOCK_CTX);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InvalidRequest);
    });

    test('entrypoint missing model class', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resource = new Resource(TYPE_NAME, null as any);
        const event = await resource.entrypoint({}, MOCK_CTX);
        expect(event).toMatchObject({
            message: 'Error: Missing Model class to be used to deserialize JSON data.',
            status: OperationStatus.Failed,
            errorCode: HandlerErrorCode.InternalFailure,
        });
    });

    test('entrypoint success production-like', async () => {
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        const event = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(spyInitializeRuntime).toBeCalledTimes(1);
        expect(event).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
        expect(mockHandler).toBeCalledTimes(1);
    });

    test('publish exception metric without proxy', async () => {
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, jest.fn());
        const mockPublishException = jest.fn();
        jest.spyOn(
            MetricsPublisherProxy.prototype,
            'publishExceptionMetric'
        ).mockImplementation(mockPublishException);
        const mockLog = jest.fn();
        jest.spyOn(asTestable(resource).platformLoggerProxy, 'log').mockImplementation(
            mockLog
        );
        await asTestable(resource).publishExceptionMetric(
            Action.Create,
            Error('Sorry')
        );
        expect(mockPublishException).toBeCalledTimes(0);
        expect(mockLog).toBeCalledTimes(1);
        expect(mockLog).toBeCalledWith('Error: Sorry');
    });

    test('entrypoint handler raises', async () => {
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        const mockPublishException = jest.fn();
        jest.spyOn(
            MetricsPublisherProxy.prototype,
            'publishExceptionMetric'
        ).mockImplementation(mockPublishException);
        const spyInvokeHandler = jest.spyOn<typeof resource, any>(
            resource,
            'invokeHandler'
        );
        spyInvokeHandler.mockImplementation(() => {
            throw new exceptions.InvalidRequest('handler failed');
        });
        const event = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(mockPublishException).toBeCalledTimes(1);
        expect(spyInvokeHandler).toBeCalledTimes(1);
        expect(event).toMatchObject({
            errorCode: 'InvalidRequest',
            message: 'Error: handler failed',
            status: OperationStatus.Failed,
            callbackDelaySeconds: 0,
        });
    });

    test('entrypoint non mutating action', async () => {
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        entrypointPayload['action'] = 'READ';
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        resource.addHandler(Action.Create, mockHandler);
        await resource.entrypoint(entrypointPayload, MOCK_CTX);
    });

    test('entrypoint redacting credentials', async () => {
        expect.assertions(5);
        const spyPublishLogEvent = jest.spyOn<any, any>(
            LogPublisher.prototype,
            'publishLogEvent'
        );
        jest.spyOn<any, any>(S3LogHelper.prototype, 'prepareFolder').mockResolvedValue(
            null
        );
        jest.spyOn<any, any>(
            CloudWatchLogPublisher.prototype,
            'populateSequenceToken'
        ).mockResolvedValue({});
        const spyPrepareLogStream = jest
            .spyOn<any, any>(CloudWatchLogHelper.prototype, 'prepareLogStream')
            .mockResolvedValue('log-stream-name');
        const mockPublishMessage = jest.fn().mockResolvedValue({});
        jest.spyOn<any, any>(
            LambdaLogPublisher.prototype,
            'publishMessage'
        ).mockImplementation(mockPublishMessage);
        jest.spyOn<any, any>(
            CloudWatchLogPublisher.prototype,
            'publishMessage'
        ).mockImplementation(mockPublishMessage);
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        entrypointPayload['action'] = 'READ';
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        resource.addHandler(Action.Read, mockHandler);
        await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(spySession).toHaveBeenCalled();
        expect(spySessionClient).toBeCalledTimes(4);
        expect(spyPrepareLogStream).toBeCalledTimes(1);
        expect(spyPublishLogEvent).toHaveBeenCalled();
        expect(mockPublishMessage).toHaveBeenCalled();
    });

    test('entrypoint with callback context', async () => {
        entrypointPayload['callbackContext'] = { a: 'b' };
        const event = ProgressEvent.success(null, { c: 'd' });
        const mockHandler: jest.Mock = jest.fn(() => event);
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        const response = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(response).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith(
            expect.any(SessionProxy),
            expect.any(BaseResourceHandlerRequest),
            entrypointPayload['callbackContext'],
            expect.any(LoggerProxy),
            expect.any(MockTypeConfigurationModel)
        );
    });

    test('entrypoint without callback context', async () => {
        entrypointPayload['callbackContext'] = null;
        const event = ProgressEvent.progress(null, { c: 'd' });
        event.callbackDelaySeconds = 5;
        const mockHandler: jest.Mock = jest.fn(() => event);
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        const response = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(spyInitializeRuntime).toBeCalledTimes(1);
        expect(response).toMatchObject({
            message: '',
            status: OperationStatus.InProgress,
            callbackDelaySeconds: 5,
            callbackContext: { c: 'd' },
        });
        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith(
            expect.any(SessionProxy),
            expect.any(BaseResourceHandlerRequest),
            {},
            expect.any(LoggerProxy),
            expect.any(MockTypeConfigurationModel)
        );
    });

    test('entrypoint without type configuration', async () => {
        entrypointPayload['callbackContext'] = { a: 'b' };
        delete entrypointPayload.requestData.typeConfiguration;
        const event = ProgressEvent.progress(null, { c: 'd' });
        event.callbackDelaySeconds = 5;
        const mockHandler: jest.Mock = jest.fn(() => event);
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        const response = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(spyInitializeRuntime).toBeCalledTimes(1);
        expect(response).toMatchObject({
            message: '',
            status: OperationStatus.InProgress,
            callbackDelaySeconds: 5,
            callbackContext: { c: 'd' },
        });
        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith(
            expect.any(SessionProxy),
            expect.any(BaseResourceHandlerRequest),
            entrypointPayload.callbackContext,
            expect.any(LoggerProxy),
            undefined // no typeConfigurationTypeReference → castTypeConfigurationRequest returns null → coerced to undefined
        );
    });

    test('entrypoint success without caller provider creds', async () => {
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        const expected = {
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        };
        // Credentials are defined in payload, but null.
        entrypointPayload['requestData']['providerCredentials'] = null;
        entrypointPayload['requestData']['callerCredentials'] = null;
        let response = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(response).toMatchObject(expected);

        // Credentials are undefined in payload.
        delete entrypointPayload['requestData']['providerCredentials'];
        delete entrypointPayload['requestData']['callerCredentials'];
        response = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(response).toMatchObject(expected);
    });

    test('entrypoint with log stream failure', async () => {
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        const spyPrepareLogStream = jest
            .spyOn<any, any>(CloudWatchLogHelper.prototype, 'prepareLogStream')
            .mockResolvedValue(null);
        const spyPrepareFolder = jest.spyOn<any, any>(
            S3LogHelper.prototype,
            'prepareFolder'
        );
        jest.spyOn<any, any>(
            S3LogHelper.prototype,
            'doesFolderExist'
        ).mockResolvedValue(true);
        const response = await resource.entrypoint(entrypointPayload, MOCK_CTX);
        expect(spyInitializeRuntime).toBeCalledTimes(1);
        expect(spySessionClient).toBeCalledTimes(4);
        expect(spyPrepareLogStream).toBeCalledTimes(1);
        expect(spyPrepareFolder).toBeCalledTimes(1);
        expect(spyPrepareFolder).toReturnWith(
            Promise.resolve(
                'arn__aws__cloudformation__us-east-1__123456789012__stack/sample-stack/e722ae60-fe62-11e8-9a0e-0ae8cc519968'
            )
        );
        expect(asTestable(resource).providerEventsLogger).toBeInstanceOf(
            S3LogPublisher
        );
        expect(asTestable(resource).s3LogHelper).toBeDefined();
        // bucketName is private on S3LogHelper — access via any for this implementation-detail assertion
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((asTestable(resource).s3LogHelper as any).bucketName).toBe(
            'provider-logging-group-name-123456789012'
        );
        expect(response).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
    });

    test('parse request invalid request', () => {
        const parseRequest = () => {
            Resource.testParseRequest({});
        };
        expect(parseRequest).toThrow(exceptions.InvalidRequest);
        expect(parseRequest).toThrow(/missing.+awsAccountId/i);
    });

    test('parse request with object literal callback context', () => {
        const callbackContext = { a: 'b' };
        entrypointPayload['callbackContext'] = { a: 'b' };
        const [credentials, action, callback, request] =
            Resource.testParseRequest(entrypointPayload);
        expect(credentials).toBeDefined();
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('parse request with map callback context', () => {
        const callbackContext = { a: 'b' };
        entrypointPayload['callbackContext'] = callbackContext;
        const [credentials, action, callback, request] =
            Resource.testParseRequest(entrypointPayload);
        expect(credentials).toBeDefined();
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('cast resource request invalid request', () => {
        const request = HandlerRequest.deserialize(entrypointPayload);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        request!.requestData = null as any;
        const resource = getResource();
        const castResourceRequest = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            asTestable(resource).castResourceRequest(request as any);
        };
        expect(castResourceRequest).toThrow(exceptions.InvalidRequest);
        expect(castResourceRequest).toThrow(
            // previously tested for (0) and (1), but now seeing (2); error message probably depends on version of JS/TS
            // (0) "TypeError: Cannot read property"
            // (1) "TypeError: Cannot read property 'resourceProperties' of null (TypeError)"
            // (2) "TypeError: Cannot read properties of null (reading 'resourceProperties') (TypeError)"
            /TypeError: Cannot read propert(y|.*'resourceProperties'.*)/
        );
    });

    test('parse request valid request and cast resource request', () => {
        const spyDeserialize: jest.SpyInstance = jest.spyOn(MockModel, 'deserialize');
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );

        const [[callerCredentials, providerCredentials], action, callback, request] =
            Resource.testParseRequest(entrypointPayload);

        // Credentials are used when rescheduling, so can't zero them out (for now).
        expect(callerCredentials).toBeTruthy();
        expect(providerCredentials).toBeTruthy();

        expect(action).toBe(Action.Create);
        expect(callback).toMatchObject({});

        const modeledRequest = asTestable(resource).castResourceRequest(request);
        expect(spyDeserialize).nthCalledWith(1, { state: 'state1' });
        expect(spyDeserialize).nthCalledWith(2, { state: 'state2' });
        expect(modeledRequest).toMatchObject({
            clientRequestToken: request.bearerToken,
            desiredResourceState: { state: 'state1' },
            previousResourceState: { state: 'state2' },
            desiredResourceTags: request.requestData.stackTags,
            previousResourceTags: request.requestData.previousStackTags,
            systemTags: request.requestData.systemTags,
            awsAccountId: request.awsAccountId,
            logicalResourceIdentifier: 'myBucket',
            region: request.region,
            awsPartition: 'aws',
        });
    });

    test('entrypoint uncaught exception', async () => {
        const mockParseRequest = jest.spyOn<any, any>(BaseResource, 'parseRequest');
        mockParseRequest.mockImplementationOnce(() => {
            throw Error('exception');
        });
        const resource = getResource();
        const event = await resource.entrypoint({}, MOCK_CTX);
        expect(mockParseRequest).toBeCalledTimes(1);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InternalFailure);
        expect(event.message).toBe('exception');
    });

    test('entrypoint success even with wait logger failure', async () => {
        const spyWaitRunningProcesses = jest
            .spyOn<any, any>(Resource.prototype, 'waitRunningProcesses')
            .mockRejectedValue({
                message:
                    'Not allowed to submit a new task after progress tracker has been closed',
            });
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        const event = await resource.entrypoint(entrypointPayload, lambdaContext);
        expect(spyInitializeRuntime).toBeCalledTimes(1);
        expect(spyWaitRunningProcesses).toBeCalledTimes(1);
        expect(event).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
        expect(mockHandler).toBeCalledTimes(1);
    });

    test('entrypoint success when waitRunningProcesses fails with Error and short remaining time', async () => {
        jest.spyOn<any, any>(
            Resource.prototype,
            'waitRunningProcesses'
        ).mockRejectedValue(new Error('Progress tracker was closed'));
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        // remaining time ≤ 200 ms → no delay incurred, but the Error branch is exercised
        const ctx = { ...lambdaContext, getRemainingTimeInMillis: () => 100 };
        const event = await resource.entrypoint(entrypointPayload, ctx);
        expect(event).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
    });

    test('entrypoint success when waitRunningProcesses fails with Error and remaining time > 200ms', async () => {
        jest.spyOn<any, any>(
            Resource.prototype,
            'waitRunningProcesses'
        ).mockRejectedValue(new Error('Progress tracker was closed'));
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        // remaining time > 200 ms → delay is awaited (0.001 s — trivially fast)
        const ctx = { ...lambdaContext, getRemainingTimeInMillis: () => 201 };
        const event = await resource.entrypoint(entrypointPayload, ctx);
        expect(event).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
    });

    test('entrypoint fails with InvalidTypeConfiguration when legacy resource receives typeConfiguration', async () => {
        // Resource created WITHOUT typeConfigurationTypeReference
        const resource = new Resource(TYPE_NAME, MockModel, null, undefined, undefined);
        resource.addHandler(
            Action.Create,
            jest.fn(async () => ProgressEvent.success())
        );
        // entrypointPayload already has requestData.typeConfiguration set
        const event = await resource.entrypoint(entrypointPayload, lambdaContext);
        expect(event).toMatchObject({
            status: OperationStatus.Failed,
            errorCode: HandlerErrorCode.InvalidTypeConfiguration,
        });
    });

    test('entrypoint success with two consecutive calls', async () => {
        // We are emulating the execution context reuse in the lambda function
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, mockHandler);
        jest.spyOn<any, any>(S3LogHelper.prototype, 'prepareFolder').mockResolvedValue(
            null
        );
        let event = await resource.entrypoint(entrypointPayload, lambdaContext);
        expect(asTestable(resource).loggerProxy.logPublisherCount).toBe(1);
        expect(event.status).toBe(OperationStatus.Success);
        event = await resource.entrypoint(entrypointPayload, {
            ...lambdaContext,
            awsRequestId: 'd8181a30-302a-11eb-9c27-0aeffe35c30a',
        });
        expect(asTestable(resource).loggerProxy.logPublisherCount).toBe(1);
        expect(event.status).toBe(OperationStatus.Success);
        expect(spyInitializeRuntime).toBeCalledTimes(2);
        expect(mockHandler).toBeCalledTimes(2);
    });

    test('add handler', () => {
        class ResourceEventHandler extends BaseResource<
            MockModel,
            MockTypeConfigurationModel
        > {
            @handlerEvent(Action.Create)
            public create(): void {}
            @handlerEvent(Action.Read)
            public read(): void {}
            @handlerEvent(Action.Update)
            public update(): void {}
            @handlerEvent(Action.Delete)
            public delete(): void {}
            @handlerEvent(Action.List)
            public list(): void {}
        }
        const handlers = new HandlerSignatures<MockModel, MockTypeConfigurationModel>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resource = new ResourceEventHandler(
            null as any,
            null as any,
            null,
            handlers,
            undefined
        );
        expect(resource.handlerFor(Action.Create)).toBe(resource.create);
        expect(resource.handlerFor(Action.Read)).toBe(resource.read);
        expect(resource.handlerFor(Action.Update)).toBe(resource.update);
        expect(resource.handlerFor(Action.Delete)).toBe(resource.delete);
        expect(resource.handlerFor(Action.List)).toBe(resource.list);
    });

    test('check resource instance and type name', async () => {
        class ResourceEventHandler extends BaseResource<
            MockModel,
            MockTypeConfigurationModel
        > {
            @handlerEvent(Action.Create)
            public async create(): Promise<ProgressEvent<MockModel>> {
                const progress = ProgressEvent.builder<ProgressEvent<MockModel>>()!
                    .message(this.typeName)
                    .status(OperationStatus.Success)
                    .resourceModels([])
                    .build();
                return progress;
            }
        }
        const handlers = new HandlerSignatures<MockModel, MockTypeConfigurationModel>();
        const resource = new ResourceEventHandler(
            TYPE_NAME,
            MockModel,
            null,
            handlers,
            MockTypeConfigurationModel
        );
        const event = await resource.testEntrypoint(testEntrypointPayload, undefined);
        expect(event.status).toBe(OperationStatus.Success);
        expect(event.message).toBe(TYPE_NAME);
    });

    test('invoke handler not found', async () => {
        expect.assertions(1);
        const resource = getResource();
        const callbackContext = {};
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await asTestable(resource).invokeHandler(
                null,
                null as any,
                Action.Create,
                callbackContext
            );
        } catch (e) {
            expect(e).toMatchObject({
                message: 'Unknown action CREATE',
            });
        }
    });

    test('invoke handler was found', async () => {
        const event = ProgressEvent.progress();
        const mockHandler: jest.Mock = jest.fn(() => event);
        const handlers = new HandlerSignatures<MockModel, MockTypeConfigurationModel>();
        handlers.set(Action.Create, mockHandler);
        const resource = getResource(handlers);
        const session = new SessionProxy({});
        const request = new BaseResourceHandlerRequest<MockModel>();
        const typeConf = new MockTypeConfigurationModel();
        const callbackContext = {};
        const response = await asTestable(resource).invokeHandler(
            session,
            request,
            Action.Create,
            callbackContext,
            typeConf
        );
        expect(response).toBe(event);
        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith(
            session,
            request,
            callbackContext,
            expect.any(LoggerProxy),
            typeConf
        );
    });

    test('invoke handler non mutating must be synchronous', async () => {
        const promises: any[] = [];
        for (const action of [Action.List, Action.Read]) {
            const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.progress());
            const handlers = new HandlerSignatures<
                MockModel,
                MockTypeConfigurationModel
            >();
            handlers.set(action, mockHandler);
            const resource = getResource(handlers);
            const callbackContext = {};
            promises.push(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                asTestable(resource)
                    .invokeHandler(null, null as any, action, callbackContext)
                    .catch((e: exceptions.BaseHandlerException) => {
                        expect(e).toMatchObject({
                            errorCode: HandlerErrorCode.InternalFailure,
                            message:
                                'READ and LIST handlers must return synchronously.',
                        });
                    })
            );
        }
        expect.assertions(promises.length);
        await Promise.all(promises);
    });

    test('invoke handler try object modification', async () => {
        const event = ProgressEvent.progress();
        const mockHandler: jest.Mock = jest.fn(() => event);
        const handlers = new HandlerSignatures<MockModel, MockTypeConfigurationModel>();
        handlers.set(Action.Create, mockHandler);
        const resource = getResource(handlers);
        const callbackContext = {
            state: 'original-state',
        };
        const request = new BaseResourceHandlerRequest<MockModel>();
        request.desiredResourceState = new MockModel();
        request.desiredResourceState.state = 'original-desired-state';
        request.previousResourceState = new MockModel();
        request.awsAccountId = '123456789012';
        await asTestable(resource).invokeHandler(
            null,
            request,
            Action.Create,
            callbackContext
        );
        const modifyCurrentState = () => {
            request.desiredResourceState!.state = 'another-state';
        };
        const modifyPreviousState = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            request.previousResourceState = null as any;
        };
        const modifyAwsAccountId = () => {
            request.awsAccountId = '';
        };
        const modifyCallbackContext = () => {
            callbackContext.state = 'another-state';
        };
        expect(modifyCurrentState).toThrow(
            /cannot assign to read only property 'state' of object/i
        );
        expect(modifyPreviousState).toThrow(
            /cannot assign to read only property 'previousResourceState' of object/i
        );
        expect(modifyAwsAccountId).toThrow(
            /cannot assign to read only property 'awsAccountId' of object/i
        );
        expect(modifyCallbackContext).toThrow(
            /cannot assign to read only property 'state' of object/i
        );
    });

    test('invoke handler does not provide response', async () => {
        expect.assertions(1);
        const mockHandler: jest.Mock = jest.fn().mockResolvedValue(null);
        const resource = new Resource(TYPE_NAME, MockModel);
        resource.addHandler(Action.Create, mockHandler);
        const callbackContext = {};
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await asTestable(resource).invokeHandler(
                null,
                null as any,
                Action.Create,
                callbackContext
            );
        } catch (e) {
            expect(e).toMatchObject({
                message: 'Handler failed to provide a response.',
            });
        }
    });

    test('parse test request invalid request', () => {
        const resource = getResource();
        const parseTestRequest = () => {
            asTestable(resource).parseTestRequest({});
        };
        expect(parseTestRequest).toThrow(exceptions.InternalFailure);
        expect(parseTestRequest).toThrow(/missing.+credentials/i);
    });

    test('parse test request with object literal callback context', () => {
        const callbackContext = { a: 'b' };
        testEntrypointPayload['callbackContext'] = callbackContext;
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        const [request, action, callback] =
            asTestable(resource).parseTestRequest(testEntrypointPayload);
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('parse test request with map callback context', () => {
        const callbackContext = { a: 'b' };
        testEntrypointPayload['callbackContext'] = callbackContext;
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        const [request, action, callback] =
            asTestable(resource).parseTestRequest(testEntrypointPayload);
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('parse test request valid request', () => {
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );
        resource.addHandler(Action.Create, jest.fn());
        const [request, action, callback] =
            asTestable(resource).parseTestRequest(testEntrypointPayload);

        expect(request).toMatchObject({
            clientRequestToken: 'ecba020e-b2e6-4742-a7d0-8a06ae7c4b2b',
            desiredResourceState: { state: 'state1' },
            previousResourceState: { state: 'state2' },
            logicalResourceIdentifier: null,
        });

        expect(action).toBe(Action.Create);
        expect(callback).toMatchObject({});
    });

    test('test entrypoint handler error', async () => {
        const resource = getResource();
        const event = await resource.testEntrypoint({}, undefined);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InternalFailure);
    });

    test('test entrypoint uncaught exception', async () => {
        const resource = getResource();
        const mockParseRequest = jest.spyOn<any, any>(resource, 'parseTestRequest');
        mockParseRequest.mockImplementationOnce(() => {
            throw Error('exception');
        });
        const event = await resource.testEntrypoint({}, undefined);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InternalFailure);
        expect(event.message).toBe('exception');
    });

    test('test entrypoint missing model class', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resource = new Resource(TYPE_NAME, null as any);
        const event = await resource.testEntrypoint({}, undefined);
        expect(event).toMatchObject({
            message: 'Error: Missing Model class to be used to deserialize JSON data.',
            status: OperationStatus.Failed,
            errorCode: HandlerErrorCode.InternalFailure,
        });
    });

    test('test entrypoint success', async () => {
        const spyDeserialize: jest.SpyInstance = jest.spyOn(MockModel, 'deserialize');
        const resource = new Resource(
            TYPE_NAME,
            MockModel,
            null,
            undefined,
            MockTypeConfigurationModel
        );

        const progressEvent = ProgressEvent.progress();
        const mockHandler: jest.Mock = jest.fn(() => progressEvent);
        resource.addHandler(Action.Create, mockHandler);
        const event = await resource.testEntrypoint(testEntrypointPayload, undefined);
        expect(event).toBe(progressEvent);

        expect(spyDeserialize).nthCalledWith(1, { state: 'state1' });
        expect(spyDeserialize).nthCalledWith(2, { state: 'state2' });
        expect(mockHandler).toBeCalledTimes(1);
    });
});
