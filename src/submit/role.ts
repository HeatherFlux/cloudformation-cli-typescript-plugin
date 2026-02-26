/**
 * IAM execution role management for `cfn-ts submit`.
 *
 * Creates (or finds) the execution role that CloudFormation assumes
 * when invoking resource handler functions.
 */

import {
    IAMClient,
    CreateRoleCommand,
    PutRolePolicyCommand,
    GetRoleCommand,
} from '@aws-sdk/client-iam';

/**
 * Derive the execution role name from the type name.
 * Truncated to 64 chars (IAM role name limit).
 */
export function getExecutionRoleName(typeName: string): string {
    const base = `cfn-${typeName.replace(/::/g, '-').toLowerCase()}-exec-role`;
    return base.slice(0, 64);
}

/** Build the trust policy allowing CloudFormation to assume the role. */
export function buildTrustPolicy(): object {
    return {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Principal: {
                    Service: 'resources.cloudformation.amazonaws.com',
                },
                Action: 'sts:AssumeRole',
            },
        ],
    };
}

/** Build the inline policy from handler permissions. */
export function buildExecutionPolicy(permissions: string[]): object {
    return {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Action: permissions,
                Resource: '*',
            },
        ],
    };
}

/**
 * Create the execution role if it doesn't exist, and attach/update
 * the inline policy with handler permissions. Returns the role ARN.
 */
export async function ensureExecutionRole(
    iam: IAMClient,
    options: { typeName: string; permissions: string[] }
): Promise<string> {
    const roleName = getExecutionRoleName(options.typeName);
    const policyName = `${roleName}-policy`;
    let roleArn: string;

    try {
        const existing = await iam.send(new GetRoleCommand({ RoleName: roleName }));
        roleArn = existing.Role!.Arn!;
    } catch (e) {
        if (!(e instanceof Error) || e.name !== 'NoSuchEntityException') {
            throw e;
        }

        // Create the role
        const created = await iam.send(
            new CreateRoleCommand({
                RoleName: roleName,
                AssumeRolePolicyDocument: JSON.stringify(buildTrustPolicy()),
                Description: `CloudFormation execution role for ${options.typeName}`,
            })
        );
        roleArn = created.Role!.Arn!;
    }

    // Always upsert the inline policy to match current schema permissions
    await iam.send(
        new PutRolePolicyCommand({
            RoleName: roleName,
            PolicyName: policyName,
            PolicyDocument: JSON.stringify(buildExecutionPolicy(options.permissions)),
        })
    );

    return roleArn;
}
