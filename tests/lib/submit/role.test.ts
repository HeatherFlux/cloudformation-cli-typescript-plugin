import {
    getExecutionRoleName,
    buildTrustPolicy,
    buildExecutionPolicy,
    ensureExecutionRole,
} from '~/submit/role';
import {
    IAMClient,
    GetRoleCommand,
    CreateRoleCommand,
    PutRolePolicyCommand,
} from '@aws-sdk/client-iam';

jest.mock('@aws-sdk/client-iam', () => {
    const actual = jest.requireActual('@aws-sdk/client-iam');
    return { ...actual, IAMClient: jest.fn() };
});

describe('role utilities', () => {
    describe('getExecutionRoleName', () => {
        it('converts type name to role name', () => {
            expect(getExecutionRoleName('My::Svc::Resource')).toBe(
                'cfn-my-svc-resource-exec-role'
            );
        });

        it('truncates to 64 chars', () => {
            const longName =
                'Org::VeryLongServiceNameThatExceedsLimits::VeryLongResourceName';
            expect(getExecutionRoleName(longName).length).toBeLessThanOrEqual(64);
        });
    });

    describe('buildTrustPolicy', () => {
        it('returns valid trust policy for CloudFormation', () => {
            const policy = buildTrustPolicy() as any;
            expect(policy.Version).toBe('2012-10-17');
            expect(policy.Statement).toHaveLength(1);
            expect(policy.Statement[0].Principal.Service).toBe(
                'resources.cloudformation.amazonaws.com'
            );
            expect(policy.Statement[0].Action).toBe('sts:AssumeRole');
        });
    });

    describe('buildExecutionPolicy', () => {
        it('creates policy with given permissions', () => {
            const policy = buildExecutionPolicy([
                's3:GetObject',
                's3:PutObject',
            ]) as any;
            expect(policy.Version).toBe('2012-10-17');
            expect(policy.Statement[0].Action).toEqual([
                's3:GetObject',
                's3:PutObject',
            ]);
            expect(policy.Statement[0].Resource).toBe('*');
        });
    });

    describe('ensureExecutionRole', () => {
        let mockSend: jest.Mock;

        beforeEach(() => {
            mockSend = jest.fn();
            (IAMClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));
        });

        it('reuses existing role', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof GetRoleCommand) {
                    return { Role: { Arn: 'arn:aws:iam::123:role/existing' } };
                }
                if (cmd instanceof PutRolePolicyCommand) return {};
                throw new Error('unexpected');
            });

            const iam = new IAMClient({});
            const arn = await ensureExecutionRole(iam, {
                typeName: 'My::Svc::Res',
                permissions: ['s3:GetObject'],
            });
            expect(arn).toBe('arn:aws:iam::123:role/existing');
        });

        it('creates role when it does not exist', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof GetRoleCommand) {
                    const err = new Error('not found');
                    err.name = 'NoSuchEntityException';
                    throw err;
                }
                if (cmd instanceof CreateRoleCommand) {
                    return { Role: { Arn: 'arn:aws:iam::123:role/new-role' } };
                }
                if (cmd instanceof PutRolePolicyCommand) return {};
                throw new Error('unexpected');
            });

            const iam = new IAMClient({});
            const arn = await ensureExecutionRole(iam, {
                typeName: 'My::Svc::Res',
                permissions: ['s3:GetObject'],
            });
            expect(arn).toBe('arn:aws:iam::123:role/new-role');
        });

        it('throws on unexpected GetRole errors', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof GetRoleCommand) {
                    const err = new Error('access denied');
                    err.name = 'AccessDeniedException';
                    throw err;
                }
                throw new Error('unexpected');
            });

            const iam = new IAMClient({});
            await expect(
                ensureExecutionRole(iam, {
                    typeName: 'My::Svc::Res',
                    permissions: ['s3:GetObject'],
                })
            ).rejects.toThrow('access denied');
        });

        it('always upserts inline policy', async () => {
            mockSend.mockImplementation((cmd) => {
                if (cmd instanceof GetRoleCommand) {
                    return { Role: { Arn: 'arn:aws:iam::123:role/existing' } };
                }
                if (cmd instanceof PutRolePolicyCommand) {
                    expect(cmd.input.PolicyName).toContain('-policy');
                    return {};
                }
                throw new Error('unexpected');
            });

            const iam = new IAMClient({});
            await ensureExecutionRole(iam, {
                typeName: 'My::Svc::Res',
                permissions: ['s3:GetObject'],
            });
            expect(mockSend).toHaveBeenCalledTimes(2); // GetRole + PutRolePolicy
        });
    });
});
