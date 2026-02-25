import {
    CloudWatchLogsClient,
    CreateLogGroupCommand,
    CreateLogStreamCommand,
    DescribeLogGroupsCommand,
    DescribeLogStreamsCommand,
    PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
    S3Client,
    CreateBucketCommand,
    ListObjectsV2Command,
    PutObjectCommand,
} from '@aws-sdk/client-s3';

import { SessionProxy } from '~/proxy';
import { MetricsPublisherProxy } from '~/metrics';
import {
    CloudWatchLogHelper,
    CloudWatchLogPublisher,
    LambdaLogPublisher,
    LoggerProxy,
    LogPublisher,
    RetryableLogError,
    S3LogHelper,
    S3LogPublisher,
} from '~/log-delivery';

const IDENTIFIER = 'f3390613-b2b5-4c31-a4c6-66813dff96a6';

// Keep real command classes so instanceof checks in the smart dispatcher work.
// Only mock the client constructors.
jest.mock('@aws-sdk/client-cloudwatch-logs', () => {
    const actual = jest.requireActual('@aws-sdk/client-cloudwatch-logs');
    return { ...actual, CloudWatchLogsClient: jest.fn() };
});
jest.mock('@aws-sdk/client-s3', () => {
    const actual = jest.requireActual('@aws-sdk/client-s3');
    return { ...actual, S3Client: jest.fn() };
});
jest.mock('uuid', () => ({ v4: () => IDENTIFIER }));
jest.mock('~/metrics');

/** Helper: create an SDK v3-style error with a specific `name` (error code). */
function sdkError(name: string, message = name): Error {
    return Object.assign(new Error(message), { name });
}

describe('when delivering logs', () => {
    const AWS_ACCOUNT_ID = '123456789012';
    const LOG_GROUP_NAME = 'log-group-name';
    const LOG_STREAM_NAME = 'log-stream-name';
    const S3_BUCKET_NAME = 'log-group-name-123456789012';
    const S3_FOLDER_NAME = 's3-folder-name';
    const AWS_CONFIG = {
        region: 'us-east-1',
        credentials: { accessKeyId: 'AAAAA', secretAccessKey: '11111' },
    };

    let session: SessionProxy;

    // Per-operation mocks for CloudWatch Logs
    let mockDescribeLogGroups: jest.Mock;
    let mockCreateLogGroup: jest.Mock;
    let mockCreateLogStream: jest.Mock;
    let mockDescribeLogStreams: jest.Mock;
    let mockPutLogEvents: jest.Mock;
    let mockCwLogsSend: jest.Mock;

    // Per-operation mocks for S3
    let mockListObjectsV2: jest.Mock;
    let mockCreateBucket: jest.Mock;
    let mockPutObject: jest.Mock;
    let mockS3Send: jest.Mock;

    let spyPublishLogEvent: jest.SpyInstance;
    let loggerProxy: LoggerProxy;
    let metricsPublisherProxy: MetricsPublisherProxy;
    let publishExceptionMetric: jest.Mock;
    let lambdaLogger: LambdaLogPublisher;
    let spyLambdaPublish: jest.SpyInstance;
    let cloudWatchLogHelper: CloudWatchLogHelper;
    let cloudWatchLogger: CloudWatchLogPublisher;
    let spyCloudWatchPublish: jest.SpyInstance;
    let s3LogHelper: S3LogHelper;
    let s3Logger: S3LogPublisher;
    let spyS3Publish: jest.SpyInstance;

    beforeAll(() => {
        session = new SessionProxy(AWS_CONFIG);
    });

    beforeEach(async () => {
        // --- CloudWatch Logs mock setup ---
        mockDescribeLogGroups = jest.fn().mockResolvedValue({ logGroups: [] });
        mockCreateLogGroup = jest.fn().mockResolvedValue({});
        mockCreateLogStream = jest.fn().mockResolvedValue({});
        mockDescribeLogStreams = jest
            .fn()
            .mockResolvedValue({ logStreams: [{ uploadSequenceToken: null }] });
        mockPutLogEvents = jest
            .fn()
            .mockResolvedValue({ nextSequenceToken: 'first-seq' });

        mockCwLogsSend = jest.fn().mockImplementation((command) => {
            if (command instanceof DescribeLogGroupsCommand)
                return mockDescribeLogGroups(command.input);
            if (command instanceof CreateLogGroupCommand)
                return mockCreateLogGroup(command.input);
            if (command instanceof CreateLogStreamCommand)
                return mockCreateLogStream(command.input);
            if (command instanceof DescribeLogStreamsCommand)
                return mockDescribeLogStreams(command.input);
            if (command instanceof PutLogEventsCommand)
                return mockPutLogEvents(command.input);
            return Promise.resolve({});
        });
        (CloudWatchLogsClient as jest.Mock).mockImplementation(() => ({
            send: mockCwLogsSend,
        }));

        // --- S3 mock setup ---
        mockListObjectsV2 = jest.fn().mockResolvedValue({ Contents: [] });
        mockCreateBucket = jest.fn().mockResolvedValue({});
        mockPutObject = jest.fn().mockResolvedValue({});

        mockS3Send = jest.fn().mockImplementation((command) => {
            if (command instanceof ListObjectsV2Command)
                return mockListObjectsV2(command.input);
            if (command instanceof CreateBucketCommand)
                return mockCreateBucket(command.input);
            if (command instanceof PutObjectCommand)
                return mockPutObject(command.input);
            return Promise.resolve({});
        });
        (S3Client as jest.Mock).mockImplementation(() => ({ send: mockS3Send }));

        // --- metrics mock ---
        metricsPublisherProxy = new MetricsPublisherProxy();
        publishExceptionMetric = jest.fn().mockResolvedValue({});
        metricsPublisherProxy.publishLogDeliveryExceptionMetric =
            publishExceptionMetric;

        // --- shared spies ---
        spyPublishLogEvent = jest.spyOn<any, any>(
            LogPublisher.prototype,
            'publishLogEvent'
        );
        spyLambdaPublish = jest.spyOn<any, any>(
            LambdaLogPublisher.prototype,
            'publishMessage'
        );
        spyCloudWatchPublish = jest.spyOn<any, any>(
            CloudWatchLogPublisher.prototype,
            'publishMessage'
        );
        spyS3Publish = jest.spyOn<any, any>(S3LogPublisher.prototype, 'publishMessage');

        lambdaLogger = new LambdaLogPublisher(console);

        // Build CW log helper + publisher
        cloudWatchLogHelper = new CloudWatchLogHelper(
            session,
            LOG_GROUP_NAME,
            LOG_STREAM_NAME,
            console,
            metricsPublisherProxy
        );
        cloudWatchLogHelper.refreshClient();
        cloudWatchLogger = new CloudWatchLogPublisher(
            session,
            LOG_GROUP_NAME,
            (await cloudWatchLogHelper.prepareLogStream())!,
            console,
            metricsPublisherProxy
        );
        cloudWatchLogger.refreshClient();
        await cloudWatchLogger.populateSequenceToken();

        // Build S3 log helper + publisher
        s3LogHelper = new S3LogHelper(
            session,
            S3_BUCKET_NAME,
            S3_FOLDER_NAME,
            console,
            metricsPublisherProxy
        );
        s3LogHelper.refreshClient();
        s3Logger = new S3LogPublisher(
            session,
            S3_BUCKET_NAME,
            (await s3LogHelper.prepareFolder())!,
            console,
            metricsPublisherProxy
        );
        s3Logger.refreshClient();

        loggerProxy = new LoggerProxy({ depth: 8 });
        loggerProxy.addLogPublisher(cloudWatchLogger);
        loggerProxy.tracker.restart();

        jest.clearAllMocks();
    });

    afterEach(async () => {
        await loggerProxy.waitCompletion();
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    describe('lambda log publisher', () => {
        test('publish lambda log happy flow', async () => {
            const msgToLog = 'How is it going?';
            await lambdaLogger.publishLogEvent(msgToLog);
            expect(spyLambdaPublish).toHaveBeenCalledTimes(1);
            expect(spyLambdaPublish).toHaveBeenCalledWith(msgToLog, expect.any(Date));
        });

        test('publish lambda log with filter throwing', async () => {
            expect.assertions(2);
            const filter = {
                applyFilter(): string {
                    throw new Error('Sorry');
                },
            };
            const logger = new LambdaLogPublisher(console, filter);
            try {
                await logger.publishLogEvent('msg');
            } catch (e) {
                if (e instanceof Error) {
                    expect(e.message).toBe('Sorry');
                }
            }
            expect(spyLambdaPublish).toHaveBeenCalledTimes(0);
        });

        test('lambda publisher applies filters', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            const logger = new LambdaLogPublisher(console, filter);
            await logger.publishLogEvent(`account ${AWS_ACCOUNT_ID}`);
            expect(spyLambdaPublish).toHaveBeenCalledWith(
                'account <REDACTED>',
                expect.any(Date)
            );
        });
    });

    // -------------------------------------------------------------------------
    describe('cloudwatch log helper', () => {
        test('prepareLogStream with existing log group skips createLogGroup', async () => {
            mockDescribeLogGroups.mockResolvedValueOnce({
                logGroups: [
                    {
                        logGroupName: LOG_GROUP_NAME,
                        arn: 'arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/test:*',
                    },
                ],
            });
            const spyCreate = jest.spyOn<any, any>(
                CloudWatchLogHelper.prototype,
                'createLogGroup'
            );
            await cloudWatchLogHelper.prepareLogStream();
            expect(mockDescribeLogGroups).toHaveBeenCalledTimes(1);
            expect(mockDescribeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP_NAME })
            );
            expect(spyCreate).not.toHaveBeenCalled();
            expect(mockCreateLogStream).toHaveBeenCalledTimes(1);
            expect(mockCreateLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamName: LOG_STREAM_NAME,
                })
            );
        });

        test('prepareLogStream creates log group when it does not exist', async () => {
            await cloudWatchLogHelper.prepareLogStream();
            expect(mockDescribeLogGroups).toHaveBeenCalledTimes(1);
            expect(mockCreateLogGroup).toHaveBeenCalledTimes(1);
            expect(mockCreateLogGroup).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupName: LOG_GROUP_NAME })
            );
            expect(mockCreateLogStream).toHaveBeenCalledTimes(1);
            expect(mockCreateLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamName: LOG_STREAM_NAME,
                })
            );
        });

        test('cloudwatch helper without refreshing client throws', async () => {
            expect.assertions(1);
            const helper = new CloudWatchLogHelper(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console
            );
            try {
                await helper.prepareLogStream();
            } catch (e) {
                if (e instanceof Error) {
                    expect(e.message).toMatch(
                        /CloudWatchLogs client was not initialized/
                    );
                }
            }
        });

        test('describe failure still creates log group and stream', async () => {
            const spyLog = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLogger'],
                'log'
            );
            mockDescribeLogGroups.mockRejectedValueOnce(sdkError('Sorry'));
            await cloudWatchLogHelper.prepareLogStream();
            expect(mockDescribeLogGroups).toHaveBeenCalledTimes(1);
            expect(mockCreateLogGroup).toHaveBeenCalledTimes(1);
            expect(mockCreateLogStream).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(spyLog).toHaveBeenCalled();
        });

        test('create log group failure emits metrics and returns null', async () => {
            const spyLog = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLogger'],
                'log'
            );
            mockCreateLogGroup.mockRejectedValueOnce(sdkError('AccessDeniedException'));
            const result = await cloudWatchLogHelper.prepareLogStream();
            expect(result).toBeNull();
            expect(mockDescribeLogGroups).toHaveBeenCalledTimes(1);
            expect(mockCreateLogGroup).toHaveBeenCalledTimes(1);
            expect(mockCreateLogStream).not.toHaveBeenCalled();
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(spyLog).toHaveBeenCalled();
        });

        test('create log stream failure emits metrics and returns null', async () => {
            const spyLog = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLogger'],
                'log'
            );
            mockCreateLogStream.mockRejectedValueOnce(
                sdkError('AccessDeniedException')
            );
            const result = await cloudWatchLogHelper.prepareLogStream();
            expect(result).toBeNull();
            expect(mockDescribeLogGroups).toHaveBeenCalledTimes(1);
            expect(mockCreateLogGroup).toHaveBeenCalledTimes(1);
            expect(mockCreateLogStream).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(spyLog).toHaveBeenCalled();
        });

        test('ResourceAlreadyExistsException on log group and stream is swallowed', async () => {
            mockCreateLogGroup.mockRejectedValueOnce(
                sdkError('ResourceAlreadyExistsException')
            );
            await cloudWatchLogHelper['createLogGroup']();
            expect(mockCreateLogGroup).toHaveBeenCalledTimes(1);

            mockCreateLogStream.mockRejectedValueOnce(
                sdkError('ResourceAlreadyExistsException')
            );
            await cloudWatchLogHelper['createLogStream']();
            expect(mockCreateLogStream).toHaveBeenCalledTimes(1);
        });

        test('cloudwatch helper with null log stream name uses uuid', async () => {
            const helper = new CloudWatchLogHelper(
                session,
                LOG_GROUP_NAME,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                null as any,
                console
            );
            helper.refreshClient();
            await helper.prepareLogStream();
            expect(mockCreateLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamName: IDENTIFIER,
                })
            );
        });
    });

    // -------------------------------------------------------------------------
    describe('cloudwatch log publisher', () => {
        test('publish cloudwatch log happy flow', async () => {
            const msgToLog = 'How is it going?';
            await cloudWatchLogger.publishLogEvent(msgToLog);
            expect(spyCloudWatchPublish).toHaveBeenCalledTimes(1);
            expect(spyCloudWatchPublish).toHaveBeenCalledWith(
                msgToLog,
                expect.any(Date)
            );
            expect(mockPutLogEvents).toHaveBeenCalledTimes(1);
        });

        test('cloudwatch publisher without refreshing client throws', async () => {
            expect.assertions(1);
            const publisher = new CloudWatchLogPublisher(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console
            );
            try {
                await publisher.publishLogEvent('msg');
            } catch (e) {
                if (e instanceof Error) {
                    expect(e.message).toMatch(
                        /CloudWatchLogs client was not initialized/
                    );
                }
            }
        });

        test('cloudwatch publisher with null log stream skips logging', async () => {
            const spySkip = jest.spyOn<any, any>(
                CloudWatchLogPublisher.prototype,
                'skipLogging'
            );
            const publisher = new CloudWatchLogPublisher(
                session,
                LOG_GROUP_NAME,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                null as any,
                console
            );
            publisher.refreshClient();
            await publisher.publishLogEvent('msg');
            expect(mockPutLogEvents).not.toHaveBeenCalled();
            expect(spySkip).toHaveReturnedWith(true);
        });

        test('publish cloudwatch message sets sequence tokens correctly', async () => {
            mockPutLogEvents
                .mockResolvedValueOnce({ nextSequenceToken: 'second-seq' })
                .mockResolvedValueOnce({ nextSequenceToken: 'first-seq' });

            cloudWatchLogger['nextSequenceToken'] = null;
            await cloudWatchLogger.publishLogEvent('msg1');

            cloudWatchLogger['nextSequenceToken'] = 'some-seq';
            await cloudWatchLogger.publishLogEvent('msg2');

            expect(mockPutLogEvents).toHaveBeenCalledTimes(2);
        });

        test('InvalidSequenceTokenException triggers token refresh and RetryableLogError', async () => {
            expect.assertions(4);
            mockPutLogEvents
                .mockRejectedValueOnce(sdkError('InvalidSequenceTokenException'))
                .mockRejectedValueOnce(sdkError('DataAlreadyAcceptedException'))
                .mockResolvedValue({ nextSequenceToken: 'some-other-seq' });
            mockDescribeLogStreams.mockResolvedValue({
                logStreams: [{ uploadSequenceToken: 'some-other-seq' }],
            });

            for (let i = 1; i < 4; i++) {
                try {
                    await cloudWatchLogger.publishLogEvent('log-msg');
                } catch (e) {
                    expect((e as RetryableLogError).retryable).toBe(true);
                }
            }
            expect(mockPutLogEvents).toHaveBeenCalledTimes(3);
            expect(mockDescribeLogStreams).toHaveBeenCalledTimes(2);
        });

        test('ThrottlingException increments metrics and throws RetryableLogError', async () => {
            mockPutLogEvents.mockRejectedValueOnce(sdkError('ThrottlingException'));
            try {
                await cloudWatchLogger.publishLogEvent('msg');
            } catch (e) {
                expect(e).toBeInstanceOf(RetryableLogError);
            }
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
        });

        test('non-retryable error is logged but does not throw RetryableLogError', async () => {
            expect.assertions(2);
            const spyLog = jest.spyOn<any, any>(
                cloudWatchLogger['platformLogger'],
                'log'
            );
            mockPutLogEvents.mockRejectedValueOnce(sdkError('AccessDeniedException'));
            try {
                await cloudWatchLogger.publishLogEvent('msg');
            } catch (e) {
                // Should rethrow the original error, NOT a RetryableLogError
                expect(e).not.toBeInstanceOf(RetryableLogError);
            }
            expect(spyLog).toHaveBeenCalled();
        });

        test('sequence token extracted from error message skips describeLogStreams', async () => {
            mockPutLogEvents.mockRejectedValueOnce(
                Object.assign(
                    new Error(
                        'The given sequenceToken is invalid. The next expected sequenceToken is: 495579999999900356407851919528174642'
                    ),
                    { name: 'InvalidSequenceTokenException' }
                )
            );
            try {
                await cloudWatchLogger.publishLogEvent('msg');
            } catch (e) {
                expect((e as RetryableLogError).retryable).toBe(true);
            }
            // Token was extracted from message — no describe call needed
            expect(mockDescribeLogStreams).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    describe('s3 log helper', () => {
        test('prepareFolder with existing bucket but no folder creates folder', async () => {
            // listObjectsV2 returns empty = no folder
            await s3LogHelper.prepareFolder();
            expect(mockListObjectsV2).toHaveBeenCalledTimes(1);
            expect(mockListObjectsV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Prefix: `${S3_FOLDER_NAME}/`,
                })
            );
            // No bucket creation needed (no NoSuchBucket error)
            expect(mockCreateBucket).not.toHaveBeenCalled();
            // Folder created
            expect(mockPutObject).toHaveBeenCalledTimes(1);
        });

        test('prepareFolder with existing folder skips createFolder', async () => {
            mockListObjectsV2.mockResolvedValueOnce({
                Contents: [
                    {
                        Key: `${S3_FOLDER_NAME}/`,
                        ETag: '"d41d8cd98f00b204e9800998ecf8427e"',
                        Size: 0,
                        StorageClass: 'STANDARD',
                    },
                ],
            });
            const result = await s3LogHelper.prepareFolder();
            expect(result).toBe(S3_FOLDER_NAME);
            expect(mockCreateBucket).not.toHaveBeenCalled();
            expect(mockPutObject).not.toHaveBeenCalled();
        });

        test('s3 helper without refreshing client throws', async () => {
            expect.assertions(1);
            const helper = new S3LogHelper(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console
            );
            try {
                await helper.prepareFolder();
            } catch (e) {
                if (e instanceof Error) {
                    expect(e.message).toMatch(/S3 client was not initialized/);
                }
            }
        });

        test('NoSuchBucket triggers createBucket', async () => {
            mockListObjectsV2.mockRejectedValueOnce(sdkError('NoSuchBucket'));
            await s3LogHelper.prepareFolder();
            expect(mockListObjectsV2).toHaveBeenCalledTimes(1);
            expect(mockCreateBucket).toHaveBeenCalledTimes(1);
            expect(mockCreateBucket).toHaveBeenCalledWith(
                expect.objectContaining({ Bucket: S3_BUCKET_NAME })
            );
            expect(mockPutObject).toHaveBeenCalledTimes(1);
            expect(mockPutObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: `${S3_FOLDER_NAME}/`,
                    ContentLength: 0,
                })
            );
        });

        test('generic list failure triggers createBucket and createFolder', async () => {
            const spyLog = jest.spyOn<any, any>(s3LogHelper['platformLogger'], 'log');
            mockListObjectsV2.mockRejectedValueOnce(sdkError('Sorry'));
            await s3LogHelper.prepareFolder();
            expect(mockListObjectsV2).toHaveBeenCalledTimes(1);
            expect(mockCreateBucket).toHaveBeenCalledTimes(1);
            expect(mockPutObject).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(spyLog).toHaveBeenCalled();
        });

        test('createBucket AccessDeniedException emits metrics and returns null', async () => {
            const spyLog = jest.spyOn<any, any>(s3LogHelper['platformLogger'], 'log');
            mockListObjectsV2.mockRejectedValueOnce(sdkError('NoSuchBucket'));
            mockCreateBucket.mockRejectedValueOnce(sdkError('AccessDeniedException'));
            const result = await s3LogHelper.prepareFolder();
            expect(result).toBeNull();
            expect(mockCreateBucket).toHaveBeenCalledTimes(1);
            expect(mockPutObject).not.toHaveBeenCalled();
            expect(publishExceptionMetric).toHaveBeenCalledTimes(2);
            expect(spyLog).toHaveBeenCalled();
        });

        test('createFolder failure emits metrics and returns null', async () => {
            const spyLog = jest.spyOn<any, any>(s3LogHelper['platformLogger'], 'log');
            mockPutObject.mockRejectedValueOnce(sdkError('AccessDeniedException'));
            const result = await s3LogHelper.prepareFolder();
            expect(result).toBeNull();
            expect(mockListObjectsV2).toHaveBeenCalledTimes(1);
            expect(mockCreateBucket).not.toHaveBeenCalled();
            expect(mockPutObject).toHaveBeenCalledTimes(1);
            expect(mockPutObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: `${S3_FOLDER_NAME}/`,
                    ContentLength: 0,
                })
            );
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(spyLog).toHaveBeenCalled();
        });

        test('BucketAlreadyExists is swallowed', async () => {
            mockCreateBucket.mockRejectedValueOnce(sdkError('BucketAlreadyExists'));
            await s3LogHelper['createBucket']();
            expect(mockCreateBucket).toHaveBeenCalledTimes(1);
        });

        test('s3 helper with null folder name uses uuid', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const helper = new S3LogHelper(
                session,
                S3_BUCKET_NAME,
                null as any,
                console
            );
            helper.refreshClient();
            await helper.prepareFolder();
            expect(mockPutObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: `${IDENTIFIER}/`,
                    ContentLength: 0,
                })
            );
        });
    });

    // -------------------------------------------------------------------------
    describe('s3 log publisher', () => {
        test('publish s3 log happy flow', async () => {
            const msgToLog = 'How is it going?';
            await s3Logger.publishLogEvent(msgToLog);
            expect(spyS3Publish).toHaveBeenCalledTimes(1);
            expect(spyS3Publish).toHaveBeenCalledWith(msgToLog, expect.any(Date));
            expect(mockPutObject).toHaveBeenCalledTimes(1);
            expect(mockPutObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: expect.stringContaining(`${S3_FOLDER_NAME}/`),
                    ContentType: 'text/plain',
                    Body: msgToLog,
                })
            );
        });

        test('s3 publisher without refreshing client throws', async () => {
            expect.assertions(1);
            const publisher = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console
            );
            try {
                await publisher.publishLogEvent('msg');
            } catch (e) {
                if (e instanceof Error) {
                    expect(e.message).toMatch(/S3 client was not initialized/);
                }
            }
        });

        test('publish s3 log with put object failure logs and re-throws', async () => {
            expect.assertions(5);
            const spyLog = jest.spyOn<any, any>(s3Logger['platformLogger'], 'log');
            mockPutObject.mockRejectedValueOnce(sdkError('AccessDeniedException'));
            try {
                await s3Logger.publishLogEvent('msg');
            } catch (e) {
                if (e instanceof Error) {
                    expect(e.name).toBe('AccessDeniedException');
                }
            }
            expect(mockPutObject).toHaveBeenCalledTimes(1);
            expect(mockPutObject).toHaveBeenCalledWith(
                expect.objectContaining({ Bucket: S3_BUCKET_NAME })
            );
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(spyLog).toHaveBeenCalled();
        });

        test('s3 publisher with filters redacts content', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            const publisher = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console,
                undefined,
                filter
            );
            publisher.refreshClient();
            await publisher.publishLogEvent(`account ${AWS_ACCOUNT_ID}`);
            expect(mockPutObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Body: 'account <REDACTED>',
                })
            );
        });

        test('s3 publisher with null folder skips logging', async () => {
            const spySkip = jest.spyOn<any, any>(
                S3LogPublisher.prototype,
                'skipLogging'
            );
            const publisher = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                null as any,
                console
            );
            publisher.refreshClient();
            await publisher.publishLogEvent('msg');
            expect(mockPutObject).not.toHaveBeenCalled();
            expect(spySkip).toHaveReturnedWith(true);
        });

        test('putLogEvents with rejectedLogEventsInfo throws', async () => {
            // Covers log-delivery.ts:230 — putLogEvents throws when response has rejectedLogEventsInfo
            mockPutLogEvents.mockResolvedValueOnce({
                rejectedLogEventsInfo: { tooOldLogEventEndIndex: 0 },
            });
            await expect(cloudWatchLogger.publishLogEvent('test msg')).rejects.toThrow();
        });

        test('populateSequenceToken swallows describeLogStreams error', async () => {
            // Covers log-delivery.ts:252 — platformLogger.log called when describeLogStreams throws
            const spyPlatformLog = jest.spyOn(console, 'log');
            mockDescribeLogStreams.mockRejectedValueOnce(new Error('describe failed'));
            const token = await cloudWatchLogger.populateSequenceToken();
            expect(token).toBeNull();
            expect(spyPlatformLog).toHaveBeenCalledWith(
                'Error from "describeLogStreams"',
                expect.any(Error)
            );
        });

        test('put object failure with no metrics publisher swallows metric error', async () => {
            expect.assertions(4);
            const spyEmit = jest.spyOn<any, any>(
                S3LogPublisher.prototype,
                'emitMetricsForLoggingFailure'
            );
            mockPutObject.mockRejectedValueOnce(sdkError('AccessDeniedException'));
            const publisher = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console,
                undefined // no metrics publisher
            );
            publisher.refreshClient();
            try {
                await publisher.publishLogEvent('msg');
            } catch (e) {
                if (e instanceof Error) {
                    expect(e.name).toBe('AccessDeniedException');
                }
            }
            expect(mockPutObject).toHaveBeenCalledTimes(1);
            expect(spyEmit).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    describe('logger proxy', () => {
        test('should process log with deserialize error', async () => {
            spyPublishLogEvent.mockRejectedValueOnce(new Error('publish failed'));
            const mockToJson = jest.fn().mockReturnValue(() => {
                throw new Error();
            });
            class Unserializable {
                message = 'msg';
                toJSON = mockToJson;
            }
            loggerProxy.log('%j', new Unserializable());
            await loggerProxy.waitCompletion();
            expect(spyPublishLogEvent).toHaveBeenCalledTimes(1);
            expect(spyPublishLogEvent).toHaveBeenCalledWith(
                'undefined',
                expect.any(Date)
            );
        });

        test('should add filter to all publishers', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            loggerProxy.addLogPublisher(lambdaLogger);
            loggerProxy.addFilter(filter);
            loggerProxy.log(`account ${AWS_ACCOUNT_ID}`);
            await loggerProxy.waitCompletion();
            expect(spyLambdaPublish).toHaveBeenCalledWith(
                'account <REDACTED>',
                expect.any(Date)
            );
            expect(spyCloudWatchPublish).toHaveBeenCalledWith(
                'account <REDACTED>',
                expect.any(Date)
            );
        });

        test('should process multiple log messages with all publishers', async () => {
            loggerProxy.addLogPublisher(lambdaLogger);
            loggerProxy.addLogPublisher(s3Logger);

            loggerProxy.log('count: [%d]', 5.12);
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-01').toISOString());
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-02').toISOString());
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-03').toISOString());
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-04').toISOString());
            expect(loggerProxy['inspectOptions'].depth).toBe(8);
            await loggerProxy.waitCompletion();

            expect(cloudWatchLogger['logStreamName']).toBe(LOG_STREAM_NAME);
            expect(s3Logger['folderName']).toBe(S3_FOLDER_NAME);
            expect(spyLambdaPublish).toHaveBeenCalledTimes(5);
            expect(spyCloudWatchPublish).toHaveBeenCalledTimes(5);
            expect(mockPutLogEvents).toHaveBeenCalledTimes(5);
            expect(spyS3Publish).toHaveBeenCalledTimes(5);
            expect(mockPutObject).toHaveBeenCalledTimes(5);
        });

        test('should retry on RetryableLogError', async () => {
            mockPutLogEvents
                .mockRejectedValueOnce(
                    Object.assign(
                        new Error(
                            'The given sequenceToken is invalid. The next expected sequenceToken is: 495579999999900356407851919528174642'
                        ),
                        { name: 'InvalidSequenceTokenException' }
                    )
                )
                .mockResolvedValue({ nextSequenceToken: 'some-other-seq' });

            loggerProxy.log('How is it going?');
            await loggerProxy.waitCompletion();
            // First attempt rejects (retryable), second succeeds
            expect(spyPublishLogEvent).toHaveBeenCalledTimes(2);
        });

        test('should swallow error on wait tracker failure', async () => {
            const spyWait = jest
                .spyOn<any, any>(loggerProxy['tracker'], 'waitCompletion')
                .mockRejectedValueOnce('some random error');
            loggerProxy.log('msg');
            const result = await loggerProxy.waitCompletion();
            expect(result).toBe(true);
            expect(spyWait).toHaveBeenCalledTimes(1);
        });

        test('logPublisherCount reflects number of registered publishers', () => {
            expect(loggerProxy.logPublisherCount).toBe(1); // cloudWatchLogger added in beforeEach
            loggerProxy.addLogPublisher(lambdaLogger);
            expect(loggerProxy.logPublisherCount).toBe(2);
        });

        test('markPending resets tracker done state', () => {
            loggerProxy.tracker.end();
            loggerProxy.markPending();
            expect(loggerProxy.tracker.done).toBe(false);
        });

        test('should log to fallbackLogger when retry also fails', async () => {
            // Covers log-delivery.ts:719-720 — fallbackLogger.log(retryErr) and tracker.addFailed()
            // when both the first attempt AND the retry throw.
            mockPutLogEvents
                .mockRejectedValueOnce(
                    sdkError(
                        'InvalidSequenceTokenException',
                        'The given sequenceToken is invalid. The next expected sequenceToken is: 49590338271490256608559692538361571095921575989136588898'
                    )
                )
                .mockRejectedValueOnce(new Error('retry also failed'));
            const fallbackLog = jest.fn();
            const proxy = new LoggerProxy({}, { log: fallbackLog });
            proxy.addLogPublisher(cloudWatchLogger);
            proxy.tracker.restart();
            proxy.log('test retry failure');
            await proxy.waitCompletion();
            expect(fallbackLog).toHaveBeenCalledWith(expect.any(Error));
        });

        test('should add failed when publishLogEvent throws a non-Error', async () => {
            // Covers log-delivery.ts:726 — tracker.addFailed() when non-Error is thrown
            spyPublishLogEvent.mockRejectedValueOnce('string-not-error');
            const proxy = new LoggerProxy({});
            proxy.addLogPublisher(cloudWatchLogger);
            proxy.tracker.restart();
            proxy.log('msg');
            await proxy.waitCompletion();
            // Non-Error caught — tracker records a failure but does not rethrow
            expect(spyPublishLogEvent).toHaveBeenCalledTimes(1);
        });

        test('should route tracker failure to injected fallbackLogger', async () => {
            const fallbackLog = jest.fn();
            const proxy = new LoggerProxy({}, { log: fallbackLog });
            jest.spyOn<any, any>(
                proxy['tracker'],
                'waitCompletion'
            ).mockRejectedValueOnce(new Error('tracker closed'));
            const result = await proxy.waitCompletion();
            expect(result).toBe(true);
            expect(fallbackLog).toHaveBeenCalledTimes(1);
        });
    });
});
