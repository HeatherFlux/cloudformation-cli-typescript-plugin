import { registerType, pollRegistration, setDefaultVersion } from '~/submit/register';
import {
    CloudFormationClient,
    RegisterTypeCommand,
    SetTypeDefaultVersionCommand,
} from '@aws-sdk/client-cloudformation';

jest.mock('@aws-sdk/client-cloudformation', () => {
    const actual = jest.requireActual('@aws-sdk/client-cloudformation');
    return { ...actual, CloudFormationClient: jest.fn() };
});

describe('register', () => {
    let mockSend: jest.Mock;

    beforeEach(() => {
        mockSend = jest.fn();
        (CloudFormationClient as jest.Mock).mockImplementation(() => ({
            send: mockSend,
        }));
    });

    describe('registerType', () => {
        it('returns registration token on success', async () => {
            mockSend.mockResolvedValue({ RegistrationToken: 'tok-123' });

            const cfn = new CloudFormationClient({});
            const token = await registerType(cfn, {
                typeName: 'My::Svc::Res',
                schemaBody: '{}',
                s3Bucket: 'bucket',
                s3Key: 'key.zip',
                executionRoleArn: 'arn:aws:iam::123:role/exec',
            });
            expect(token).toBe('tok-123');
        });

        it('passes correct S3 URI to RegisterType', async () => {
            mockSend.mockResolvedValue({ RegistrationToken: 'tok' });

            const cfn = new CloudFormationClient({});
            await registerType(cfn, {
                typeName: 'My::Svc::Res',
                schemaBody: '{}',
                s3Bucket: 'my-bucket',
                s3Key: 'path/to/handler.zip',
            });

            const cmd = mockSend.mock.calls[0][0];
            expect(cmd).toBeInstanceOf(RegisterTypeCommand);
            expect(cmd.input.SchemaHandlerPackage).toBe(
                's3://my-bucket/path/to/handler.zip'
            );
        });

        it('throws when no registration token returned', async () => {
            mockSend.mockResolvedValue({});

            const cfn = new CloudFormationClient({});
            await expect(
                registerType(cfn, {
                    typeName: 'My::Svc::Res',
                    schemaBody: '{}',
                    s3Bucket: 'b',
                    s3Key: 'k',
                })
            ).rejects.toThrow('registration token');
        });
    });

    describe('pollRegistration', () => {
        it('returns immediately on COMPLETE', async () => {
            mockSend.mockResolvedValue({
                ProgressStatus: 'COMPLETE',
                TypeVersionArn: 'arn:cfn:type:v1',
            });

            const cfn = new CloudFormationClient({});
            const result = await pollRegistration(cfn, 'tok-123');
            expect(result.status).toBe('COMPLETE');
            expect(result.typeVersionArn).toBe('arn:cfn:type:v1');
        });

        it('returns immediately on FAILED', async () => {
            mockSend.mockResolvedValue({
                ProgressStatus: 'FAILED',
                Description: 'Schema invalid',
            });

            const cfn = new CloudFormationClient({});
            const result = await pollRegistration(cfn, 'tok-123');
            expect(result.status).toBe('FAILED');
            expect(result.description).toBe('Schema invalid');
        });

        it('polls until COMPLETE', async () => {
            let calls = 0;
            mockSend.mockImplementation(() => {
                calls++;
                if (calls < 3) {
                    return { ProgressStatus: 'IN_PROGRESS' };
                }
                return {
                    ProgressStatus: 'COMPLETE',
                    TypeVersionArn: 'arn:cfn:type:v1',
                };
            });

            const cfn = new CloudFormationClient({});
            const result = await pollRegistration(cfn, 'tok-123', {
                pollIntervalMs: 10,
            });
            expect(result.status).toBe('COMPLETE');
            expect(calls).toBe(3);
        });

        it('times out when registration stays IN_PROGRESS', async () => {
            mockSend.mockResolvedValue({ ProgressStatus: 'IN_PROGRESS' });

            const cfn = new CloudFormationClient({});
            const result = await pollRegistration(cfn, 'tok-123', {
                timeoutMs: 50,
                pollIntervalMs: 10,
            });
            expect(result.status).toBe('IN_PROGRESS');
            expect(result.description).toContain('Timed out');
        });

        it('calls onPoll callback', async () => {
            let calls = 0;
            mockSend.mockImplementation(() => {
                calls++;
                if (calls < 2) return { ProgressStatus: 'IN_PROGRESS' };
                return { ProgressStatus: 'COMPLETE', TypeVersionArn: 'arn' };
            });

            const onPoll = jest.fn();
            const cfn = new CloudFormationClient({});
            await pollRegistration(cfn, 'tok', { pollIntervalMs: 10, onPoll });
            expect(onPoll).toHaveBeenCalled();
        });
    });

    describe('setDefaultVersion', () => {
        it('sends SetTypeDefaultVersionCommand', async () => {
            mockSend.mockResolvedValue({});

            const cfn = new CloudFormationClient({});
            await setDefaultVersion(cfn, 'arn:cfn:type:v1');

            expect(mockSend).toHaveBeenCalledTimes(1);
            const cmd = mockSend.mock.calls[0][0];
            expect(cmd).toBeInstanceOf(SetTypeDefaultVersionCommand);
            expect(cmd.input.Arn).toBe('arn:cfn:type:v1');
        });
    });
});
