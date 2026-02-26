/**
 * S3 bucket management for `cfn-ts submit`.
 *
 * Ensures the upload bucket exists and uploads the handler package.
 */

import {
    S3Client,
    CreateBucketCommand,
    HeadBucketCommand,
    PutObjectCommand,
    type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import * as fs from 'node:fs';

/**
 * Derive the conventional bucket name for handler uploads.
 */
export function getSubmitBucketName(region: string, accountId: string): string {
    return `cfn-submit-${region}-${accountId}`;
}

/**
 * Ensure the S3 bucket exists. Creates it if it doesn't.
 * Returns the bucket name.
 */
export async function ensureSubmitBucket(
    s3: S3Client,
    options: { region: string; accountId: string }
): Promise<string> {
    const bucketName = getSubmitBucketName(options.region, options.accountId);

    try {
        await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
        return bucketName;
    } catch (e) {
        if (!(e instanceof Error) || e.name !== 'NotFound') {
            // Bucket exists but we can't access it, or some other error
            if (e instanceof Error && e.name !== 'NoSuchBucket') {
                throw e;
            }
        }
    }

    // Create the bucket
    const createParams: {
        Bucket: string;
        CreateBucketConfiguration?: { LocationConstraint: BucketLocationConstraint };
    } = { Bucket: bucketName };
    // us-east-1 must NOT have a LocationConstraint (AWS API quirk)
    if (options.region !== 'us-east-1') {
        createParams.CreateBucketConfiguration = {
            LocationConstraint: options.region as BucketLocationConstraint,
        };
    }

    try {
        await s3.send(new CreateBucketCommand(createParams));
    } catch (e) {
        // Bucket already exists (race condition or owned by us)
        if (
            e instanceof Error &&
            (e.name === 'BucketAlreadyOwnedByYou' || e.name === 'BucketAlreadyExists')
        ) {
            return bucketName;
        }
        throw e;
    }

    return bucketName;
}

/**
 * Upload the handler package ZIP to S3.
 * Returns the bucket and key for use in `RegisterType`.
 */
export async function uploadHandlerPackage(
    s3: S3Client,
    bucketName: string,
    zipPath: string,
    typeName: string
): Promise<{ bucket: string; key: string }> {
    const key = `${typeName.replace(/::/g, '-').toLowerCase()}/${Date.now()}/ResourceProvider.zip`;
    const body = fs.readFileSync(zipPath);

    await s3.send(
        new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: body,
        })
    );

    return { bucket: bucketName, key };
}
