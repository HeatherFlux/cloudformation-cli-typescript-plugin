# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **dual-language project** with two distinct components:

1. **TypeScript runtime library** (`src/`) — npm package `@extend/cfn-resource-cli` that resource providers depend on at runtime.
2. **Python plugin** (`python/rpdk/typescript/`) — pip package `cloudformation-cli-typescript-plugin` that integrates with the `cfn` CLI to scaffold and build TypeScript resource providers.

## Commands

### TypeScript Library

```bash
npm run build          # Compile TypeScript to dist/
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix lint issues
npm run test           # Run all Jest tests with coverage
npm pack               # Build + create .tgz for local installation
```

Run a single test file:
```bash
npx jest tests/lib/resource.test.ts
```

### Python Plugin

```bash
# Setup (recommended: use a venv)
python3 -m venv env && source env/bin/activate
pip3 install -e .

# Run all checks (mirrors CI)
pre-commit run --all-files

# Run only Python tests
pre-commit run pytest-local

# Or directly with pytest (from within venv)
pytest tests/plugin/
```

## Architecture

### TypeScript Library (`src/`)

- **`resource.ts`** — Core `BaseResource<T, TypeConfiguration>` abstract class. Implements two Lambda entry points:
  - `entrypoint()` — Production handler called by CloudFormation. Initializes CloudWatch/S3 logging and metrics, then dispatches to the appropriate action handler.
  - `testEntrypoint()` — Used for local SAM testing.
  - `handlerEvent(action)` — Decorator that registers a method as the handler for a specific `Action` (CREATE, READ, UPDATE, DELETE, LIST).

- **`proxy.ts`** — `SessionProxy` wraps AWS SDK v3 credentials into a typed client factory via `client<T>(ClientClass, options?)`. `ProgressEvent<T>` is the response type for all handlers, with static factory methods: `ProgressEvent.success()`, `ProgressEvent.failed()`, `ProgressEvent.progress()`.

- **`interface.ts`** — Core types: `Action`, `OperationStatus`, `HandlerErrorCode` enums; `BaseModel` and `BaseDto` base classes (use `class-transformer` `@Expose()`/`@Exclude()` decorators for serialization); `HandlerRequest`, `BaseResourceHandlerRequest`, `CfnResponse`.

- **`recast.ts`** — CloudFormation sends all primitive values as strings; `transformValue()` and `recastPrimitive()` convert them back to the types declared in the model class.

- **`log-delivery.ts`** — `CloudWatchLogPublisher`, `S3LogPublisher`, `LambdaLogPublisher`, and `LoggerProxy` (fan-out). Falls back from CloudWatch → S3 → Lambda console.

- **`metrics.ts`** — `MetricsPublisher` and `MetricsPublisherProxy` publish invocation count, duration, and exception metrics to CloudWatch.

### Python Plugin (`python/rpdk/typescript/`)

Registered as a `rpdk.v1.languages` entry point. When `cfn init` or `cfn generate` is run:

- **`codegen.py`** — `TypescriptLanguagePlugin` extends `rpdk.core.plugin_base.LanguagePlugin`. Key methods: `init()` scaffolds a new resource project using Jinja2 templates; `generate()` writes `src/models.ts` from the JSON schema; `package()` runs `npm install && sam build` and zips the output.
- **`templates/`** — Jinja2 templates rendered during `init` and `generate` (e.g., `handlers.ts`, `models.ts`, `package.json`, `template.yml`).
- **`resolver.py`** — Maps CloudFormation schema types to TypeScript types.
- **`utils.py`** — Escapes TypeScript reserved words for generated property names.

### Serialization Pattern

All DTOs extend `BaseDto` which uses `class-transformer`. Fields must be annotated with `@Expose()` to be included in serialization. `BaseDto.serialize()` drops `null` values to match Java SDK behavior. `BaseDto.deserialize()` uses `plainToInstance` with `excludeExtraneousValues: true`.

### Testing

- TypeScript tests are co-located with source in `tests/lib/` and match `*.test.ts`.
- Python tests live in `tests/plugin/`.
- Coverage thresholds: 70% branches, 80% statements (TypeScript); configured via `jest.config.cjs`.
- Test data fixtures are in `tests/data/`.

## Key Configuration Files

- `tsconfig.json` — Builds `src/` → `dist/`. Requires `experimentalDecorators` and `emitDecoratorMetadata` for `class-transformer` and `autobind-decorator`.
- `tsconfig.test.json` — Used by `ts-jest` for test compilation.
- `jest.config.cjs` — Jest config with `ts-jest` preset, 60s timeout, path alias `~/` → `src/`.
- `setup.cfg` — Python flake8, isort, and pytest configuration.
- `Pipfile` — Dev dependencies for Python; installs the plugin in editable mode.
