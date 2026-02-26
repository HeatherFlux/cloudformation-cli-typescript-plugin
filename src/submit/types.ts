/**
 * Shared types for the `cfn-ts submit` command.
 */

/** Options accepted by the top-level submit orchestrator. */
export interface SubmitOptions {
    /** Project root directory. */
    projectDir: string;
    /** Explicit path to the schema file (auto-detected if omitted). */
    schemaPath?: string;
    /** AWS region to register in. */
    region: string;
    /** Pre-existing execution role ARN. Mutually exclusive with `noRole`. */
    roleArn?: string;
    /** Skip execution role creation entirely. */
    noRole?: boolean;
    /** Set the newly registered version as default. */
    setDefault?: boolean;
    /** Build and package only — do not call any AWS APIs. */
    dryRun?: boolean;
    /** Use Docker for SAM build. */
    useDocker?: boolean;
}

/** Result of a successful type registration. */
export interface SubmitResult {
    /** CloudFormation registration token. */
    registrationToken: string;
    /** ARN of the registered type version (present when COMPLETE). */
    typeVersionArn?: string;
    /** Final registration status. */
    status: 'COMPLETE' | 'FAILED' | 'IN_PROGRESS';
    /** Status description (present when FAILED). */
    description?: string;
}
