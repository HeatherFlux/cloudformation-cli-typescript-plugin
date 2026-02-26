/**
 * Generate project scaffold files for a new CloudFormation resource provider.
 *
 * TypeScript equivalents of the Jinja2 templates and static data files in
 * `python/rpdk/typescript/templates/` and `python/rpdk/typescript/data/`.
 */

/** Options for scaffold generation. */
export interface ScaffoldOptions {
    /** The support library package name (e.g., `@acme/cfn-lib`). */
    libName: string;
    /** The support library version constraint (e.g., `^2.0.0`). */
    libVersion: string;
    /** The CloudFormation type name, e.g. `"Org::Service::Resource"`. */
    typeName: string;
    /**
     * The hyphenated project name derived from the type name,
     * e.g. `"org-service-resource"`.
     */
    projectName: string;
    /** The Lambda entrypoint, e.g. `"dist/handlers.entrypoint"`. */
    entrypoint: string;
    /** The test Lambda entrypoint, e.g. `"dist/handlers.testEntrypoint"`. */
    testEntrypoint: string;
    /** The Lambda runtime identifier, e.g. `"nodejs20.x"`. */
    runtime: string;
    /** The SAM CodeUri (defaults to `"./"`).. */
    codeUri?: string;
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

/**
 * Generate the `package.json` for a new resource provider project.
 * The generated file references the support library and standard dev deps.
 */
export function generatePackageJson(options: ScaffoldOptions): string {
    const { libName, libVersion, typeName, projectName } = options;

    const pkg = {
        name: projectName,
        version: '0.1.0',
        description: `AWS custom resource provider named ${typeName}.`,
        private: true,
        main: 'dist/handlers.js',
        files: ['dist'],
        scripts: {
            build: 'npx tsc --skipLibCheck',
            prepack: 'npm run build',
            test: 'echo "Error: no test specified" && exit 1',
        },
        dependencies: {
            [libName]: libVersion,
            'class-transformer': '0.5.1',
        },
        devDependencies: {
            '@types/node': '^20.0.0',
            typescript: '^5.7.0',
        },
    };

    return JSON.stringify(pkg, null, 4) + '\n';
}

// ---------------------------------------------------------------------------
// tsconfig.json
// ---------------------------------------------------------------------------

/** Generate the `tsconfig.json` for a new resource provider project. */
export function generateTsConfig(): string {
    const config = {
        compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            noImplicitAny: true,
            alwaysStrict: true,
            esModuleInterop: true,
            moduleResolution: 'node',
            allowJs: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            outDir: 'dist',
        },
        include: ['src/**/*.ts'],
        exclude: ['node_modules'],
    };

    return JSON.stringify(config, null, 4) + '\n';
}

// ---------------------------------------------------------------------------
// template.yml (SAM)
// ---------------------------------------------------------------------------

/** Generate the SAM `template.yml` for a new resource provider project. */
export function generateSamTemplate(options: ScaffoldOptions): string {
    const { typeName, entrypoint, testEntrypoint, runtime, codeUri = './' } = options;

    return `AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: AWS SAM template for the ${typeName} resource type

Globals:
  Function:
    Timeout: 180  # docker start-up times can be long for SAM CLI
    MemorySize: 256

Resources:
  TestEntrypoint:
    Type: AWS::Serverless::Function
    Properties:
      Handler: ${testEntrypoint}
      Runtime: ${runtime}
      CodeUri: ${codeUri}

  TypeFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: ${entrypoint}
      Runtime: ${runtime}
      CodeUri: ${codeUri}
    Metadata:
      BuildMethod: makefile
`;
}

// ---------------------------------------------------------------------------
// Makefile
// ---------------------------------------------------------------------------

/** Generate the `Makefile` for a new resource provider project. */
export function generateMakefile(): string {
    // Note: Makefile targets must use a real tab character for indentation.
    // SAM sets $(ARTIFACTS_DIR) to the build output path.
    // The Makefile must install deps, compile, and copy artifacts there.
    return [
        'build-TypeFunction:',
        '\t@if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \\',
        '\telif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \\',
        '\telif [ -f package-lock.json ]; then npm ci; \\',
        '\telse npm install; fi',
        '\tnpm run build',
        '\tcp -r dist $(ARTIFACTS_DIR)/',
        '\tcp -r node_modules $(ARTIFACTS_DIR)/',
        '\tcp package.json $(ARTIFACTS_DIR)/',
        '',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// .samignore
// ---------------------------------------------------------------------------

/** Generate the `.samignore` for SAM CLI to exclude from CopySource. */
export function generateSamIgnore(): string {
    return `# Exclude large / unnecessary directories from SAM build CopySource
node_modules/
build/
dist/
coverage/
.aws-sam/
*.tgz
`;
}

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

/** Generate the `README.md` for a new resource provider project. */
export function generateReadme(options: ScaffoldOptions): string {
    const { typeName, libName } = options;

    return `# ${typeName}

Congratulations on starting development! Next steps:

1. Write the JSON schema describing your resource.
2. Implement your resource handlers in [handlers.ts](./src/handlers.ts)

> Don't modify [models.ts](./src/models.ts) by hand — any modifications will be overwritten when the \`generate\` or \`package\` commands are run.

Implement CloudFormation resource here. Each handler must always return a \`ProgressEvent\`.

\`\`\`typescript
const progress = ProgressEvent.builder<ProgressEvent<ResourceModel>>()

    // Required
    // Must be one of OperationStatus.InProgress, OperationStatus.Failed, OperationStatus.Success
    .status(OperationStatus.InProgress)
    // Required on SUCCESS (except for LIST where resourceModels is required)
    // The current resource model after the operation; instance of ResourceModel class
    .resourceModel(model)
    .resourceModels(null)
    // Required on FAILED
    // Customer-facing message, displayed in e.g. CloudFormation stack events
    .message('')
    // Required on FAILED a HandlerErrorCode
    .errorCode(HandlerErrorCode.InternalFailure)
    // Optional
    // Use to store any state between re-invocation via IN_PROGRESS
    .callbackContext({})
    // Required on IN_PROGRESS
    // The number of seconds to delay before re-invocation
    .callbackDelaySeconds(0)

    .build()
\`\`\`

While importing the [${libName}](https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin) library, failures can be passed back to CloudFormation by either raising an exception from \`exceptions\`, or setting the ProgressEvent's \`status\` to \`OperationStatus.Failed\` and \`errorCode\` to one of \`HandlerErrorCode\`. There is a static helper function, \`ProgressEvent.failed\`, for this common case.

Keep in mind, during runtime all logs will be delivered to CloudWatch if you use the \`log()\` method from \`LoggerProxy\` class.
`;
}

// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------

/** Generate the `.gitignore` for a new resource provider project. */
export function generateGitignore(): string {
    return `# Dependency directory
node_modules/
dist/
build/
coverage/
.build/

# Build artifacts
*.js.map
*.d.ts

# Environment files
.env
.env.local

# IDE files
.idea/
.vscode/
*.swp
*.swo

# CloudFormation CLI
.cfn-metadata.json
`;
}

// ---------------------------------------------------------------------------
// .npmrc
// ---------------------------------------------------------------------------

/** Generate the `.npmrc` for a new resource provider project. */
export function generateNpmrc(): string {
    return 'optional=true\n';
}

// ---------------------------------------------------------------------------
// sam-tests/create.json
// ---------------------------------------------------------------------------

/** Generate the default SAM test payload for create operations. */
export function generateSamTestCreate(_options: ScaffoldOptions): string {
    const payload = {
        credentials: {
            accessKeyId: 'test-access-key-000000000000',
            secretAccessKey: 'test-secret-key-00000000000000000000',
            sessionToken:
                'test-session-token-000000000000000000000000000000000000000000000000',
        },
        action: 'CREATE',
        request: {
            clientRequestToken: 'ecba020e-b2e6-4742-a7d0-8a06ae7c4b2b',
            desiredResourceState: {},
            previousResourceState: null,
            logicalResourceIdentifier: null,
        },
        callbackContext: null,
    };

    return JSON.stringify(payload, null, 4) + '\n';
}
