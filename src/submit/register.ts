/**
 * CloudFormation type registration for `cfn-ts submit`.
 */

import {
    CloudFormationClient,
    RegisterTypeCommand,
    DescribeTypeRegistrationCommand,
    SetTypeDefaultVersionCommand,
} from '@aws-sdk/client-cloudformation';
import type { SubmitResult } from './types';

export interface RegisterOptions {
    typeName: string;
    schemaBody: string;
    s3Bucket: string;
    s3Key: string;
    executionRoleArn?: string;
}

/**
 * Call CloudFormation `RegisterType` API.
 * Returns the registration token for polling.
 */
export async function registerType(
    cfn: CloudFormationClient,
    options: RegisterOptions
): Promise<string> {
    const result = await cfn.send(
        new RegisterTypeCommand({
            Type: 'RESOURCE',
            TypeName: options.typeName,
            SchemaHandlerPackage: `s3://${options.s3Bucket}/${options.s3Key}`,
            ExecutionRoleArn: options.executionRoleArn,
        })
    );

    if (!result.RegistrationToken) {
        throw new Error('RegisterType did not return a registration token.');
    }
    return result.RegistrationToken;
}

/**
 * Poll `DescribeTypeRegistration` until status is COMPLETE or FAILED.
 *
 * @param pollIntervalMs  Milliseconds between polls (default 5000).
 * @param timeoutMs       Maximum wait time (default 600000 = 10 minutes).
 */
export async function pollRegistration(
    cfn: CloudFormationClient,
    registrationToken: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number; onPoll?: () => void }
): Promise<SubmitResult> {
    const timeout = options?.timeoutMs ?? 600_000;
    const interval = options?.pollIntervalMs ?? 5_000;
    const started = Date.now();

    while (true) {
        const resp = await cfn.send(
            new DescribeTypeRegistrationCommand({
                RegistrationToken: registrationToken,
            })
        );

        const status = resp.ProgressStatus as SubmitResult['status'];

        if (status === 'COMPLETE' || status === 'FAILED') {
            return {
                registrationToken,
                typeVersionArn: resp.TypeVersionArn,
                status,
                description: resp.Description,
            };
        }

        if (Date.now() - started > timeout) {
            return {
                registrationToken,
                status: 'IN_PROGRESS',
                description: `Timed out after ${timeout / 1000}s. Registration token: ${registrationToken}`,
            };
        }

        options?.onPoll?.();
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
}

/**
 * Set a type version as the default.
 */
export async function setDefaultVersion(
    cfn: CloudFormationClient,
    typeVersionArn: string
): Promise<void> {
    await cfn.send(new SetTypeDefaultVersionCommand({ Arn: typeVersionArn }));
}
