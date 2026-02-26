import {
    getSubmitBucketName,
    ensureSubmitBucket,
    uploadHandlerPackage,
} from '~/submit/bucket';
import {
    S3Client,
    HeadBucketCommand,
    CreateBucketCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'node:fs';

jest.mock('@aws-sdk/client-s3', () => {
    const actual = jest.requireActual('@aws-sdk/client-s3');
    return { ...actual, S3Client: jest.fn() };
});

jest.mock('node:fs', () => ({
    ...jest.requireActual('node:fs'),
    readFileSync: jest.fn(),
}));

describe('bucket utilities', () => {
    describe('getSubmitBucketName', () => {
        it('generates conventional name', () => {
            expect(getSubmitBucketName('us-east-1', '123456789012')).toBe(
                'cfn-submit-us-east-1-123456789012'
            );
        });
    });

    describe('ensureSubmitBucket', () => {
        let mockSend: jest.Mock;

        beforeEach(() => {
            mockSend = jest.fn();
            (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));
        });

        it('returns existing bucket without creating', async () => {
            mockSend.mockResolvedValue({}); // HeadBucket succeeds

            const s3 = new S3Client({});
            const name = await ensureSubmitBucket(s3, {
                region: 'us-east-1',
                accountId: '123',
            });
            expect(name).toBe('cfn-submit-us-east-1-123');
            expect(mockSend).toHaveBeenCalledTimes(1);
        });

        it('creates bucket when not found', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof HeadBucketCommand) {
                    const err = new Error('not found');
                    err.name = 'NotFound';
                    throw err;
                }
                if (cmd instanceof CreateBucketCommand) return {};
                throw new Error('unexpected');
            });

            const s3 = new S3Client({});
            const name = await ensureSubmitBucket(s3, {
                region: 'us-east-1',
                accountId: '123',
            });
            expect(name).toBe('cfn-submit-us-east-1-123');
        });

        it('does not pass LocationConstraint for us-east-1', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof HeadBucketCommand) {
                    const err = new Error('not found');
                    err.name = 'NotFound';
                    throw err;
                }
                if (cmd instanceof CreateBucketCommand) {
                    expect(cmd.input.CreateBucketConfiguration).toBeUndefined();
                    return {};
                }
                throw new Error('unexpected');
            });

            const s3 = new S3Client({});
            await ensureSubmitBucket(s3, { region: 'us-east-1', accountId: '123' });
        });

        it('passes LocationConstraint for non-us-east-1', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof HeadBucketCommand) {
                    const err = new Error('not found');
                    err.name = 'NotFound';
                    throw err;
                }
                if (cmd instanceof CreateBucketCommand) {
                    expect(
                        cmd.input.CreateBucketConfiguration?.LocationConstraint
                    ).toBe('eu-west-1');
                    return {};
                }
                throw new Error('unexpected');
            });

            const s3 = new S3Client({});
            await ensureSubmitBucket(s3, { region: 'eu-west-1', accountId: '123' });
        });

        it('throws on non-NotFound HeadBucket errors', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof HeadBucketCommand) {
                    const err = new Error('access denied');
                    err.name = 'AccessDenied';
                    throw err;
                }
                throw new Error('unexpected');
            });

            const s3 = new S3Client({});
            await expect(
                ensureSubmitBucket(s3, { region: 'us-east-1', accountId: '123' })
            ).rejects.toThrow('access denied');
        });

        it('throws on non-recoverable CreateBucket errors', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof HeadBucketCommand) {
                    const err = new Error('not found');
                    err.name = 'NotFound';
                    throw err;
                }
                if (cmd instanceof CreateBucketCommand) {
                    const err = new Error('illegal location');
                    err.name = 'IllegalLocationConstraintException';
                    throw err;
                }
                throw new Error('unexpected');
            });

            const s3 = new S3Client({});
            await expect(
                ensureSubmitBucket(s3, { region: 'us-east-1', accountId: '123' })
            ).rejects.toThrow('illegal location');
        });

        it('handles BucketAlreadyOwnedByYou', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof HeadBucketCommand) {
                    const err = new Error('not found');
                    err.name = 'NotFound';
                    throw err;
                }
                if (cmd instanceof CreateBucketCommand) {
                    const err = new Error('already owned');
                    err.name = 'BucketAlreadyOwnedByYou';
                    throw err;
                }
                throw new Error('unexpected');
            });

            const s3 = new S3Client({});
            const name = await ensureSubmitBucket(s3, {
                region: 'us-east-1',
                accountId: '123',
            });
            expect(name).toBe('cfn-submit-us-east-1-123');
        });
    });

    describe('uploadHandlerPackage', () => {
        let mockSend: jest.Mock;

        beforeEach(() => {
            mockSend = jest.fn().mockResolvedValue({});
            (S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));
        });

        it('uploads zip to S3 with correct key pattern', async () => {
            (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('zip-data'));

            const s3 = new S3Client({});
            const result = await uploadHandlerPackage(
                s3,
                'my-bucket',
                '/tmp/handler.zip',
                'My::Svc::Res'
            );

            expect(result.bucket).toBe('my-bucket');
            expect(result.key).toMatch(/^my-svc-res\/\d+\/ResourceProvider\.zip$/);

            const cmd = mockSend.mock.calls[0][0];
            expect(cmd).toBeInstanceOf(PutObjectCommand);
            expect(cmd.input.Bucket).toBe('my-bucket');
        });
    });
});
