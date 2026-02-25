# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- [Support Library] Native TypeScript code generator (`src/codegen/`) — TypeScript port of the Python plugin's Jinja2 template pipeline. Includes `resolveModels()`, `generateModels()`, `generateHandlers()`, and full scaffold generators. No Python or Jinja2 required.
- [Support Library] `cfn-ts` CLI binary — native `generate` and `init` commands that work without the Python `cloudformation-cli`. Run `cfn-ts generate` to regenerate `src/models.ts` from a resource schema, or `cfn-ts init --type-name Org::Svc::Resource` to scaffold a new project.
- [CLI Plugin] `_validate_build_prerequisites()` — pre-flight check before the build subprocess. Validates that `npm`, `node` (≥ 20), and `sam` (when using the default build command) are available on PATH, surfacing clear `DownstreamError` messages instead of cryptic subprocess failures.
- [CLI Plugin] `data/support-lib-version.txt` — single source of truth for the npm support library version used in generated `package.json` files. Update this file (e.g. `echo 'X.Y.Z' > ...`) when bumping the npm package version; the Python plugin reads it dynamically at load time.

### Fixed
- [Support Library] Removed unused `mockSendResult` export from `tests/lib/helpers.ts` (dead code never imported by any test file).
- [Support Library] `parseRequest` and `parseTestRequest` non-`Error` catch branches now covered — paths that throw `InvalidRequest` / `InternalFailure` with `'Unknown error parsing event'` / `'Unknown error parsing request'` when a non-Error value is thrown inside the try block.
- [Support Library] Prettier formatting corrected in `tests/lib/codegen.test.ts` and `tests/lib/log-delivery.test.ts`.
- [CLI Plugin] Test coverage for `codegen.py` raised from 97% to **100%**: added tests for `_load_support_lib_version` OSError fallback, `generate()` with `configuration_schema`, `_recursive_relative_write` directory-entry skip branch, `_make_build_command` default path, `_validate_build_prerequisites` `CalledProcessError` and unparseable-version-string paths.

### Changed
- [Support Library] Enable `strictNullChecks: true` across the entire codebase. Null/undefined handling is now fully type-safe throughout `src/` and `tests/lib/`.
- [CLI Plugin] `SUPPORT_LIB_VERSION` is now read dynamically from `data/support-lib-version.txt` instead of being hardcoded in `codegen.py`. The existing CI sync-test also validates the data file.

### Fixed
- [Support Library] Replace all untyped `resource['privateField']` bracket-notation accesses in tests with a typed `asTestable(resource)` helper (see `tests/lib/helpers.ts`). Tested private methods are now `protected` in `BaseResource`; tests use the public subclass API.
- [Support Library] Convert direct `prototype.publishMessage = mock` assignments in tests to `jest.spyOn().mockImplementation()` so Jest properly restores them after each test (no prototype mutation leak).
- [Support Library] Remove Java `serialVersionUID` constant from `BaseHandlerException` — unused in TypeScript, caused a precision-loss lint warning (the literal exceeds `Number.MAX_SAFE_INTEGER`).
- [Support Library] Tighten `BaseHandlerException` constructor `message` param: `any` → `string`.
- [Support Library] Tighten `Function` type annotations to precise signatures: `toModeled()` uses `(data: Dict|null|undefined) => T|null`; `typeConfigurationTypeReference.deserialize` uses `(data: Dict|null|undefined) => TypeConfiguration|null`. Also updated `BaseDto.deserialize` signature to declare the null/undefined it already handles.
- [Support Library] `MetricsPublisher.publishExceptionMetric/publishInvocationMetric/publishDurationMetric/publishLogDeliveryExceptionMetric` return `Promise<void>` instead of `Promise<any>`.
- [Support Library] `ProgressEvent.progress()` and `ProgressEvent.success()` model/ctx params typed as `BaseModel|null` and `Dict|null` instead of `any`.
- [Support Library] ESLint `no-unused-vars` rule configured with `argsIgnorePattern`/`varsIgnorePattern: '^_'` to recognize the underscore-prefix convention for intentionally unused parameters.
- [Support Library] `Logger.log` interface and all internal `log()` implementations (`LoggerProxy`, `CloudWatchLogPublisher`, `S3LogHelper`, `MetricsPublisher`, `BaseResource`) now use `unknown` instead of `any` for message/params — more precise types that still accept all values.
- [Support Library] `Queue<void>` explicit type annotation on `CloudWatchLogPublisher.queue` eliminates the implicit `unknown` return type mismatch with `Promise<void>`.
- [Support Library] ESLint `no-explicit-any` disabled for `tests/**/*.ts` — test files legitimately use `jest.spyOn<any,any>` for private method spying and `null as any` for error-path testing; blanket disable is cleaner than 86 per-line suppressions.

---

## [2.0.0] - 2026-02-25
_CLI Plugin: v1.0.5_

### Breaking Changes
- **[Support Library] Migrate from AWS SDK v2 to AWS SDK v3** (`aws-sdk` → `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-s3`). The `aws-sdk` v2 package is no longer a peer or dev dependency.
- **[Support Library] `SessionProxy.client()` signature changed** — now a generic factory `client<T>(ClientClass: new (config) => T, options?)` for AWS SDK v3 clients, replacing the v2 `ExtendedClient`-based `client(name, options)` method.
- **[Support Library] `AwsTaskWorkerPool` removed** — the `workerPool` constructor parameter on `BaseResource`, `MetricsPublisher`, `CloudWatchLogPublisher`, `CloudWatchLogHelper`, `S3LogPublisher`, and `S3LogHelper` has been removed. Pass `null` or omit for backward compatibility (the parameter is now accepted but ignored via `_workerPool?: unknown`).
- **[Support Library] `ServiceProperties`, `InstanceProperties`, `OverloadedArguments`, `OverloadedReturnType` type exports removed** from `interface.ts` (were AWS SDK v2-specific).

### Added
- [CLI Plugin] Python 3.12 and 3.13 classifier support
- [Support Library] `RetryableLogError` class — a proper `Error` subclass (`readonly retryable = true`) that replaces the SDK v2 `err.retryable` mutation pattern for distinguishing retryable log delivery failures.
- [Support Library] `ClientConfig` interface exported from `proxy.ts` — typed AWS SDK v3 client configuration (`credentials?: AwsCredentialIdentity, region?: string`).

### Changed
- [CLI Plugin] Drop Python 3.7 compatibility shim — use `zipfile` from the standard library directly (removes `zipfile38` dependency)
- [CLI Plugin] Remove legacy `useDocker` camelCase key from `.rpdk-config` settings on `init` to avoid stale config accumulation
- [Support Library] `LoggerProxy` now stores `InspectOptions` on the instance instead of mutating `inspect.defaultOptions` global state
- [Support Library] Replace `format()` with `formatWithOptions()` in `LoggerProxy.log()` to respect per-instance inspect options
- [Support Library] Add `markPending()` method to `LoggerProxy` to encapsulate tracker state mutation
- [Support Library] Remove redundant `Queue` wrapper from `MetricsPublisherProxy` (direct `await` is equivalent and clearer)
- [Support Library] `LoggerProxy` now accepts an optional `fallbackLogger` constructor parameter (defaults to `console`) so internal errors route through the log pipeline instead of bypassing the credential filter chain via `console.error`
- [Support Library] Add `BaseResource.handlerFor(action)` public method to retrieve a registered handler by action
- [Support Library] Add `LoggerProxy.logPublisherCount` public getter to expose number of registered publishers
- [Support Library] Convert remaining `@ts-ignore` to `@ts-expect-error` with descriptions; remove SDK v2 suppressions that are no longer needed
- [Support Library] Improve remaining-time handling in entrypoint error path — wait for actual remaining Lambda time instead of a fixed 2 s delay
- [Support Library] Error code detection uses `err.name` (SDK v3 convention) throughout — no longer checks deprecated `err.code` (SDK v2 convention)

### Fixed
- [CLI Plugin] `contains_model()` resolver now correctly recurses into `SET` and `DICT` container types, not just `LIST` — prevents wrong decorators in generated models
- [CLI Plugin] Remove unused `const client` variable from generated `handlers.ts` template that caused TypeScript compiler errors in every generated project
- [CLI Plugin] Generated `handlers.ts` now uses `BaseResource<ResourceModel, TypeConfigurationModel>` (both generic type parameters) for proper TypeConfiguration type safety
- [CLI Plugin] Remove `@ts-ignore` comment and unnecessary non-null assertion (`!`) from resource instantiation in generated template
- [CLI Plugin] Remove `(this as any)` casts from generated `models.ts` template
- [Support Library] Fix wrong log message: S3 bucket not found logged "does exist" instead of "does not exist"
- [Support Library] Remove duplicate `emitMetricsForLoggingFailure` call in `CloudWatchLogPublisher` that double-counted log delivery failures
- [Support Library] Remove empty `try { } catch (err) { throw err; }` wrapper in `S3LogHelper.createFolder()` (no-op re-throw)
- [Support Library] Fix `HandlerErrorCode` type cast in `BaseHandlerException` constructor (`as keyof typeof HandlerErrorCode`)
- [Support Library] Fix division-by-zero in `ProgressTracker.message` when no tasks have been submitted (reported `NaN%` or `Infinity%`)
- [Support Library] Replace `string.prototype.replaceall` polyfill with native `String.prototype.replaceAll` (Node ≥ 15 / modern V8)

### Removed
- [CLI Plugin] Remove `zipfile38` Python dependency (Python 3.8+ standard library is sufficient)
- [Support Library] Remove `string.prototype.replaceall` npm dependency
- [Support Library] Remove `aws-sdk` v2 peer and dev dependency
- [Support Library] Remove `worker-pool-aws-sdk` dev dependency

---

## [1.0.6] - 2024-05-31
_CLI Plugin: v1.0.4_

### Added
- [Support Library] Node.js 20 runtime support (#124)

### Changed
- [Support Library] Cleanup package lifecycle code and tests (#127)

---

## [1.0.5] - 2023-10-26
_CLI Plugin: v1.0.3_

### Security
- [Support Library] Stop logging raw CloudFormation event data to reduce risk of credential/secret exposure in logs (#117)

### Changed
- [CLI Plugin] Update Node.js runtime in generated SAM template from `nodejs14.x` to `nodejs18.x` (#106)

---

## [1.0.4] - 2023-02-24
_CLI Plugin: v1.0.2_

### Fixed
- [Support Library] Unable to serialize arrays with unique items (Set container type) (#98)

---

## [1.0.3] - 2022-08-16

### Changed
- [Support Library] Version bump

---

## [1.0.2] - 2022-08-05
_CLI Plugin: v1.0.1_

### Added
- [CLI Plugin] TypeConfiguration support — `cfn init` now scaffolds `TypeConfigurationModel` and wires it through to handlers (#67)
- [CLI Plugin] `--no-docker` CLI switch to build without Docker (#90)
- [CLI Plugin] `--typescript` language selection switch in `cfn init` (#76)

### Fixed
- [CLI Plugin] `cfn submit` now uses the Windows-compatible CLI path on Windows (#77)

---

## [1.0.1] - 2021-04-08

### Changed
- [Support Library] Migrate to `aws-cloudformation` organization; rename npm package to `@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib`
- [Support Library] Update to Apache 2.0 license

---

## [0.5.0] - 2020-12-02
### Added
- [Support Library] Queue to avoid throttling of internal AWS API calls (#30)
- [Support Library] Optional use of worker threads for performance reasons (#30)

### Changed
- [Support Library] Increase default options for util inspect so that deep objects are also printed (#27)
- [Support Library] Expose the model type reference in the resource class (#27)

### Fixed
- [Support Library] Expired security token when logging config enabled (#31) (#30)

## [0.4.0] - 2020-10-11
### Added
- [Support Library] Pass a logger interface to the handlers (#26)
- [Support Library] Scrub sensitive information when logging (#26)

### Changed
- [Support Library] Make the input data (`callbackContext` and `request`) immutable (#26)

### Fixed
- [CLI Plugin] Avoid zip error by using less strict timestamp check (#26)


## [0.3.3] - 2020-09-23
### Changed
- [CLI Plugin] Update CloudFormation CLI dependency package (#25)
- [Support Library] Make certain request fields optional to unblock contract testing (#25)
- [Support Library] Update optional dependency to newer AWS SDK Javascript used in Lambda runtime (#25)


## [0.3.2] - 2020-08-31
### Added
- [CLI Plugin] Wildcard .gitignore pattern in case rpdk.log rotates
- [Support Library] New properties for resource request: `desiredResourceTags`, `previousResourceTags`, `systemTags`, `awsAccountId`, `region` and `awsPartition` (#23)

### Removed
- [Support Library] Account ID from metric namespace


## [0.3.1] - 2020-08-19
### Fixed
- [Support Library] Cast from empty string to number or boolean (#12) (#22)


## [0.3.0] - 2020-08-09
### Added
- [CLI Plugin] Primary and additional identifiers can be retrieved using the appropriate methods in base model class (#18)
- [Support Library] Recast properties from string to intended primitive type based on model (#9) (#18)
- [Support Library] New wrapper class for integer types (simplification from bigint) (#18)

### Changed
- [CLI Plugin] Improve model serialization/deserialization to handle complex schemas (#18)
- [Support Library] While leveraging `class-transformer` library, the properties can now be cast into proper types (#18)

### Removed
- [Support Library] Global definitions and auxiliary code extending ES6 Map (#18)


## [0.2.1] - 2020-07-14
### Fixed
- [Support Library] Callback context not being properly formatted (#15) (#16)


## [0.2.0] - 2020-07-08
### Added
- [Support Library] Support protocol version 2.0.0 to response the handler result with callback directly and allow CloudFormation service to orchestrate the callback (#12) (#13)


## [0.1.2] - 2020-05-25
### Fixed
- [Support Library] Error messages not appearing in CloudWatch (#10) (#11)


## [0.1.1] - 2020-05-02
### Fixed
- [Support Library] Event handler binding issue (#7)


## [0.1.0] - 2020-04-24
### Added
- [Support Library] Schedule CloudWatch Events for re-invocation during long process
- [Support Library] Publish metrics to CloudWatch

### Changed
- [Support Library] Fallback to S3 in log delivery

### Fixed
- [Support Library] CloudWatch log delivery issue


## [0.0.1] - 2020-04-14
### Added
- [CLI Plugin] Initial version in line with [Python plugin](https://github.com/aws-cloudformation/cloudformation-cli-python-plugin) (#2)
- [CLI Plugin] Build using SAM CLI (both locally or with docker support) (#2)
- [Support Library] Callback in order to report progress to CloudFormation (#2)
- [Support Library] Mechanism for log delivery to CloudWatch (#2)
- [Support Library] Base Model class as well as Progress Event class (#2)


[Unreleased]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.5.0...v1.0.1
[0.5.0]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/aws-cloudformation/cloudformation-cli-typescript-plugin/releases/tag/v0.0.1
