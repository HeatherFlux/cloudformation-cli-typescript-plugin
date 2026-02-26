import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

import { Action, MetricTypes, StandardUnit } from '~/interface';
import { SessionProxy } from '~/proxy';
import {
    DimensionRecord,
    formatDimensions,
    MetricsPublisher,
    MetricsPublisherProxy,
} from '~/metrics';

// Keep real command classes so instanceof checks in the dispatcher work.
jest.mock('@aws-sdk/client-cloudwatch', () => {
    const actual = jest.requireActual('@aws-sdk/client-cloudwatch');
    return { ...actual, CloudWatchClient: jest.fn() };
});

describe('when getting metrics', () => {
    const MOCK_DATE = new Date('2020-01-01T23:05:38.964Z');
    const RESOURCE_TYPE = 'Aa::Bb::Cc';
    const NAMESPACE = 'AWS/CloudFormation/Aa/Bb/Cc';
    const AWS_CONFIG = {
        region: 'us-east-1',
        credentials: {
            accessKeyId: 'AAAAA',
            secretAccessKey: '11111',
        },
    };

    let session: SessionProxy;
    let proxy: MetricsPublisherProxy;
    let publisher: MetricsPublisher;
    let mockSend: jest.Mock;

    /** Get the input of the first PutMetricDataCommand sent to the mock. */
    function getLastSentInput() {
        const calls = mockSend.mock.calls.filter(
            ([cmd]) => cmd instanceof PutMetricDataCommand
        );
        expect(calls.length).toBeGreaterThan(0);
        return calls[calls.length - 1][0].input;
    }

    beforeAll(() => {
        session = new SessionProxy(AWS_CONFIG);
    });

    beforeEach(() => {
        mockSend = jest.fn().mockResolvedValue({});
        (CloudWatchClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

        proxy = new MetricsPublisherProxy();
        publisher = new MetricsPublisher(session, console, RESOURCE_TYPE);
        proxy.addMetricsPublisher(publisher);
        publisher.refreshClient();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('format dimensions', () => {
        const dimensions: DimensionRecord = {
            MyDimensionKeyOne: 'valOne',
            MyDimensionKeyTwo: 'valTwo',
        };
        const result = formatDimensions(dimensions);
        expect(result).toMatchObject([
            { Name: 'MyDimensionKeyOne', Value: 'valOne' },
            { Name: 'MyDimensionKeyTwo', Value: 'valTwo' },
        ]);
    });

    test('put metric catches non-retryable error and logs it', async () => {
        const spyLogger = jest.spyOn(publisher['logger'], 'log');
        const errMsg =
            'An error occurred (InternalServiceError) when calling the PutMetricData operation: ';
        mockSend.mockRejectedValueOnce(
            Object.assign(new Error(errMsg), {
                name: 'InternalServiceError',
            })
        );
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: Action.Create,
            DimensionKeyResourceType: RESOURCE_TYPE,
        };
        await publisher.publishMetric(
            MetricTypes.HandlerInvocationCount,
            dimensions,
            StandardUnit.Count,
            1.0,
            MOCK_DATE
        );
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend).toHaveBeenCalledWith(expect.any(PutMetricDataCommand));
        const input = getLastSentInput();
        expect(input).toMatchObject({
            Namespace: NAMESPACE,
            MetricData: [
                {
                    Dimensions: [
                        { Name: 'DimensionKeyActionType', Value: 'CREATE' },
                        { Name: 'DimensionKeyResourceType', Value: 'Aa::Bb::Cc' },
                    ],
                    MetricName: MetricTypes.HandlerInvocationCount,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
        });
        expect(spyLogger).toHaveBeenCalledTimes(1);
        expect(spyLogger).toHaveBeenCalledWith(
            `An error occurred while publishing metrics: ${errMsg}`
        );
    });

    test('ThrottlingException is re-thrown', async () => {
        expect.assertions(1);
        mockSend.mockRejectedValueOnce(
            Object.assign(new Error('throttled'), { name: 'ThrottlingException' })
        );
        try {
            await publisher.publishMetric(
                MetricTypes.HandlerInvocationCount,
                {},
                StandardUnit.Count,
                1.0,
                MOCK_DATE
            );
        } catch (e) {
            if (e instanceof Error) {
                expect(e.name).toBe('ThrottlingException');
            }
        }
    });

    test('publish exception metric', async () => {
        await proxy.publishExceptionMetric(
            MOCK_DATE,
            Action.Create,
            new Error('fake-err')
        );
        expect(mockSend).toHaveBeenCalledTimes(1);
        const input = getLastSentInput();
        expect(input).toMatchObject({
            Namespace: NAMESPACE,
            MetricData: [
                {
                    Dimensions: [
                        { Name: 'DimensionKeyActionType', Value: 'CREATE' },
                        { Name: 'DimensionKeyExceptionType', Value: 'Error' },
                        { Name: 'DimensionKeyResourceType', Value: 'Aa::Bb::Cc' },
                    ],
                    MetricName: MetricTypes.HandlerException,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
        });
    });

    test('publish invocation metric', async () => {
        await proxy.publishInvocationMetric(MOCK_DATE, Action.Create);
        expect(mockSend).toHaveBeenCalledTimes(1);
        const input = getLastSentInput();
        expect(input).toMatchObject({
            Namespace: NAMESPACE,
            MetricData: [
                {
                    Dimensions: [
                        { Name: 'DimensionKeyActionType', Value: 'CREATE' },
                        { Name: 'DimensionKeyResourceType', Value: 'Aa::Bb::Cc' },
                    ],
                    MetricName: MetricTypes.HandlerInvocationCount,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
        });
    });

    test('publish duration metric', async () => {
        await proxy.publishDurationMetric(MOCK_DATE, Action.Create, 100);
        expect(mockSend).toHaveBeenCalledTimes(1);
        const input = getLastSentInput();
        expect(input).toMatchObject({
            Namespace: NAMESPACE,
            MetricData: [
                {
                    Dimensions: [
                        { Name: 'DimensionKeyActionType', Value: 'CREATE' },
                        { Name: 'DimensionKeyResourceType', Value: 'Aa::Bb::Cc' },
                    ],
                    MetricName: MetricTypes.HandlerInvocationDuration,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Milliseconds,
                    Value: 100,
                },
            ],
        });
    });

    test('publish log delivery exception metric', async () => {
        await proxy.publishLogDeliveryExceptionMetric(MOCK_DATE, new TypeError('test'));
        expect(mockSend).toHaveBeenCalledTimes(1);
        const input = getLastSentInput();
        expect(input).toMatchObject({
            Namespace: NAMESPACE,
            MetricData: [
                {
                    Dimensions: [
                        {
                            Name: 'DimensionKeyActionType',
                            Value: 'ProviderLogDelivery',
                        },
                        { Name: 'DimensionKeyExceptionType', Value: 'TypeError' },
                        { Name: 'DimensionKeyResourceType', Value: 'Aa::Bb::Cc' },
                    ],
                    MetricName: MetricTypes.HandlerException,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
        });
    });

    test('publish log delivery exception metric swallows internal error', async () => {
        const spyLogger = jest.spyOn(publisher['logger'], 'log');
        const spyPublishLog = jest.spyOn(
            publisher,
            'publishLogDeliveryExceptionMetric'
        );
        mockSend.mockRejectedValueOnce(
            Object.assign(new Error('Sorry'), {
                name: 'InternalServiceError',
                retryable: true,
            })
        );
        await proxy.publishLogDeliveryExceptionMetric(MOCK_DATE, new TypeError('test'));
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(spyLogger).toHaveBeenCalledTimes(1);
        await expect(spyPublishLog.mock.results[0].value).resolves.toBeUndefined();
    });

    test('publishLogDeliveryExceptionMetric catches rethrowing error from publishMetric', async () => {
        // publishMetric re-throws ThrottlingException; the outer catch in
        // publishLogDeliveryExceptionMetric (line 195) must swallow it.
        const spyLogger = jest.spyOn(publisher['logger'], 'log');
        mockSend.mockRejectedValueOnce(
            Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' })
        );
        await publisher.publishLogDeliveryExceptionMetric(
            MOCK_DATE,
            new TypeError('test')
        );
        expect(spyLogger).toHaveBeenCalledWith(expect.any(Error));
    });

    test('metrics publisher without refreshing client throws', async () => {
        expect.assertions(1);
        const metricsPublisher = new MetricsPublisher(session, console, RESOURCE_TYPE);
        try {
            await metricsPublisher.publishMetric(
                MetricTypes.HandlerInvocationCount,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                null as any,
                StandardUnit.Count,
                1.0,
                MOCK_DATE
            );
        } catch (e) {
            if (e instanceof Error) {
                expect(e.message).toMatch(/CloudWatch client was not initialized/);
            }
        }
    });

    test('metrics publisher proxy add metrics publisher null safe', () => {
        const proxyEmpty = new MetricsPublisherProxy();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        proxyEmpty.addMetricsPublisher(null as any);
        proxyEmpty.addMetricsPublisher(undefined);
        expect(proxyEmpty['publishers']).toMatchObject([]);
    });
});
