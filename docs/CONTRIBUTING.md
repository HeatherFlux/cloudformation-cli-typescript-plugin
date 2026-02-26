# Contributing Guide

### Setup

```bash
nvm use && pnpm install
```

### Commands

- Build: `pnpm build`
- Run all tests: `pnpm test`
- Run specific test: `pnpm jest tests/lib/resource.test.ts`
- Run tests with coverage: `pnpm test:coverage`
- Lint: `pnpm lint`
- Lint fix: `pnpm lint:fix`
- Typecheck: `pnpm typecheck`
- Format: `pnpm format`

### Python plugin (legacy)

```bash
python3 -m venv env && source env/bin/activate
pip3 install -e .
pytest tests/plugin/
```

### Common Packages

- `@aws-sdk/client-*`: AWS SDK v3 clients (CloudWatch, CloudWatch Logs, S3)
- `class-transformer`: Model serialization/deserialization via decorators
- `jest`, `ts-jest`: Testing framework
- `eslint`, `prettier`: Linting and formatting

### Project Structure

```
src/
├── index.ts           # Package entry point
├── resource.ts        # BaseResource — handler dispatch, Lambda entrypoints
├── proxy.ts           # SessionProxy, ProgressEvent
├── interface.ts       # Core types: Action, OperationStatus, HandlerErrorCode, BaseModel
├── log-delivery.ts    # CloudWatch/S3/Lambda log publishers
├── metrics.ts         # CloudWatch metrics publisher
├── exceptions.ts      # Typed exception hierarchy (14 HandlerErrorCode subclasses)
├── recast.ts          # CloudFormation string → typed value coercions
├── utils.ts           # Queue, ProgressTracker, deepFreeze
├── health-check.ts    # CI wiring health check
├── codegen/           # Native TypeScript code generator
│   ├── resolver.ts    # Schema → ResolvedModels type map
│   ├── translate.ts   # ResolvedType → TypeScript type strings
│   ├── generate-*.ts  # models.ts, handlers.ts, scaffold generators
│   └── schema.ts      # CloudFormation schema type definitions
└── bin/
    └── cfn-ts.ts      # CLI: generate and init commands

tests/lib/             # TypeScript tests (Jest)
tests/plugin/          # Python tests (pytest)
python/rpdk/typescript/  # Python plugin for cfn CLI (legacy)
```

### Naming Conventions

- Files: kebab-case.ts (e.g., `log-delivery.ts`)
- Tests: `tests/lib/<source-file>.test.ts`
- Functions/variables: camelCase
- Classes/types: PascalCase
- Enums: PascalCase members (e.g., `Action.Create`)
