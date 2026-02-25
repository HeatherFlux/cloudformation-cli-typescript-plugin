# CloudFormation CLI TypeScript Plugin

[![NPM version](https://img.shields.io/npm/v/@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib)](https://www.npmjs.com/package/@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib)
[![Node.js version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

TypeScript runtime library and native code generator for CloudFormation resource providers.

This package ships two things in one:

| Component | Description |
|-----------|-------------|
| **Runtime library** | `@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib` — the npm package your Lambda handler depends on at runtime |
| **`cfn-ts` CLI** | Native TypeScript code generator — scaffolds new resource providers and regenerates `src/models.ts` from your schema, **no Python required** |

---

## Quick start (native TypeScript, no Python)

```bash
npm install -g @amazon-web-services-cloudformation/cloudformation-cli-typescript-lib
```

### Scaffold a new resource provider

```bash
cfn-ts init --type-name Org::Service::Resource
cd org-service-resource
npm install
```

This creates a fully wired TypeScript project:

```
org-service-resource/
├── org-service-resource.json   # CloudFormation resource schema
├── src/
│   ├── handlers.ts             # Your handler implementations (CREATE, READ, UPDATE, DELETE, LIST)
│   └── models.ts               # Generated — do not edit
├── package.json
├── tsconfig.json
├── template.yml                # SAM template for local testing
└── Makefile
```

### Implement your handlers

Edit `src/handlers.ts`. Each handler follows this pattern:

```typescript
import { Action, BaseResource, handlerEvent, OperationStatus,
         ProgressEvent, ResourceModel, SessionProxy } from './models';
import type { Dict } from '@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib';

const resource = new Resource(ResourceModel.TYPE_NAME, ResourceModel, null, null, TypeConfigurationModel);
export const entrypoint = resource.entrypoint;
export const testEntrypoint = resource.testEntrypoint;

resource.addHandler(Action.Create, async (
    session: SessionProxy,
    request: ResourceHandlerRequest<ResourceModel>,
    callbackContext: Dict,
): Promise<ProgressEvent<ResourceModel>> => {
    const model = request.desiredResourceState ?? new ResourceModel();
    // ... your logic
    return ProgressEvent.success<ProgressEvent<ResourceModel>>(model);
});
```

### Regenerate models after schema changes

```bash
cfn-ts generate
```

Reads the schema file in the current directory and overwrites `src/models.ts`.

### Test locally with SAM

```bash
sam local invoke --event sam-tests/create.json TypeFunction
```

### Build and submit

```bash
npm run build
cfn submit --dry-run
```

---

## Using the AWS SDK v3 in handlers

The `SessionProxy` provides pre-configured AWS SDK v3 clients using the credentials CloudFormation passes at invocation time:

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = session.client(S3Client);
await s3.send(new PutObjectCommand({ Bucket: '...', Key: '...', Body: '...' }));
```

---

## Runtime library API

### `BaseResource<T, TypeConfiguration>`

Abstract base class. Implement by registering handlers with `addHandler()` or the `@handlerEvent` decorator:

```typescript
class Resource extends BaseResource<ResourceModel, TypeConfigurationModel> {
    @handlerEvent(Action.Create)
    async create(session, request, callbackContext, logger, typeConfig): Promise<ProgressEvent<ResourceModel>> {
        // ...
    }
}
```

### `ProgressEvent<T>`

The return type of all handlers:

```typescript
ProgressEvent.success(model)                          // operation complete
ProgressEvent.failed(HandlerErrorCode.NotFound, msg)  // error
ProgressEvent.progress(model, callbackContext)        // IN_PROGRESS (async)
```

### `SessionProxy`

```typescript
session.client(CloudWatchClient)        // returns a ready-to-use AWS SDK v3 client
session.client(S3Client, { region })    // with config overrides
```

---

## Development

### TypeScript library

```bash
npm run build       # compile src/ → dist/
npm run lint        # ESLint
npm test            # Jest (244 tests, ~97% coverage)
```

### Python plugin (legacy, optional)

The Python plugin integrates with the upstream `cfn` CLI. It is only needed if you use the `cfn` CLI directly rather than `cfn-ts`.

```bash
python3 -m venv env && source env/bin/activate
pip3 install -e .
pre-commit run --all-files   # lint + test
pre-commit run pytest-local  # Python tests only
```

---

## Architecture

```
src/
├── resource.ts       BaseResource — handler dispatch, entrypoints
├── proxy.ts          SessionProxy, ProgressEvent
├── interface.ts      Core types: Action, OperationStatus, HandlerErrorCode, BaseModel
├── log-delivery.ts   CloudWatchLogPublisher, S3LogPublisher, LambdaLogPublisher
├── metrics.ts        MetricsPublisher (invocation count, duration, exceptions)
├── recast.ts         CloudFormation string → typed value coercions
├── utils.ts          Queue, ProgressTracker, deepFreeze
└── codegen/
    ├── resolver.ts   CfnResourceSchema → ResolvedModels type map
    ├── translate.ts  ResolvedType → TypeScript type string
    ├── generate-models.ts    models.ts code generation
    ├── generate-handlers.ts  handlers.ts scaffold generation
    └── generate-scaffold.ts  package.json, tsconfig, SAM template, etc.

src/bin/
└── cfn-ts.ts         CLI entry point (generate + init commands)

python/rpdk/typescript/
└── codegen.py        Python plugin for cfn CLI (legacy)
```

---

## License

Apache 2.0
