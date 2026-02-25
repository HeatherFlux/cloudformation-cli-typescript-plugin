import { ProgressEvent, ResourceHandlerRequest, SessionProxy } from '~/proxy';
import { BaseModel, HandlerErrorCode, OperationStatus, Optional } from '~/interface';

/** Minimal stub for an AWS SDK v3 client constructor. */
class FakeClient {
    constructor(public readonly config: any) {}
    send = jest.fn();
}

describe('when getting session proxy', () => {
    class ResourceModel extends BaseModel {
        constructor(partial?: unknown) {
            super();
            if (partial) {
                Object.assign(this, partial);
            }
        }
        public static readonly TYPE_NAME: string = 'Test::Resource::Model';

        public somekey: Optional<string>;
        public someotherkey: Optional<string>;
    }

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe('session proxy', () => {
        const AWS_CONFIG = {
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'AAAAA',
                secretAccessKey: '11111',
            },
        };

        test('client() returns an instance of the given ClientClass', () => {
            const proxy = new SessionProxy(AWS_CONFIG);
            const client = proxy.client(FakeClient);
            expect(client).toBeInstanceOf(FakeClient);
        });

        test('client() merges session config with per-call overrides', () => {
            const proxy = new SessionProxy(AWS_CONFIG);
            const override = { region: 'eu-west-1' };
            const client = proxy.client(FakeClient, override);
            expect((client as FakeClient).config.region).toBe('eu-west-1');
            expect((client as FakeClient).config.credentials).toEqual(
                AWS_CONFIG.credentials
            );
        });

        test('configuration getter returns the raw config', () => {
            const proxy = new SessionProxy(AWS_CONFIG);
            expect(proxy.configuration).toMatchObject(AWS_CONFIG);
        });

        test('getSession returns a SessionProxy when credentials are provided', () => {
            const proxy = SessionProxy.getSession(
                AWS_CONFIG.credentials,
                AWS_CONFIG.region
            );
            expect(proxy).toBeInstanceOf(SessionProxy);
            const client = proxy!.client(FakeClient);
            expect(client).toBeInstanceOf(FakeClient);
        });

        test('getSession returns null when no credentials are provided', () => {
            const proxy = SessionProxy.getSession(undefined);
            expect(proxy).toBeNull();
        });
    });

    describe('progress event', () => {
        test('should fail with json serializable', () => {
            const errorCode = HandlerErrorCode.AlreadyExists;
            const message = 'message of failed event';
            const event = ProgressEvent.failed(errorCode, message);
            expect(event.status).toBe(OperationStatus.Failed);
            expect(event.errorCode).toBe(errorCode);
            expect(event.message).toBe(message);
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Failed,
                errorCode: errorCode,
                message,
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with context', () => {
            const message = 'message of event with context';
            const event = ProgressEvent.builder()!
                .callbackContext({ a: 'b' })
                .message(message)
                .status(OperationStatus.Success)
                .build();
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Success,
                message,
                callbackContext: {
                    a: 'b',
                },
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with model', () => {
            const message = 'message of event with model';
            const model = new ResourceModel({
                somekey: 'a',
                someotherkey: 'b',
                somenullkey: null,
            });
            const event = ProgressEvent.progress<ProgressEvent<ResourceModel>>(
                model,
                null
            );
            event.message = message;
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.InProgress,
                message,
                resourceModel: {
                    somekey: 'a',
                    someotherkey: 'b',
                },
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with models', () => {
            const message = 'message of event with models';
            const models = [
                new ResourceModel({
                    somekey: 'a',
                    someotherkey: 'b',
                }),
                new ResourceModel({
                    somekey: 'c',
                    someotherkey: 'd',
                }),
            ];
            const event = new ProgressEvent<ResourceModel>({
                status: OperationStatus.Success,
                message,
                resourceModels: models,
            });
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Success,
                message,
                resourceModels: [
                    {
                        somekey: 'a',
                        someotherkey: 'b',
                    },
                    {
                        somekey: 'c',
                        someotherkey: 'd',
                    },
                ],
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with error code', () => {
            const message = 'message of event with error code';
            const event = new ProgressEvent({
                status: OperationStatus.Failed,
                message,
                errorCode: HandlerErrorCode.InvalidRequest,
            });
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Failed,
                message,
                errorCode: HandlerErrorCode.InvalidRequest,
                callbackDelaySeconds: 0,
            });
        });

        test('progress with ctx (truthy) sets callbackContext', () => {
            const ctx = { key: 'value' };
            const event = ProgressEvent.progress(undefined, ctx);
            expect(event.callbackContext).toEqual(ctx);
            expect(event.status).toBe(OperationStatus.InProgress);
        });

        test('progress without model omits resourceModel', () => {
            const event = ProgressEvent.progress();
            expect(event.resourceModel).toBeUndefined();
            expect(event.status).toBe(OperationStatus.InProgress);
        });

        test('success sets status to Success', () => {
            const model = new ResourceModel({ somekey: 'x' });
            const event = ProgressEvent.success(model);
            expect(event.status).toBe(OperationStatus.Success);
            expect(event.resourceModel).toBe(model);
        });
    });

    describe('ResourceHandlerRequest', () => {
        test('is constructable and instanceof BaseModel request', () => {
            const req = new ResourceHandlerRequest<ResourceModel>();
            expect(req).toBeInstanceOf(ResourceHandlerRequest);
        });
    });
});
