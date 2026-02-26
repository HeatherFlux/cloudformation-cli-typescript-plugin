/**
 * `cfn-ts submit` — package and register a CloudFormation resource type.
 *
 * @example
 * ```typescript
 * import { buildProject, createResourceZip, registerType } from '../submit';
 * ```
 */

export type { SubmitOptions, SubmitResult } from './types';
export type { CfnResourceSchemaWithHandlers } from './schema-ext';
export type { BuildOptions } from './build';
export type { RegisterOptions } from './register';

export { extractHandlerPermissions } from './schema-ext';
export { detectInstallCommand, validatePrerequisites, buildProject } from './build';
export { createResourceZip } from './zip';
export {
    getSubmitBucketName,
    ensureSubmitBucket,
    uploadHandlerPackage,
} from './bucket';
export {
    getExecutionRoleName,
    buildTrustPolicy,
    buildExecutionPolicy,
    ensureExecutionRole,
} from './role';
export { registerType, pollRegistration, setDefaultVersion } from './register';
