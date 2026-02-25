# Comprehensive Refactor & Cleanup Guide

Deep audit of every source file, test, and template. Issues are grouped by category with exact file references and actionable fixes.

---

## Status

### ✅ Completed (PR: Quick Wins + Critical Bug Fixes)
BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07
CQ-03, CQ-04, CQ-08
DEP-02
PY-01
TMPL-01, TMPL-02, TMPL-03

### ✅ Completed (PR: Dep Updates + Code Quality Pass 2)
A1 uuid v9, A2 TypeScript 5.7, A3 npm engine, A4 Python classifiers
BUG-08, CQ-02, INC-02, TEST-02

### ✅ Completed (PR: Code Quality Pass 3)
CQ-05, CQ-07, CQ-09, INC-01
PY-05
TEST-03, TEST-04, TEST-05, TEST-06

### 🔬 Investigated — Do NOT Implement
INC-04 — reflect-metadata removal is unsafe (see correction in §2)

### ✅ Completed (this branch: bugfix/arch-1058-fix-dependency-and-python)
INC-03 (CHANGELOG updated through v1.0.6; diff links fixed to canonical repo)
CQ-06 (LoggerProxy.fallbackLogger constructor param; console.error replaced; test added)
TEST-01 (COMPLETE: all bracket access replaced with typed `asTestable()` helper in `tests/lib/helpers.ts`; 7 BaseResource members promoted to `protected`; `Resource.testParseRequest` static wrapper added)
TEST-02 (prototype mutations in resource.test.ts → jest.spyOn — fixed alongside TEST-01)
DEP-01 (AWS SDK v2→v3 full migration; v2.0.0 version bump)
TS-01 (strictNullChecks: true enabled; all 244 tests pass)
PY-03 (_validate_build_prerequisites() added to _build(); validates npm, node>=20, sam; 7 new tests)
DEP-04 (EVALUATED: only one version of @org-formation/tombok exists; part of public API; no action needed)

### ✅ Completed (this branch, continued)
PY-04 (SUPPORT_LIB_VERSION: read dynamically from `python/rpdk/typescript/data/support-lib-version.txt`; CI sync-test validates the file)
LOG-TYPES (Logger.log / private log methods: `any` → `unknown` throughout log-delivery.ts, metrics.ts, resource.ts; Queue<void> explicit type)

### 🔬 Investigated — Do NOT Implement
INC-04 — ❌ DO NOT implement — reflect-metadata removal is unsafe

---

## Table of Contents
1. [Confirmed Bugs](#1-confirmed-bugs)
2. [Incomplete Implementations](#2-incomplete-implementations)
3. [Outdated Dependencies](#3-outdated-dependencies)
4. [Type Safety & TypeScript Configuration](#4-type-safety--typescript-configuration)
5. [Code Quality Issues](#5-code-quality-issues)
6. [Test Quality Issues](#6-test-quality-issues)
7. [Python Plugin Issues](#7-python-plugin-issues)
8. [Template Issues](#8-template-issues)
9. [Priority Matrix](#9-priority-matrix)

---

## 1. Confirmed Bugs

### BUG-01 — Wrong log message: "does exist" when bucket does NOT exist
**File:** `src/log-delivery.ts:516`
```typescript
// CURRENT (wrong):
`S3 bucket with name ${this.bucketName} does exist in resource owner account.`
// CORRECT:
`S3 bucket with name ${this.bucketName} does NOT exist in resource owner account.`
```
The `NoSuchBucket` error path in `doesFolderExist()` logs the opposite of what happened.

---

### BUG-02 — Double metrics emission for sequence token errors
**File:** `src/log-delivery.ts:160,169`
```typescript
await this.emitMetricsForLoggingFailure(err);  // line 160 — inside the retry branch
// ...
await this.emitMetricsForLoggingFailure(err);  // line 169 — ALWAYS runs after the if/else
```
`emitMetricsForLoggingFailure` is called on line 160 (inside the `DataAlreadyAcceptedException`/`InvalidSequenceTokenException`/`ThrottlingException` branch) AND unconditionally on line 169 at the bottom of the catch block. Every retryable sequence token error emits two metrics.

**Fix:** Remove line 169's call, since both branches already call it.

---

### BUG-03 — Useless empty catch-rethrow in `createFolder`
**File:** `src/log-delivery.ts:557–559`
```typescript
} catch (err) {
    throw err;  // completely pointless — doesn't log, transform, or suppress
}
```
This `try/catch` adds no value and obscures the call stack. Remove it entirely.

---

### BUG-04 — Wrong type cast on exception error code lookup
**File:** `src/exceptions.ts:12`
```typescript
// CURRENT (wrong cast):
HandlerErrorCode[this.constructor.name as HandlerErrorCode]
// CORRECT:
HandlerErrorCode[this.constructor.name as keyof typeof HandlerErrorCode]
```
`as HandlerErrorCode` casts the string to a _value_ type rather than a _key_ type. It works today only because this is a string enum where keys equal values. Any future exception class whose name does not match an enum key will silently get `undefined` as its error code, making `toProgressEvent()` emit an event with no error code.

---

### BUG-05 — Unused variable in generated `handlers.ts` template
**File:** `python/rpdk/typescript/templates/handlers.ts:47`
```typescript
if (session instanceof SessionProxy) {
    const client = session.client('S3');  // declared, never used
}
```
This generated code produces a TypeScript error `'client' is declared but its value is never read` and will cause `tsc --noUnusedLocals` (or ESLint's `no-unused-vars`) to fail on every new project. The variable should be removed or the example should show it actually being used.

---

### BUG-06 — Division by zero in `ProgressTracker.message`
**File:** `src/utils.ts:93`
```typescript
get message(): string {
    return (
        `${this.#tasksCompleted} of ${this.#tasksSubmitted} completed` +
        ` ${((this.#tasksCompleted / this.#tasksSubmitted) * 100).toFixed(2)}%` + // NaN if 0/0
```
If `#tasksSubmitted` is 0 the division produces `NaN`. While `message` is only used for debug logging, it still produces confusing output.

**Fix:** Guard: `this.#tasksSubmitted === 0 ? '0.00' : ((this.#tasksCompleted / this.#tasksSubmitted) * 100).toFixed(2)`.

---

### BUG-07 — `resolver.py`: `contains_model` does not recurse into Sets or Maps
**File:** `python/rpdk/typescript/resolver.py:74–77`
```python
def contains_model(resolved_type):
    if resolved_type.container == ContainerType.LIST:
        return contains_model(resolved_type.type)   # only LIST is recursive
    return resolved_type.container == ContainerType.MODEL
```
`ContainerType.SET` and `ContainerType.DICT` are never recursed into. A model nested inside a `Set<SomeModel>` or `Map<string, SomeModel>` will not be detected, causing the codegen template to emit a `@Transform` decorator instead of a `@Type(() => SomeModel)` decorator. The generated model will fail to deserialize nested objects in those containers.

**Fix:**
```python
def contains_model(resolved_type):
    if resolved_type.container in (ContainerType.LIST, ContainerType.SET, ContainerType.DICT):
        return contains_model(resolved_type.type)
    return resolved_type.container == ContainerType.MODEL
```

---

### BUG-08 — `workerPool` error is swallowed silently
**File:** `src/proxy.ts:133–135`
```typescript
try {
    const result = await workerPool.runAwsTask<...>({ ... });
    return result;
} catch (err) {
    console.log(err);  // swallowed — falls through to synchronous path
}
```
If the worker pool throws, the code silently falls through to the regular `makeRequest` path without informing the caller that the worker pool failed. This means production issues with the worker pool are invisible in structured logs (only appear on stdout via `console.log`).

**Fix:** At minimum, emit a metric or log via `platformLogger`. Consider whether falling back is the right behavior at all; the caller who configured a worker pool expects it to be used.

---

## 2. Incomplete Implementations

### INC-01 — Remaining time calculation is stubbed out
**File:** `src/resource.ts:647–652`
```typescript
} catch (err) {
    if (err instanceof Error) {
        this.lambdaLogger.log(err);
        await delay(2);
        /* TODO: Check if the real remaining time from CloudFormation can be calculated
        // Wait for as long as possible (basically until the end of the lambda process)
        const remainingTime = context ? context.getRemainingTimeInMillis() : 0;
        if (remainingTime > 200) {
            await delay((remainingTime - 200) / 100);
        } */
    }
}
```
The `LambdaContext` interface (defined in `src/interface.ts:369`) already includes `getRemainingTimeInMillis(): number`. The implementation was started and commented out. The current hard-coded `await delay(2)` (2 seconds) in the error path of `waitRunningProcesses` is arbitrary and will either time out too early on slow log delivery or waste execution time.

**Fix:** Uncomment and implement using the passed-in `context`:
```typescript
const remainingMs = context?.getRemainingTimeInMillis?.() ?? 0;
if (remainingMs > 200) {
    await delay((remainingMs - 200) / 1000);
}
```
This requires threading `context` into `waitRunningProcesses`.

---

### INC-02 — `validate_codegen_model` is defined but never called
**File:** `python/rpdk/typescript/utils.py:89–101`
```python
def validate_codegen_model(default):
    pattern = r"^[1-2]$"
    def _validate_codegen_model(value): ...
    return _validate_codegen_model
```
This function is defined but is not referenced in `codegen.py`, `parser.py`, or any test. It appears to be a leftover from a planned code-generation model selection feature that was never wired up.

---

### INC-03 — CHANGELOG is frozen at v0.5.0 from 2020
**File:** `CHANGELOG.md`
The library is at version `1.0.6` and the plugin at `1.0.5`, but the changelog only documents up to `0.5.0` from December 2020. Every release since then — including the major 1.x series with TypeConfiguration support, Node 20 runtime, and numerous fixes — is undocumented.

Additionally, the `[Unreleased]` diff link (line 109) points to a forked personal repo (`eduardomourar/...`) rather than the canonical `aws-cloudformation/...` repo.

---

### INC-04 — `reflect-metadata` imported twice
**Files:** `src/interface.ts:1`, `src/resource.ts:1`
```typescript
import 'reflect-metadata';
```
`reflect-metadata` only needs to be imported once at the application entry point. Importing it in both `interface.ts` and `resource.ts` is redundant. Since `src/index.ts` is the library entry point, neither is technically correct; the consumer is supposed to import it once at the top of their project. The current approach means the library silently controls a global side effect.

**Fix:** Remove the import from `interface.ts`. Add a note in the README/JSDoc that consumers must import `reflect-metadata` once before using the library.

> ⚠️ **CORRECTION: INC-04 is NOT safe to implement.**
> Exploration confirmed that `import 'reflect-metadata'` in `interface.ts` is required:
> - `class-transformer` functions (`plainToInstance`, `instanceToPlain`) depend on it being loaded
>   before any `@Expose`/`@Exclude` decorated class is instantiated.
> - `Reflect.getMetadata('handlerEvents', ...)` called in `resource.ts` requires it.
>
> The two imports in `interface.ts` and `resource.ts` are NOT duplicates — they are defense-in-depth
> ensuring the side-effect import is present regardless of import order. Do not remove either.

---

## 3. Outdated Dependencies

### DEP-01 — AWS SDK v2 (deprecated since Dec 31, 2023)
**Files:** `package.json`, `src/log-delivery.ts`, `src/metrics.ts`, `src/proxy.ts`, `tests/lib/log-delivery.test.ts`

The entire library is built on `aws-sdk` v2, which reached end-of-life on December 31, 2023. This is the root cause of **all 9 `@ts-expect-error` comments** in the source files (the `.code` vs `.name` property conflict on `AWSError` vs the standard `Error`).

**Migration path to AWS SDK v3:**
```
aws-sdk/clients/cloudwatchlogs  →  @aws-sdk/client-cloudwatch-logs
aws-sdk/clients/cloudwatch      →  @aws-sdk/client-cloudwatch
aws-sdk/clients/s3              →  @aws-sdk/client-s3
aws-sdk/clients/all             →  individual clients
aws-sdk/lib/service             →  @smithy/types
```
With v3, errors are typed correctly (`ServiceException` with `.name: string`), eliminating all `@ts-expect-error` suppressions.

**Impact:** High. All 9 type suppressions exist solely because of this. The `ExtendedClient` proxy and `makeRequestPromise` pattern in `proxy.ts` can also be simplified because v3 uses a command-based pattern.

---

### DEP-02 — `string.prototype.replaceall` polyfill is unnecessary
**File:** `src/utils.ts:3`, `package.json`
```typescript
const replaceAllShim = require('string.prototype.replaceall');
```
`String.prototype.replaceAll` is natively available in Node.js ≥ 15 and `package.json` specifies `"node": ">=20.0.0"`. The polyfill package and the CommonJS `require()` should both be removed.

**Fix:**
```typescript
export function replaceAll(original: string, substr: string, newSubstr: string): string {
    return original ? original.replaceAll(substr, newSubstr) : original;
}
```
Also remove `"string.prototype.replaceall"` from `dependencies` in `package.json`.

---

### DEP-03 — `uuid` v7 is end-of-life
**File:** `package.json`
```json
"uuid": "^7.0.2"
```
`uuid` v7 is EOL (current is v9.x). The semver range `^7.0.2` will not pick up v9. The migration from v7 to v9 is non-breaking for `v4` usage (`import { v4 as uuidv4 } from 'uuid'`), which is the only usage in this project.

---

### DEP-04 — `@org-formation/tombok` `^0.0.1` has no stable release
**File:** `package.json`
The `@org-formation/tombok` package is pinned to `^0.0.1` — a pre-release version. This provides the `@builder` decorator and `IBuilder` pattern used in `ProgressEvent`. The package has no changelog, no major version, and the API could change. The TODO comment at `proxy.ts:263` acknowledges the workaround needed because of this dependency:
```typescript
// TODO: remove workaround when decorator mutation implemented
// Returns null but has @builder decorator for type purposes
public static builder<T extends ProgressEvent>(template?: Partial<T>): IBuilder<T> {
    /* istanbul ignore next */
    return null;
}
```
**Fix:** Evaluate replacing `@builder` with a hand-written builder to remove the pre-release dependency, or lock to a specific hash.

---

### DEP-05 — TypeScript `~5.3.0` is pinned too tightly
**File:** `package.json`
```json
"typescript": "~5.3.0"
```
The `~` patch-range pin prevents getting TypeScript 5.4+ improvements including better narrowing, `noUncheckedSideEffectImports`, and improved decorator support. Upgrade to `^5.4.0` or higher and address any new errors.

---

## 4. Type Safety & TypeScript Configuration

### TS-01 — `strict` mode is declared but three critical checks are disabled
**File:** `tsconfig.json`
```json
{
  "strict": true,
  "noImplicitAny": false,       // defeats strict mode's primary purpose
  "strictNullChecks": false,    // all the null bugs below stem from this
  "strictPropertyInitialization": false
}
```
`strict: true` enables `noImplicitAny`, `strictNullChecks`, and `strictPropertyInitialization` — but all three are immediately overridden to `false`. The result is false security: developers think they are in strict mode but are not. Enabling these properly would surface real bugs:

- **`strictNullChecks`:** `nextSequenceToken: string = null` at `log-delivery.ts:100` is not a valid assignment (it's `string | null`). Multiple similar issues throughout.
- **`noImplicitAny`:** `(params: TransformFnParams) => transformValue(...)` lambda in the models template would need proper types.
- **`strictPropertyInitialization`:** Several class fields (e.g., `providerSession`, `callerSession`, `cloudWatchLogHelper` in `resource.ts`) are declared without initializers and without `!` — these are only safe if `strictPropertyInitialization` is off.

**Recommended path:**
1. Enable `strictNullChecks` first — it catches the most bugs.
2. Enable `noImplicitAny`.
3. Address each error; they will be real bugs, not false positives.
4. `strictPropertyInitialization` last — requires adding `| undefined` or `!` to class fields.

---

### TS-02 — Nine `@ts-expect-error` suppressions all caused by AWS SDK v2
The following suppressions will disappear entirely after migrating to AWS SDK v3 (DEP-01):

| File | Line | Reason |
|---|---|---|
| `src/log-delivery.ts` | 140 | `err.code` not on `Error` in v3 |
| `src/log-delivery.ts` | 161 | `err.retryable = true` mutation |
| `src/log-delivery.ts` | 320 | `err.code` |
| `src/log-delivery.ts` | 340 | `err.code` |
| `src/log-delivery.ts` | 512 | `err.code` |
| `src/log-delivery.ts` | 520 | `err` passed to metrics (not `Error`) |
| `src/log-delivery.ts` | 534 | `err.code` |
| `src/log-delivery.ts` | 630 | `err.retryable` check |
| `src/metrics.ts` | 77–82 | `err.retryable`, `err.message` |

---

### TS-03 — `@ts-ignore` on the Integer proxy wrapper
**File:** `src/interface.ts:69, 84, 99, 101`
The `Integer` wrapper uses runtime prototype mutation (`target.prototype.toJSON = ...` on line 107) which is both fragile and type-unsafe. TypeScript rightfully rejects it. The `@ts-ignore` comments suppress legitimate type errors.

This pattern is also problematic at runtime:
- `toJSON` is added to `BigInt.prototype` globally the first time `Integer(...)` is called
- If `Integer()` is never called, the JSON serialization behavior doesn't exist
- The `isSafeInteger` function is added as a static property to the Proxy target, not to `Integer` itself

**Fix options:**
1. Create a proper `Integer` class wrapping `bigint` with explicit JSON serialization
2. Use a branded type: `type integer = bigint & { readonly _brand: 'integer' }` with a factory function

---

### TS-04 — `@ts-ignore` on `testEntrypoint` overload
**File:** `src/resource.ts:393`
```typescript
// @ts-ignore
public async testEntrypoint(
    eventData: any | Dict,
    context?: Partial<LambdaContext>
): Promise<ProgressEvent<T>>;
```
The `@ts-ignore` is needed because TypeScript's overload resolution requires the implementation signature to be compatible with all overload signatures, but `@ensureSerialize` is applied only to the implementation. This is a decorator interaction limitation.

The real fix is to explicitly type the `@ensureSerialize` decorator's return type so TypeScript understands the overloads are satisfied. Alternatively, avoid overloads here entirely since both variants have the same external behavior.

---

### TS-05 — `tsconfig.test.json` missing key configuration
**File:** `tsconfig.test.json`
The test tsconfig should explicitly set `"isolatedModules": false` (since ts-jest handles full compilation) and include `"types": ["jest"]` to avoid ambient type pollution. Check whether `emitDecoratorMetadata` is inherited from the base config.

---

## 5. Code Quality Issues

### CQ-01 — Retry signaling via property mutation on Error objects
**Files:** `src/log-delivery.ts:162`, `src/log-delivery.ts:630–631`
```typescript
// In CloudWatchLogPublisher.publishMessage():
// @ts-expect-error fix in aws sdk v3
err.retryable = true;  // mutates the thrown Error

// In LoggerProxy.log():
// @ts-expect-error fix in aws sdk v3
if (err.retryable === true) {  // reads the mutated property
    await logPublisher.publishLogEvent(formatted, eventTime);
```
This is a cross-layer communication hack: `CloudWatchLogPublisher` signals to `LoggerProxy` that a retry should be attempted by mutating a property on a thrown `Error` object. This breaks the single-responsibility principle, creates hidden coupling, and is the reason for two `@ts-expect-error` suppressions.

**Fix:** Create a `RetryableLogError` class that extends `Error`, or pass retry intent through the return type instead of exception mutation.

---

### CQ-02 — `LoggerProxy` directly exposes `tracker` as a public property
**Files:** `src/log-delivery.ts:585`, `src/resource.ts:288–289, 303`
```typescript
// log-delivery.ts:
readonly tracker = new ProgressTracker();

// resource.ts — accesses tracker directly to manipulate state:
this.platformLoggerProxy.tracker.done = false;
this.loggerProxy.tracker.done = false;
```
The `tracker` is `readonly` but its contents are mutable. `resource.ts` reaches into `LoggerProxy` and sets `tracker.done = false` to force the tracker to keep waiting. This is tight coupling between two classes that should communicate through methods.

**Fix:** Add a `LoggerProxy.markPending()` method that encapsulates `tracker.done = false`.

---

### CQ-03 — `new Date(Date.now())` anti-pattern used everywhere
**Files:** `src/log-delivery.ts:63,228,361,432,575`, `src/metrics.ts` (multiple)
```typescript
new Date(Date.now())  // creates a number, then wraps it in a Date
```
This is equivalent to `new Date()` and adds unnecessary work. The pattern appears ~10 times across the codebase. This was introduced when the team needed ISO strings (commit `b3e34be`), but the direct constructor form is simpler.

---

### CQ-04 — `throw Error(...)` vs `throw new Error(...)`
**File:** `src/utils.ts:64`, and others
```typescript
throw Error('Not allowed to submit a new task...');
// should be:
throw new Error('Not allowed to submit a new task...');
```
Calling `Error()` without `new` works but is inconsistent with the rest of the codebase and ESLint's `new-cap` rule. All `throw` statements should use `new`.

---

### CQ-05 — `inspect.defaultOptions` global mutation in `LoggerProxy` constructor
**File:** `src/log-delivery.ts:590–594`
```typescript
constructor(defaultOptions: InspectOptions = {}) {
    inspect.defaultOptions = {
        ...inspect.defaultOptions,
        depth: 10,
        ...defaultOptions,
    };
}
```
This mutates a Node.js global (`util.inspect.defaultOptions`) whenever a `LoggerProxy` is constructed. In a Lambda execution context (where containers are reused), this means every invocation accumulates potential changes to the global inspect options. Any other code in the same process (including AWS SDK internals) that uses `util.inspect` is affected.

**Fix:** Pass options to each `inspect()` call site directly rather than mutating the global.

---

### CQ-06 — `console.error` used directly in `LoggerProxy`
**Files:** `src/log-delivery.ts:613,639`
```typescript
console.error(err);  // in waitCompletion()
console.error(err);  // in log retry failure
```
The rest of the codebase uses `this.platformLogger.log(...)` for consistency. Using `console.error` directly bypasses the filter chain (credentials could leak), bypasses the metrics proxy, and produces output in a different format than the rest of the Lambda logs.

---

### CQ-07 — `queue.enqueue()` wraps every metric in `MetricsPublisherProxy`
**File:** `src/metrics.ts:208–211, 219–222, 233–236, 247–250`
```typescript
for (const publisher of this.publishers) {
    await this.queue.enqueue(() =>
        publisher.publishExceptionMetric(timestamp, action, error)
    );
}
```
Each metric publish is enqueued into a `Queue` (serial execution) with `await` — meaning metrics to multiple publishers are sequential and blocking. For a list with one publisher (the common case), this is fine. But this pattern is unnecessary complexity; a simple `await publisher.publishX(...)` inside a loop is equivalent and clearer.

---

### CQ-08 — `require()` instead of `import` for the shim
**File:** `src/utils.ts:3`
```typescript
// eslint-disable-next-line
const replaceAllShim = require('string.prototype.replaceall');
```
This is a CommonJS `require()` call in an otherwise ESM TypeScript file. It requires the `// eslint-disable-next-line` comment and the shim itself. Removing DEP-02 eliminates this entirely.

---

### CQ-09 — `resource.ts` `waitRunningProcesses` logs before shutdown is complete
**File:** `src/resource.ts:266–272`
```typescript
private async waitRunningProcesses() {
    this.log('Waiting for logger proxy processes to finish...');
    // ...
    await delay(1);
    if (this.loggerProxy) {
        await this.loggerProxy.waitCompletion();
    }
    await this.platformLoggerProxy.waitCompletion();
    this.log('Log delivery completed.');   // logged BEFORE workerPool.shutdown()
    if (this.workerPool) {
        await this.workerPool.shutdown();  // still pending
    }
}
```
The "Log delivery completed." message is logged and the logger proxy completes before the worker pool is shut down. Any log events queued in the worker pool at shutdown time may not be delivered.

---

## 6. Test Quality Issues

### TEST-01 — Tests access private fields via bracket notation
**File:** `tests/lib/resource.test.ts:197, 434, 436, 437, 587, 593, 623–627`
```typescript
resource['platformLoggerProxy']['log'] = mockLog;         // line 197
resource['providerEventsLogger']                          // line 434
resource['s3LogHelper']['bucketName']                     // line 437
resource['loggerProxy']['logPublishers'].length           // line 587
resource['handlers'].get(Action.Create)                   // line 623
```
Tests that access private fields via bracket notation (`obj['privateField']`) are brittle: they break on any rename or refactoring, don't get IDE support, and violate encapsulation. They are also silently `any`-typed since TypeScript can't check private access this way.

**Fix:** Add package-internal test-only accessors or expose the minimal surface through public methods. Alternatively, use `jest.spyOn` with the proper method name.

---

### TEST-02 — Prototype mutation in tests without proper cleanup
**File:** `tests/lib/resource.test.ts:194–195, 213–214`
```typescript
MetricsPublisherProxy.prototype['publishExceptionMetric'] = mockPublishException;
```
This mutates `MetricsPublisherProxy.prototype` directly. Although `jest.clearAllMocks()` is called in `afterEach`, it does not restore prototype mutations — only `jest.restoreAllMocks()` does (and only for spies created via `jest.spyOn`). If these tests run before any test that expects the real implementation, those tests will see the mock.

**Fix:** Use `jest.spyOn(MetricsPublisherProxy.prototype, 'publishExceptionMetric').mockImplementation(mockPublishException)` which is tracked by Jest and properly restored.

---

### TEST-03 — `log-delivery.test.ts` is heavily duplicated
**File:** `tests/lib/log-delivery.test.ts`
The test file re-implements `mockResult()` which is identical to the version in `tests/lib/proxy.test.ts`. Extract to a shared test helper in `tests/lib/__helpers__/`.

---

### TEST-04 — No tests for `recast.ts` circular-reference depth limits
**File:** `src/recast.ts`, `tests/lib/recast.test.ts`
`recast.ts` calls `transformValue` recursively with no depth limit. `deepFreeze` in `utils.ts` correctly guards against circular references with a `processed` Set, but `transformValue` does not. A circular reference in input data will cause a stack overflow. There is no test exercising this.

---

### TEST-05 — Missing coverage for `entrypoint` remaining-time path
**File:** `tests/lib/resource.test.ts`
There is no test that exercises the `waitRunningProcesses` error path with a real `lambdaContext.getRemainingTimeInMillis()` value. The current test (`entrypoint success even with wait logger failure`) mocks out `waitRunningProcesses` entirely rather than testing the timing behavior.

---

### TEST-06 — `workerPool.restart()` called on `WorkerPoolAwsSdk`
**File:** `tests/lib/resource.test.ts:125`
```typescript
afterEach(() => {
    workerPool.restart();
```
`WorkerPoolAwsSdk` does not have a `restart()` method in its public interface. This works in tests because `piscina` and `worker_threads` are fully mocked (`jest.mock('piscina')`), making the instance a mock object. If the mocks are ever removed or changed, this will throw at runtime.

---

## 7. Python Plugin Issues

### PY-01 — Dead code: Python 3.7 compatibility check
**File:** `python/rpdk/typescript/codegen.py:17–20`
```python
if sys.version_info >= (3, 8):  # pragma: no cover
    from zipfile import ZipFile
else:  # pragma: no cover
    from zipfile38 import ZipFile
```
`setup.py` requires `python_requires=">=3.8"`, so the `else` branch (importing `zipfile38`) can never run. Both lines are marked `# pragma: no cover`. The `zipfile38` dependency in `setup.py` `install_requires` can also be removed.

---

### PY-02 — `contains_model` does not handle Set/Dict containers
See **BUG-07** above. This is a Python-side bug with TypeScript codegen consequences.

---

### PY-03 — No validation of npm/node prerequisites before build
**File:** `python/rpdk/typescript/codegen.py:267–309` (`_build` method)
The build method runs `npm install && sam build` but does nothing to validate that `npm`, `node`, or `sam` are available before starting. If any of these are missing, the error only surfaces after a potentially long `subprocess_run` timeout.

**Fix:** Add preflight checks using `shutil.which('npm')`, `shutil.which('sam')`, and verify Node version meets the minimum.

---

### PY-04 — `SUPPORT_LIB_VERSION` is hardcoded and disconnected from `package.json`
**File:** `python/rpdk/typescript/codegen.py:29`
```python
SUPPORT_LIB_VERSION = "^1.0.6"
```
This version string is manually maintained. When the npm package version is bumped, `codegen.py` must be manually updated. If they drift, new projects generated with the plugin will install an old version of the runtime library.

**Fix:** Read the version dynamically from `package.json` at plugin init time, or use a single `VERSION` file.

---

### PY-05 — `useDocker` setting migration is one-way
**File:** `python/rpdk/typescript/codegen.py:66–68`
```python
self._use_docker = project.settings.get("useDocker") or project.settings.get("use_docker")
```
The plugin reads both the legacy `useDocker` (camelCase) and new `use_docker` (snake_case) keys but always writes back as `use_docker`. If a project has `"useDocker": true` in `.rpdk-config`, it will be correctly read but not cleaned up — leaving a stale legacy key alongside the new key after the first run.

---

## 8. Template Issues

### TMPL-01 — `handlers.ts`: Resource class not typed with TypeConfiguration
**File:** `python/rpdk/typescript/templates/handlers.ts:18`
```typescript
class Resource extends BaseResource<ResourceModel> {
//                                             ↑ missing second type parameter
```
The `BaseResource` signature is `BaseResource<T, TypeConfiguration>`. By omitting `TypeConfigurationModel`, all handler methods receive `typeConfiguration: any` at runtime rather than the generated `TypeConfigurationModel` type. The type safety of the entire TypeConfiguration feature is silently lost for every newly generated project.

**Fix:**
```typescript
class Resource extends BaseResource<ResourceModel, TypeConfigurationModel> {
```

---

### TMPL-02 — `handlers.ts`: `@ts-ignore` on resource instantiation may be outdated
**File:** `python/rpdk/typescript/templates/handlers.ts:172`
```typescript
// @ts-ignore // if running against v1.0.1 or earlier of plugin the 5th argument is not known but best to ignored (runtime code may warn)
export const resource = new Resource(ResourceModel.TYPE_NAME, ResourceModel, null, null, TypeConfigurationModel)!;
```
The comment says "v1.0.1 or earlier". The library is now at v1.0.6. The `@ts-ignore` is not needed against current versions — and teaching generated code to use `@ts-ignore` is poor practice. The non-null assertion `!` is also unnecessary since the constructor always returns an instance.

---

### TMPL-03 — `models.ts`: `(this as any)` used in identifier accessors
**File:** `python/rpdk/typescript/templates/models.ts:83`
```jinja
if ((this as any).{{components[2]|lowercase_first_letter}} != null
```
Inside `getIdentifier_*()` methods, `this` is cast to `any` to access properties. Since all properties are declared on the class with `@Expose()`, there is no reason to use `(this as any)`. This is likely a template bug from when the model properties had slightly different names.

---

## 9. Priority Matrix

| ID | Issue | Severity | Effort | Category |
|---|---|---|---|---|
| ✅ BUG-07 | `contains_model` missing Set/Dict recursion | **Critical** | Low | Bug |
| ✅ TMPL-01 | `handlers.ts` missing TypeConfiguration generic | **Critical** | Low | Template |
| ✅ BUG-01 | Wrong log message (does exist vs does NOT) | High | Trivial | Bug |
| ✅ BUG-02 | Double metrics emission | High | Low | Bug |
| ✅ BUG-05 | Unused variable in generated handler | High | Low | Bug |
| DEP-01 | AWS SDK v2 migration | High | **Very High** | Dependency |
| TS-01 | Enable `strictNullChecks` | High | Medium | TypeScript |
| ✅ INC-01 | Finish remaining-time calculation | High | Low | Feature |
| ✅ BUG-04 | Wrong type cast on exception error code | Medium | Low | Bug |
| ✅ BUG-06 | Division by zero in progress tracker | Medium | Trivial | Bug |
| ✅ BUG-08 | Swallowed worker pool error | Medium | Low | Bug |
| CQ-01 | Retry via Error mutation | Medium | Medium | Quality |
| ✅ CQ-02 | `tracker` exposed as public mutable field | Medium | Low | Quality |
| ✅ CQ-05 | `inspect.defaultOptions` global mutation | Medium | Low | Quality |
| CQ-06 | `console.error` bypasses log pipeline | Medium | Trivial | Quality |
| ✅ DEP-02 | Remove `string.prototype.replaceall` | Medium | Trivial | Dependency |
| ✅ DEP-03 | Upgrade `uuid` v7 → v9 | Medium | Trivial | Dependency |
| ✅ CQ-07 | `queue.enqueue()` serial wrapper in `MetricsPublisherProxy` | Low | Trivial | Quality |
| TS-02 | Remove all `@ts-expect-error` (after v3 SDK) | Medium | Medium | TypeScript |
| ✅ BUG-03 | Useless catch-rethrow in `createFolder` | Low | Trivial | Bug |
| ✅ CQ-03 | `new Date(Date.now())` anti-pattern | Low | Trivial | Quality |
| ✅ CQ-04 | `throw Error()` vs `throw new Error()` | Low | Trivial | Quality |
| ✅ CQ-09 | Log before workerPool shutdown | Low | Low | Quality |
| ✅ INC-02 | Remove dead `validate_codegen_model` | Low | Trivial | Cleanup |
| INC-03 | Update CHANGELOG | Low | Low | Docs |
| 🚫 INC-04 | Remove duplicate `reflect-metadata` import — **DO NOT implement** (see §2) | Low | Trivial | Cleanup |
| ✅ PY-01 | Remove dead Python 3.7 compat | Low | Trivial | Cleanup |
| PY-04 | `SUPPORT_LIB_VERSION` disconnected from package.json (sync test added as interim) | Low | Low | Maintainability |
| ✅ TMPL-02 | Remove outdated `@ts-ignore` from template | Low | Trivial | Template |
| ✅ TMPL-03 | Remove `(this as any)` from identifier accessors | Low | Trivial | Template |
| DEP-04 | Evaluate `@org-formation/tombok` pre-release | Low | High | Dependency |
| TEST-01 | Replace bracket private access in tests | Low | Medium | Tests |
| ✅ TEST-02 | Fix prototype mutation in tests | Low | Low | Tests |
| ✅ TEST-04 | Add circular reference test for recast | Low | Low | Tests |

---

## Quick Wins (can be done in one session)

These are all isolated, low-risk, and high-value:

1. ✅ **BUG-01** — Fix log message typo in `log-delivery.ts:516`
2. ✅ **BUG-02** — Remove duplicate `emitMetricsForLoggingFailure` call at `log-delivery.ts:169`
3. ✅ **BUG-03** — Remove empty `try/catch` in `createFolder` at `log-delivery.ts:557–559`
4. ✅ **BUG-04** — Fix exception error code type cast in `exceptions.ts:12`
5. ✅ **BUG-05** — Remove unused `const client` variable in `handlers.ts` template
6. ✅ **BUG-06** — Guard division by zero in `ProgressTracker.message`
7. ✅ **BUG-07** — Fix `contains_model` to recurse Set/Dict in `resolver.py`
8. ✅ **TMPL-01** — Add `TypeConfigurationModel` to `BaseResource` generic in `handlers.ts` template
9. ✅ **CQ-03** — Replace all `new Date(Date.now())` with `new Date()`
10. ✅ **CQ-04** — Replace all `throw Error(...)` with `throw new Error(...)`
11. ⏳ **CQ-06** — Replace `console.error` with platform logger in `log-delivery.ts` — **deferred** (see §10)
12. ✅ **DEP-02** — Remove `string.prototype.replaceall` and use native `replaceAll`
13. 🚫 **INC-04** — Remove duplicate `import 'reflect-metadata'` from `interface.ts` — **DO NOT implement** (see §2)
14. ✅ **PY-01** — Remove dead Python 3.7 zipfile compatibility branch
15. ✅ **TMPL-02** — Remove outdated `@ts-ignore` and `!` from resource instantiation in template

---

## 10. Deferred Item Details

### DEP-01 — AWS SDK v2 → v3 Migration

**Blocker:** Large coordinated change touching all AWS client usage across the library. Requires a dedicated PR.

**Clients to replace:**

| v2 import | v3 package |
|---|---|
| `aws-sdk/clients/cloudwatchlogs` | `@aws-sdk/client-cloudwatch-logs` |
| `aws-sdk/clients/cloudwatch` | `@aws-sdk/client-cloudwatch` |
| `aws-sdk/clients/s3` | `@aws-sdk/client-s3` |
| `aws-sdk/clients/all` + `CredentialsOptions` | individual clients + `@smithy/types` |

**`@ts-expect-error` count:** 9 suppressions in `src/log-delivery.ts` and `src/metrics.ts`, all caused by `err.code`/`err.retryable` not existing on the standard `Error` type (v2's `AWSError` shape). All disappear after migration to v3's `ServiceException`.

**Testing strategy:** The `worker-pool-aws-sdk` package must be evaluated for v3 compatibility. The `ExtendedClient` proxy and `makeRequestPromise` pattern in `proxy.ts` can be simplified because v3 uses a command-based pattern (`client.send(new PutObjectCommand(...))`).

---

### CQ-01 — RetryableLogError class

**Blocker:** Coupled to DEP-01. The retry signaling hack (`err.retryable = true` mutation) exists because AWS SDK v2's `AWSError` has a `.retryable` property that `LoggerProxy` checks. After migrating to v3, the correct fix is to create a `RetryableLogError extends Error` class with an explicit `retryable: boolean` field, eliminating both the mutation and the `@ts-expect-error`.

Attempting to fix CQ-01 before DEP-01 would require adding a parallel mechanism that gets thrown away anyway.

---

### CQ-06 — `console.error` in `LoggerProxy`

**Blocker:** No clean fix without a **public API change**.

`LoggerProxy` currently uses `console.error` in two places (`waitCompletion` and the log retry failure path) because it has no reference to a `platformLogger` or fallback logger. Adding one requires a new constructor parameter:

```typescript
constructor(
    defaultOptions: InspectOptions = {},
    private readonly fallbackLogger?: Logger  // new parameter
) { ... }
```

This is a **semver minor bump** (adds optional parameter) and must be coordinated with any consumer code. Deferred until a version bump is planned.

---

### PY-04 — `SUPPORT_LIB_VERSION` sync

**Interim solution (added in PR: Dep Updates + Code Quality Pass 2):** A test in `tests/plugin/codegen_test.py::test_support_lib_version_matches_package_json` reads `package.json` from the repo root and asserts that `SUPPORT_LIB_VERSION == f"^{pkg['version']}"`. This will catch drift in CI.

**Why the dynamic approach is still deferred:** Reading `package.json` at plugin init time (e.g., `importlib.resources`) fails in pip-installed environments where the npm package is not present alongside the Python package. A proper fix requires a shared `VERSION` file or build-time code generation.
