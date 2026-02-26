#!/usr/bin/env node
/**
 * cfn-ts — Native TypeScript CLI for CloudFormation resource provider development.
 *
 * A TypeScript-native alternative to the Python `cfn` CLI. Handles the full
 * lifecycle: init, generate, and submit — all without Python.
 *
 * Usage:
 *   cfn-ts init     --type-name <Org::Svc::Res> [--output <dir>]
 *   cfn-ts generate [--schema <path>] [--output <dir>]
 *   cfn-ts submit   [--set-default] [--region <region>] [--dry-run]
 *   cfn-ts --help
 *   cfn-ts --version
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    generateHandlers,
    generateGitignore,
    generateMakefile,
    generateModels,
    generateNpmrc,
    generatePackageJson,
    generateReadme,
    generateSamIgnore,
    generateSamTemplate,
    generateSamTestCreate,
    generateTsConfig,
    resolveModels,
} from '../codegen';
import type { CfnResourceSchema } from '../codegen';

import {
    buildProject,
    createResourceZip,
    ensureSubmitBucket,
    uploadHandlerPackage,
    extractHandlerPermissions,
    ensureExecutionRole,
    registerType,
    pollRegistration,
    setDefaultVersion,
} from '../submit';
import type { CfnResourceSchemaWithHandlers } from '../submit';

import { S3Client } from '@aws-sdk/client-s3';
import { IAMClient } from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORT_LIB_NAME =
    '@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib';
const SUPPORT_LIB_VERSION = '^2.0.0';
const RUNTIME = 'nodejs20.x';
const ENTRY_POINT = 'dist/handlers.entrypoint';
const TEST_ENTRY_POINT = 'dist/handlers.testEntrypoint';
const CODE_URI = './';

/** Delay (ms) after IAM role creation before calling RegisterType. */
const IAM_PROPAGATION_DELAY = 10_000;

// ---------------------------------------------------------------------------
// ANSI colour helpers (no external deps)
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;
const c = {
    green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
    yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
    cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
    bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
    dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
    red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
};

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
    process.stdout.write(msg + '\n');
}

function ok(msg: string): void {
    log(`  ${c.green('✓')} ${msg}`);
}

function skip(msg: string): void {
    log(`  ${c.dim('–')} ${msg} ${c.dim('(skipped — already exists)')}`);
}

function err(msg: string): void {
    process.stderr.write(`${c.red('error')} ${msg}\n`);
}

// ---------------------------------------------------------------------------
// File writing (safe vs overwrite)
// ---------------------------------------------------------------------------

/**
 * Write a file only if it does not already exist.
 * Returns true if written, false if skipped.
 */
function safeWrite(filePath: string, content: string): boolean {
    if (fs.existsSync(filePath)) {
        skip(path.relative(process.cwd(), filePath));
        return false;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    ok(path.relative(process.cwd(), filePath));
    return true;
}

/**
 * Always overwrite a file (used for generated code that must stay in sync
 * with the schema).
 */
function overwrite(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    ok(path.relative(process.cwd(), filePath));
}

// ---------------------------------------------------------------------------
// Schema discovery
// ---------------------------------------------------------------------------

/**
 * Find the resource schema file in the given directory.
 *
 * Strategy:
 * 1. Use the explicitly provided path if given.
 * 2. Find any `.json` file in `dir` that has a `typeName` field.
 * 3. Also check `.rpdk-config` for a `artifact-type` / `settings.schema` hint.
 */
function findSchema(dir: string, explicit?: string): string {
    if (explicit) {
        const resolved = path.resolve(dir, explicit);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Schema file not found: ${resolved}`);
        }
        return resolved;
    }

    // Scan for JSON files with a typeName field (skip package.json, tsconfig, etc.)
    const candidates = fs
        .readdirSync(dir)
        .filter(
            (f) => f.endsWith('.json') && f !== 'package.json' && f !== 'tsconfig.json'
        )
        .map((f) => path.join(dir, f))
        .filter((f) => {
            try {
                const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
                return typeof parsed.typeName === 'string';
            } catch {
                return false;
            }
        });

    if (candidates.length === 0) {
        throw new Error(
            'No schema file found. Create a resource schema JSON file or use --schema <path>.'
        );
    }
    if (candidates.length > 1) {
        throw new Error(
            `Multiple schema files found: ${candidates.join(
                ', '
            )}. Use --schema <path> to specify.`
        );
    }
    return candidates[0];
}

// ---------------------------------------------------------------------------
// Type name helpers
// ---------------------------------------------------------------------------

function typeNameToProjectName(typeName: string): string {
    return typeName.toLowerCase().replace(/::/g, '-');
}

function validateTypeName(typeName: string): void {
    if (!/^[A-Za-z0-9]+::[A-Za-z0-9]+::[A-Za-z0-9]+$/.test(typeName)) {
        throw new Error(
            `Invalid type name "${typeName}". Expected format: Org::Service::Resource`
        );
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `cfn-ts generate` — regenerate `src/models.ts` from the resource schema.
 *
 * This is the equivalent of `cfn generate` but runs natively in Node.js.
 */
function cmdGenerate(opts: { schema?: string; output: string }): void {
    log(c.bold('\ncfn-ts generate'));
    log(c.dim('─'.repeat(40)));

    const schemaPath = findSchema(opts.output, opts.schema);
    log(`  Schema: ${c.cyan(path.relative(process.cwd(), schemaPath))}`);

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as CfnResourceSchema;

    // Optionally load a type configuration schema
    let extraModels: ReturnType<typeof resolveModels> | undefined;
    const typeConfigPath = path.join(opts.output, '.rpdk-config');
    if (fs.existsSync(typeConfigPath)) {
        try {
            const rpdk = JSON.parse(fs.readFileSync(typeConfigPath, 'utf8'));
            if (rpdk.typeConfiguration) {
                const configSchema = rpdk.typeConfiguration as CfnResourceSchema;
                extraModels = resolveModels(configSchema, 'TypeConfigurationModel');
            }
        } catch {
            // ignore — type configuration is optional
        }
    }

    const models = resolveModels(schema);
    if (!extraModels) {
        // Always emit an empty TypeConfigurationModel if no config schema was provided
        extraModels = { TypeConfigurationModel: {} };
    }
    Object.assign(models, extraModels);

    const source = generateModels({
        libName: SUPPORT_LIB_NAME,
        typeName: schema.typeName,
        models,
        primaryIdentifier: schema.primaryIdentifier ?? [],
        additionalIdentifiers: schema.additionalIdentifiers ?? [],
    });

    const outPath = path.join(opts.output, 'src', 'models.ts');
    overwrite(outPath, source);

    log(c.green('\n  Generation complete.\n'));
}

/**
 * `cfn-ts init` — scaffold a new resource provider project.
 *
 * Creates all project files in the target directory. Existing files are
 * skipped (not overwritten), so it is safe to re-run.
 */
function cmdInit(opts: { typeName: string; output: string }): void {
    const { typeName, output } = opts;
    validateTypeName(typeName);
    const projectName = typeNameToProjectName(typeName);

    log(c.bold('\ncfn-ts init'));
    log(c.dim('─'.repeat(40)));
    log(`  Type:    ${c.cyan(typeName)}`);
    log(`  Project: ${c.cyan(projectName)}`);
    log(`  Output:  ${c.cyan(output)}`);
    log('');

    const scaffoldOpts = {
        libName: SUPPORT_LIB_NAME,
        libVersion: SUPPORT_LIB_VERSION,
        typeName,
        projectName,
        entrypoint: ENTRY_POINT,
        testEntrypoint: TEST_ENTRY_POINT,
        runtime: RUNTIME,
        codeUri: CODE_URI,
    };

    // Create src/ directory
    fs.mkdirSync(path.join(output, 'src'), { recursive: true });
    fs.mkdirSync(path.join(output, 'sam-tests'), { recursive: true });

    // Scaffold files (safe — won't overwrite existing)
    safeWrite(path.join(output, '.gitignore'), generateGitignore());
    safeWrite(path.join(output, '.npmrc'), generateNpmrc());
    safeWrite(path.join(output, '.samignore'), generateSamIgnore());
    safeWrite(path.join(output, 'package.json'), generatePackageJson(scaffoldOpts));
    safeWrite(path.join(output, 'tsconfig.json'), generateTsConfig());
    safeWrite(path.join(output, 'template.yml'), generateSamTemplate(scaffoldOpts));
    safeWrite(path.join(output, 'Makefile'), generateMakefile());
    safeWrite(path.join(output, 'README.md'), generateReadme(scaffoldOpts));
    safeWrite(
        path.join(output, 'sam-tests', 'create.json'),
        generateSamTestCreate(scaffoldOpts)
    );
    safeWrite(
        path.join(output, 'src', 'handlers.ts'),
        generateHandlers({ libName: SUPPORT_LIB_NAME, typeName })
    );

    // Create a minimal empty schema if none exists
    const schemaPath = path.join(output, `${projectName}.json`);
    if (!fs.existsSync(schemaPath)) {
        const minimalSchema: CfnResourceSchema = {
            typeName,
            description: `Schema for ${typeName}`,
            properties: {
                Id: {
                    type: 'string',
                    description: 'The primary identifier for this resource.',
                },
            },
            primaryIdentifier: ['/properties/Id'],
            additionalProperties: false,
        };
        safeWrite(schemaPath, JSON.stringify(minimalSchema, null, 4) + '\n');
    } else {
        skip(path.relative(process.cwd(), schemaPath));
    }

    // Generate initial models.ts from the schema
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as CfnResourceSchema;
    const models = resolveModels(schema);
    models['TypeConfigurationModel'] = {};

    const modelsSource = generateModels({
        libName: SUPPORT_LIB_NAME,
        typeName: schema.typeName,
        models,
        primaryIdentifier: schema.primaryIdentifier ?? [],
        additionalIdentifiers: schema.additionalIdentifiers ?? [],
    });
    overwrite(path.join(output, 'src', 'models.ts'), modelsSource);

    log(c.green('\n  Initialisation complete.'));
    log(c.dim(`  Next steps:`));
    log(
        c.dim(
            `    1. Edit ${path.relative(
                process.cwd(),
                schemaPath
            )} to define your resource`
        )
    );
    log(c.dim(`    2. Run ${c.bold('cfn-ts generate')} to regenerate src/models.ts`));
    log(c.dim(`    3. Implement your handlers in src/handlers.ts`));
    log('');
}

/**
 * `cfn-ts submit` — build, package, and register a CloudFormation resource type.
 */
async function cmdSubmit(opts: {
    schema?: string;
    output: string;
    setDefault?: boolean;
    roleArn?: string;
    noRole?: boolean;
    region: string;
    dryRun?: boolean;
    useDocker?: boolean;
}): Promise<void> {
    log(c.bold('\ncfn-ts submit'));
    log(c.dim('─'.repeat(40)));

    // Validate mutual exclusion
    if (opts.roleArn && opts.noRole) {
        throw new Error('--role-arn and --no-role are mutually exclusive.');
    }

    // Step 1: Find and validate schema
    const schemaPath = findSchema(opts.output, opts.schema);
    const schema = JSON.parse(
        fs.readFileSync(schemaPath, 'utf8')
    ) as CfnResourceSchemaWithHandlers;
    validateTypeName(schema.typeName);

    log(`  Schema:  ${c.cyan(path.relative(process.cwd(), schemaPath))}`);
    log(`  Type:    ${c.cyan(schema.typeName)}`);
    log(`  Region:  ${c.cyan(opts.region)}`);
    log('');

    // Step 2: Build
    log(c.bold('  Building...'));
    buildProject({ projectDir: opts.output, useDocker: opts.useDocker });
    ok('Build complete');

    // Step 3: Create ZIP
    const buildDir = path.join(opts.output, 'build', 'TypeFunction');
    const zipPath = path.join(opts.output, 'build', 'ResourceProvider.zip');
    createResourceZip(buildDir, zipPath);
    const zipSize = fs.statSync(zipPath).size;
    ok(`Package created (${(zipSize / 1024 / 1024).toFixed(1)} MB)`);

    if (opts.dryRun) {
        log(c.green('\n  Dry run complete. Package created but not registered.'));
        log(`  Package: ${c.cyan(path.relative(process.cwd(), zipPath))}\n`);
        return;
    }

    // Step 4: Get account ID
    const sts = new STSClient({ region: opts.region });
    let accountId: string;
    try {
        const identity = await sts.send(new GetCallerIdentityCommand({}));
        accountId = identity.Account!;
    } catch (e) {
        throw new Error(
            'AWS credentials not configured. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, ' +
                'configure ~/.aws/credentials, or assume a role first.\n' +
                (e instanceof Error ? `  Cause: ${e.message}` : '')
        );
    }
    log(`  Account: ${c.cyan(accountId)}`);

    // Step 5: Upload to S3
    log(c.bold('\n  Uploading to S3...'));
    const s3 = new S3Client({ region: opts.region });
    const bucketName = await ensureSubmitBucket(s3, {
        region: opts.region,
        accountId,
    });
    const { bucket, key } = await uploadHandlerPackage(
        s3,
        bucketName,
        zipPath,
        schema.typeName
    );
    ok(`Uploaded to s3://${bucket}/${key}`);

    // Step 6: Execution role
    let executionRoleArn: string | undefined;
    let roleCreated = false;

    if (opts.roleArn) {
        executionRoleArn = opts.roleArn;
        ok(`Using role: ${c.cyan(executionRoleArn)}`);
    } else if (!opts.noRole) {
        const permissions = extractHandlerPermissions(schema);
        if (permissions.length === 0) {
            log(
                `  ${c.yellow('!')} No handler permissions in schema — skipping role creation.`
            );
        } else {
            log(c.bold('\n  Creating execution role...'));
            const iam = new IAMClient({ region: opts.region });
            executionRoleArn = await ensureExecutionRole(iam, {
                typeName: schema.typeName,
                permissions,
            });
            ok(`Execution role: ${c.cyan(executionRoleArn)}`);
            roleCreated = true;
        }
    }

    // Wait for IAM propagation if we just created a role
    if (roleCreated) {
        log(
            `  ${c.dim(
                `Waiting ${IAM_PROPAGATION_DELAY / 1000}s for IAM role propagation...`
            )}`
        );
        await new Promise((r) => setTimeout(r, IAM_PROPAGATION_DELAY));
    }

    // Step 7: Register type
    log(c.bold('\n  Registering type...'));
    const cfn = new CloudFormationClient({ region: opts.region });
    const registrationToken = await registerType(cfn, {
        typeName: schema.typeName,
        schemaBody: JSON.stringify(schema),
        s3Bucket: bucket,
        s3Key: key,
        executionRoleArn,
    });
    log(`  Token:   ${c.dim(registrationToken)}`);

    // Step 8: Poll for completion
    log('  Waiting for registration to complete...');
    const result = await pollRegistration(cfn, registrationToken, {
        onPoll: () => process.stdout.write(c.dim('.')),
    });
    log(''); // newline after dots

    if (result.status === 'FAILED') {
        throw new Error(
            `Registration failed: ${result.description ?? 'unknown error'}`
        );
    }

    if (result.status === 'IN_PROGRESS') {
        log(
            c.yellow(
                `\n  Registration still in progress. Track with:\n` +
                    `  aws cloudformation describe-type-registration --registration-token ${registrationToken}\n`
            )
        );
        return;
    }

    ok(`Registered: ${c.cyan(result.typeVersionArn ?? '')}`);

    // Step 9: Set default version
    if (opts.setDefault && result.typeVersionArn) {
        await setDefaultVersion(cfn, result.typeVersionArn);
        ok('Set as default version');
    }

    log(c.green('\n  Submit complete.\n'));
}

// ---------------------------------------------------------------------------
// Help and version
// ---------------------------------------------------------------------------

function printHelp(): void {
    const name = c.bold('cfn-ts');
    log(`
${name} — Native TypeScript CLI for CloudFormation resource provider development

${c.bold('USAGE')}
  cfn-ts init     [options]   Scaffold a new resource provider project
  cfn-ts generate [options]   Regenerate src/models.ts from the resource schema
  cfn-ts submit   [options]   Build, package, and register the resource type
  cfn-ts --help               Show this help message
  cfn-ts --version            Show version

${c.bold('INIT OPTIONS')}
  --type-name <Org::Svc::Res>  CloudFormation type name (required)
  --output    <dir>            Project root directory (default: current directory)

${c.bold('GENERATE OPTIONS')}
  --schema  <path>   Path to the schema file (auto-detected if omitted)
  --output  <dir>    Project root directory (default: current directory)

${c.bold('SUBMIT OPTIONS')}
  --schema      <path>     Path to the schema file (auto-detected if omitted)
  --output      <dir>      Project root directory (default: current directory)
  --region      <region>   AWS region (default: AWS_REGION env or us-east-1)
  --role-arn    <arn>       Use an existing IAM execution role
  --no-role                Skip execution role creation
  --set-default            Set registered version as the default
  --dry-run                Build and package only — do not call AWS APIs
  --use-docker             Use Docker for SAM build

${c.bold('EXAMPLES')}
  cfn-ts init --type-name My::Bucket::Resource
  cfn-ts generate
  cfn-ts generate --schema my-bucket-resource.json --output ./my-project
  cfn-ts submit --set-default --region us-east-1
  cfn-ts submit --dry-run
  cfn-ts submit --role-arn arn:aws:iam::123456789:role/MyRole --set-default
`);
}

function printVersion(): void {
    // Read version from the package.json next to the compiled output
    try {
        const pkgPath = path.join(__dirname, '..', '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        log(pkg.version ?? 'unknown');
    } catch {
        log('unknown');
    }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
    command?: string;
    schema?: string;
    output: string;
    typeName?: string;
    help: boolean;
    version: boolean;
    // Submit flags
    setDefault?: boolean;
    roleArn?: string;
    noRole?: boolean;
    region: string;
    dryRun?: boolean;
    useDocker?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2); // remove 'node' and script path
    const result: ParsedArgs = {
        output: process.cwd(),
        help: false,
        version: false,
        region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    };

    const requireValue = (flag: string, i: number): string => {
        const next = args[i + 1];
        if (next === undefined || next.startsWith('-')) {
            throw new Error(`${flag} requires a value.`);
        }
        return next;
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            result.help = true;
        } else if (arg === '--version' || arg === '-v') {
            result.version = true;
        } else if (arg === '--schema') {
            result.schema = requireValue('--schema', i);
            i++;
        } else if (arg === '--output') {
            result.output = path.resolve(requireValue('--output', i));
            i++;
        } else if (arg === '--type-name') {
            result.typeName = requireValue('--type-name', i);
            i++;
        } else if (arg === '--set-default') {
            result.setDefault = true;
        } else if (arg === '--role-arn') {
            result.roleArn = requireValue('--role-arn', i);
            i++;
        } else if (arg === '--no-role') {
            result.noRole = true;
        } else if (arg === '--region') {
            result.region = requireValue('--region', i);
            i++;
        } else if (arg === '--dry-run') {
            result.dryRun = true;
        } else if (arg === '--use-docker') {
            result.useDocker = true;
        } else if (!arg.startsWith('-') && !result.command) {
            result.command = arg;
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    if (args.version) {
        printVersion();
        process.exit(0);
    }

    if (args.help || !args.command) {
        printHelp();
        process.exit(0);
    }

    switch (args.command) {
        case 'generate':
            cmdGenerate({ schema: args.schema, output: args.output });
            break;

        case 'init':
            if (!args.typeName) {
                err(
                    '--type-name is required for init. Example: --type-name My::Svc::Resource'
                );
                process.exit(1);
            }
            cmdInit({ typeName: args.typeName, output: args.output });
            break;

        case 'submit':
            await cmdSubmit({
                schema: args.schema,
                output: args.output,
                setDefault: args.setDefault,
                roleArn: args.roleArn,
                noRole: args.noRole,
                region: args.region,
                dryRun: args.dryRun,
                useDocker: args.useDocker,
            });
            break;

        default:
            err(`Unknown command: ${args.command}`);
            printHelp();
            process.exit(1);
    }
}

main().catch((e) => {
    err(e instanceof Error ? e.message : String(e));
    process.exit(1);
});
