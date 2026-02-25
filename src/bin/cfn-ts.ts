#!/usr/bin/env node
/**
 * cfn-ts — Native TypeScript CLI for CloudFormation resource provider development.
 *
 * A TypeScript-native alternative to `cfn generate` / `cfn init` that works
 * without the Python cloudformation-cli. Reads CloudFormation resource provider
 * schemas and generates TypeScript source files.
 *
 * Usage:
 *   cfn-ts generate [--schema <path>] [--output <dir>]
 *   cfn-ts init --type-name <Org::Svc::Res> [--output <dir>]
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
    generateSamTemplate,
    generateSamTestCreate,
    generateTsConfig,
    resolveModels,
} from '../codegen';
import type { CfnResourceSchema } from '../codegen';

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

// ---------------------------------------------------------------------------
// Help and version
// ---------------------------------------------------------------------------

function printHelp(): void {
    const name = c.bold('cfn-ts');
    log(`
${name} — Native TypeScript CLI for CloudFormation resource provider development

${c.bold('USAGE')}
  cfn-ts generate [options]   Regenerate src/models.ts from the resource schema
  cfn-ts init     [options]   Scaffold a new resource provider project
  cfn-ts --help               Show this help message
  cfn-ts --version            Show version

${c.bold('GENERATE OPTIONS')}
  --schema  <path>   Path to the schema file (auto-detected if omitted)
  --output  <dir>    Project root directory (default: current directory)

${c.bold('INIT OPTIONS')}
  --type-name <Org::Svc::Res>  CloudFormation type name (required)
  --output    <dir>            Project root directory (default: current directory)

${c.bold('EXAMPLES')}
  cfn-ts init --type-name My::Bucket::Resource
  cfn-ts generate
  cfn-ts generate --schema my-bucket-resource.json --output ./my-project
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
}

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2); // remove 'node' and script path
    const result: ParsedArgs = {
        output: process.cwd(),
        help: false,
        version: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            result.help = true;
        } else if (arg === '--version' || arg === '-v') {
            result.version = true;
        } else if (arg === '--schema') {
            result.schema = args[++i];
        } else if (arg === '--output') {
            result.output = path.resolve(args[++i]);
        } else if (arg === '--type-name') {
            result.typeName = args[++i];
        } else if (!arg.startsWith('-') && !result.command) {
            result.command = arg;
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
    const args = parseArgs(process.argv);

    if (args.version) {
        printVersion();
        process.exit(0);
    }

    if (args.help || !args.command) {
        printHelp();
        process.exit(0);
    }

    try {
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

            default:
                err(`Unknown command: ${args.command}`);
                printHelp();
                process.exit(1);
        }
    } catch (e) {
        err(e instanceof Error ? e.message : String(e));
        process.exit(1);
    }
}

main();
