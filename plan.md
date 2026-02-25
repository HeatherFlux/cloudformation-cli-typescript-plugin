
 Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Plan: Quick Wins + Critical Bug Fixes

 Context

 The deep audit of cloudformation-cli-typescript-plugin (documented in REFACTOR_GUIDE.md) identified 8 confirmed bugs and ~15 code-quality issues that can be fixed independently without touching the AWS SDK v2→v3
 migration. This plan implements all Quick Wins from the guide plus the critical template and Python bugs — changes that are low-risk, isolated, and verifiable.

 Changes are grouped into three phases ordered by impact. The AWS SDK migration (DEP-01), strictNullChecks enablement (TS-01), and test private-access refactor (TEST-01/02) are out of scope — they require
 coordinated refactors tracked separately.

 ---
 Complete Inventory of Every Change

 INCLUDED — All changes in this plan

 ┌─────┬──────────────────────────────────────────────┬─────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────┬─────────┐
 │  #  │                     File                     │           Line(s)           │                                          What changes                                          │   Ref   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 1   │ src/log-delivery.ts                          │ 516                         │ Fix wrong log message: "does exist" → "does not exist"                                         │ BUG-01  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 2   │ src/log-delivery.ts                          │ 169                         │ Remove second duplicate emitMetricsForLoggingFailure call                                      │ BUG-02  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 3   │ src/log-delivery.ts                          │ 556–560                     │ Remove empty try { } catch (err) { throw err; } in createFolder                                │ BUG-03  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 4   │ src/log-delivery.ts                          │ 63, 228, 358, 432, 572, 621 │ Replace 6x new Date(Date.now()) → new Date()                                                   │ CQ-03   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 5   │ src/log-delivery.ts                          │ 123, 266, 394, 469          │ Replace 4x throw Error( → throw new Error(                                                     │ CQ-04   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 6   │ src/exceptions.ts                            │ 12                          │ Fix type cast: as HandlerErrorCode → as keyof typeof HandlerErrorCode                          │ BUG-04  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 7   │ src/utils.ts                                 │ 2–3                         │ Remove require('string.prototype.replaceall') + eslint-disable comment                         │ DEP-02  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 8   │ src/utils.ts                                 │ ~169                        │ Update replaceAll body: use native original.replaceAll(...)                                    │ DEP-02  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 9   │ src/utils.ts                                 │ 64                          │ Replace throw Error( → throw new Error(                                                        │ CQ-04   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 10  │ src/utils.ts                                 │ 93                          │ Guard division by zero in ProgressTracker.message percentage                                   │ BUG-06  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 11  │ src/metrics.ts                               │ 58                          │ Replace throw Error( → throw new Error(                                                        │ CQ-04   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 12  │ src/resource.ts                              │ 281, 569, 608               │ Replace 3x new Date(Date.now()) → new Date()                                                   │ CQ-03   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 13  │ package.json                                 │ ~43                         │ Remove "string.prototype.replaceall": "^1.0.3" from dependencies                               │ DEP-02  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 14  │ python/rpdk/typescript/resolver.py           │ 74–77                       │ Fix contains_model to recurse LIST, SET, and DICT (not just LIST)                              │ BUG-07  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 15  │ python/rpdk/typescript/codegen.py            │ 17–20                       │ Remove Python 3.7 zipfile compat block → single from zipfile import ZipFile                    │ PY-01   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 16  │ setup.py                                     │ ~42                         │ Remove "zipfile38>=0.0.3,<0.2" from install_requires                                           │ PY-01   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 17  │ tests/plugin/codegen_test.py                 │ 19–22                       │ Same Python 3.7 zipfile compat removal                                                         │ PY-01   │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 18  │ python/rpdk/typescript/templates/handlers.ts │ 18                          │ Add TypeConfigurationModel second generic: BaseResource<ResourceModel, TypeConfigurationModel> │ TMPL-01 │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 19  │ python/rpdk/typescript/templates/handlers.ts │ 47                          │ Replace unused const client = session.client('S3') with a comment                              │ BUG-05  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 20  │ python/rpdk/typescript/templates/handlers.ts │ 172–173                     │ Remove @ts-ignore comment and trailing ! from resource instantiation                           │ TMPL-02 │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 21  │ python/rpdk/typescript/templates/models.ts   │ 83, 85, 90                  │ Remove 3x (this as any) casts in getIdentifier_*() method template                             │ TMPL-03 │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 22  │ tests/lib/utils.test.ts                      │ end of file                 │ Add ProgressTracker.message with-zero-tasks test (verifies no NaN/Infinity)                    │ BUG-06  │
 ├─────┼──────────────────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
 │ 23  │ tests/plugin/resolver_test.py                │ after line 67               │ Add contains_model tests for SET containing model and DICT containing model                    │ BUG-07  │
 └─────┴──────────────────────────────────────────────┴─────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────┴─────────┘

 Total: 23 discrete changes across 12 files

 NOT INCLUDED — Intentionally deferred

 ┌─────────┬───────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │   Ref   │                         Issue                         │                                                                 Why deferred                                                                 │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ DEP-01  │ AWS SDK v2 → v3 migration                             │ Requires rewriting proxy.ts, log-delivery.ts, metrics.ts; all 9 @ts-expect-error suppressions; breaking API changes to ExtendedClient; very  │
 │         │                                                       │ high effort                                                                                                                                  │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ TS-01   │ Enable strictNullChecks / noImplicitAny in            │ Would surface ~50+ real type errors across the codebase; needs a dedicated pass per file                                                     │
 │         │ tsconfig.json                                         │                                                                                                                                              │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ TS-03   │ Refactor Integer Proxy wrapper                        │ Removes 4 @ts-ignore suppressions but requires redesigning the BigInt wrapper; touching it could break serialization                         │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ CQ-01   │ Replace err.retryable mutation retry signal           │ Requires a new RetryableLogError class and changes to both CloudWatchLogPublisher and LoggerProxy; coupled to DEP-01                         │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ CQ-02   │ LoggerProxy.tracker encapsulation                     │ Requires adding LoggerProxy.markPending() + changing resource.ts call sites                                                                  │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ CQ-05   │ inspect.defaultOptions global mutation                │ Requires threading options to each inspect() call site                                                                                       │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ CQ-06   │ Replace console.error in LoggerProxy                  │ LoggerProxy has no reference to a fallback logger; fixing this would add a constructor parameter — API change                                │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ CQ-07   │ Remove Queue from MetricsPublisherProxy               │ Minor simplification; zero correctness impact                                                                                                │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ CQ-09   │ Log ordering in waitRunningProcesses                  │ Cosmetic; needs careful re-sequencing                                                                                                        │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ INC-01  │ Implement remaining-time calculation                  │ Requires threading LambdaContext into waitRunningProcesses; feature work, not just cleanup                                                   │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ INC-02  │ Remove validate_codegen_model dead code               │ Function has test coverage in utils_test.py; removing it requires deleting tests too — needs confirmation                                    │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ INC-03  │ Update CHANGELOG                                      │ Documentation work; needs content for all v0.6–v1.0.6 releases                                                                               │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ INC-04  │ Remove duplicate import 'reflect-metadata'            │ interface.ts uses class-transformer decorators which depend on reflect-metadata being loaded; removal needs import-order analysis            │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ PY-04   │ Sync SUPPORT_LIB_VERSION with package.json            │ Needs a version-sourcing strategy decision                                                                                                   │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ TEST-01 │ Replace private bracket access in tests               │ Requires adding public test-accessor methods to BaseResource                                                                                 │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ TEST-02 │ Replace prototype mutation with jest.spyOn            │ Systematic test refactor; no correctness impact today                                                                                        │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ TEST-04 │ Add circular-reference test for recast.ts             │ Valid gap but not a known bug; separate test work                                                                                            │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ DEP-03  │ uuid v7 → v9 upgrade                                  │ Non-breaking for v4 usage but needs verification; separate PR                                                                                │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ DEP-04  │ Evaluate @org-formation/tombok                        │ Requires deciding to keep or hand-write the builder                                                                                          │
 ├─────────┼───────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ DEP-05  │ Upgrade TypeScript ~5.3.0 → ^5.4.0+                   │ Could introduce new compiler errors; verify separately                                                                                       │
 └─────────┴───────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 ---
 Files to Modify

 TypeScript source (src/)

 - src/log-delivery.ts — 4 fixes
 - src/exceptions.ts — 1 fix
 - src/utils.ts — 3 fixes
 - src/metrics.ts — 1 fix
 - src/resource.ts — 1 fix (new Date)
 - src/proxy.ts — 1 fix (new Date)

 NPM config

 - package.json — remove string.prototype.replaceall from dependencies

 Python plugin

 - python/rpdk/typescript/resolver.py — 1 bug fix
 - python/rpdk/typescript/codegen.py — remove dead Python 3.7 compat block
 - setup.py — remove zipfile38 dependency

 Jinja2 templates

 - python/rpdk/typescript/templates/handlers.ts — 3 fixes
 - python/rpdk/typescript/templates/models.ts — 1 fix

 Tests (new test cases only — no changes to existing tests)

 - tests/lib/utils.test.ts — add ProgressTracker.message division-by-zero test
 - tests/plugin/resolver_test.py — add 2 contains_model tests for SET/DICT
 - tests/plugin/codegen_test.py — remove dead Python 3.7 zipfile compat block

 ---
 Phase 1 — Bug Fixes

 1a. src/log-delivery.ts:516 — Wrong log message (BUG-01)

 // BEFORE:
 `S3 bucket with name ${this.bucketName} does exist in resource owner account.`
 // AFTER:
 `S3 bucket with name ${this.bucketName} does not exist in resource owner account.`

 1b. src/log-delivery.ts:169 — Remove duplicate metrics emission (BUG-02)

 The catch block in CloudWatchLogPublisher.publishMessage() calls emitMetricsForLoggingFailure on line 160 (inside the retryable-error branch) and again unconditionally on line 169. Delete the line 169 call:
 // DELETE this line (line 169):
 await this.emitMetricsForLoggingFailure(err);
 The call at line 160 (inside the if block) remains.

 1c. src/log-delivery.ts:556–560 — Remove empty catch-rethrow in createFolder (BUG-03)

 // BEFORE:
         const response = await this.client.makeRequestPromise('putObject', { ... });
         this.log('Response from "putObject"', response);
         } catch (err) {
             throw err;
         }
 // AFTER: remove the try/catch wrapper entirely, leaving just:
         const response = await this.client.makeRequestPromise('putObject', { ... });
         this.log('Response from "putObject"', response);

 1d. src/exceptions.ts:12 — Fix wrong type cast on error code lookup (BUG-04)

 // BEFORE:
 HandlerErrorCode[this.constructor.name as HandlerErrorCode]
 // AFTER:
 HandlerErrorCode[this.constructor.name as keyof typeof HandlerErrorCode]

 1e. src/utils.ts:93 — Guard division by zero in ProgressTracker.message (BUG-06)

 // BEFORE:
 ` ${((this.#tasksCompleted / this.#tasksSubmitted) * 100).toFixed(2)}%`
 // AFTER:
 ` ${(this.#tasksSubmitted > 0 ? (this.#tasksCompleted / this.#tasksSubmitted) * 100 : 0).toFixed(2)}%`

 1f. python/rpdk/typescript/resolver.py:74–77 — Fix contains_model to recurse SET/DICT (BUG-07)

 # BEFORE:
 def contains_model(resolved_type):
     if resolved_type.container == ContainerType.LIST:
         return contains_model(resolved_type.type)
     return resolved_type.container == ContainerType.MODEL
 # AFTER:
 def contains_model(resolved_type):
     if resolved_type.container in (ContainerType.LIST, ContainerType.SET, ContainerType.DICT):
         return contains_model(resolved_type.type)
     return resolved_type.container == ContainerType.MODEL

 1g. python/rpdk/typescript/templates/handlers.ts:18 — Add missing TypeConfigurationModel generic (TMPL-01)

 // BEFORE:
 class Resource extends BaseResource<ResourceModel> {
 // AFTER:
 class Resource extends BaseResource<ResourceModel, TypeConfigurationModel> {
 TypeConfigurationModel is already imported on line 14 of this template.

 1h. python/rpdk/typescript/templates/handlers.ts:47 — Remove unused client variable (BUG-05)

 // BEFORE:
             if (session instanceof SessionProxy) {
                 const client = session.client('S3');
             }
 // AFTER:
             if (session instanceof SessionProxy) {
                 // const client = session.client('S3'); // Example: create AWS clients
             }
 Replace the unused variable with a comment so the example remains instructive.

 ---
 Phase 2 — Code Cleanup

 2a. Remove string.prototype.replaceall polyfill (DEP-02)

 src/utils.ts:
 // REMOVE these two lines (lines 2–3):
 // eslint-disable-next-line
 const replaceAllShim = require('string.prototype.replaceall');

 // UPDATE replaceAll() function body:
 // BEFORE:
     if (original) {
         return replaceAllShim(original, substr, newSubstr);
     }
 // AFTER:
     if (original) {
         return original.replaceAll(substr, newSubstr);
     }

 package.json: Remove "string.prototype.replaceall": "^1.0.3" from dependencies.

 2b. Replace all new Date(Date.now()) with new Date() (CQ-03)

 9 occurrences across 3 files — replace all with new Date():

 ┌─────────────────────┬─────────────────────────────┐
 │        File         │            Lines            │
 ├─────────────────────┼─────────────────────────────┤
 │ src/log-delivery.ts │ 63, 228, 358, 432, 572, 621 │
 ├─────────────────────┼─────────────────────────────┤
 │ src/resource.ts     │ 281, 569, 608               │
 └─────────────────────┴─────────────────────────────┘

 2c. Replace throw Error( with throw new Error( (CQ-04)

 Occurrences confirmed by exploration:

 ┌─────────────────────┬──────┬─────────────────────────────────────────────────┐
 │        File         │ Line │                     Current                     │
 ├─────────────────────┼──────┼─────────────────────────────────────────────────┤
 │ src/utils.ts        │ 64   │ throw Error('Not allowed to submit...')         │
 ├─────────────────────┼──────┼─────────────────────────────────────────────────┤
 │ src/metrics.ts      │ 58   │ throw Error('CloudWatch client was not...')     │
 ├─────────────────────┼──────┼─────────────────────────────────────────────────┤
 │ src/log-delivery.ts │ 123  │ throw Error('CloudWatchLogs client was not...') │
 ├─────────────────────┼──────┼─────────────────────────────────────────────────┤
 │ src/log-delivery.ts │ 266  │ throw Error('CloudWatchLogs client was not...') │
 ├─────────────────────┼──────┼─────────────────────────────────────────────────┤
 │ src/log-delivery.ts │ 394  │ throw Error('S3 client was not...')             │
 ├─────────────────────┼──────┼─────────────────────────────────────────────────┤
 │ src/log-delivery.ts │ 469  │ throw Error('S3 client was not...')             │
 └─────────────────────┴──────┴─────────────────────────────────────────────────┘

 2d. Remove outdated @ts-ignore and ! from handlers.ts template (TMPL-02)

 python/rpdk/typescript/templates/handlers.ts:172–173:
 // BEFORE:
 // @ts-ignore // if running against v1.0.1 or earlier of plugin the 5th argument is not known but best to ignored (runtime code may warn)
 export const resource = new Resource(ResourceModel.TYPE_NAME, ResourceModel, null, null, TypeConfigurationModel)!;
 // AFTER:
 export const resource = new Resource(ResourceModel.TYPE_NAME, ResourceModel, null, null, TypeConfigurationModel);

 2e. Remove (this as any) casts from models.ts template (TMPL-03)

 python/rpdk/typescript/templates/models.ts:

 Three occurrences in the getIdentifier_*() method template (lines ~83, 85, 90). Each (this as any) is replaced with this:
 // BEFORE (line 83):
         if ((this as any).{{components[2]|lowercase_first_letter}} != null
 // AFTER:
         if (this.{{components[2]|lowercase_first_letter}} != null

 // BEFORE (line 85):
                 {#- #} && (this as any)
 // AFTER:
                 {#- #} && this

 // BEFORE (line 90):
             identifier[...] = (this as any){% for component ... %}...{% endfor %};
 // AFTER:
             identifier[...] = this{% for component ... %}...{% endfor %};

 2f. Remove Python 3.7 zipfile compatibility dead code (PY-01)

 python/rpdk/typescript/codegen.py:17–20:
 # REMOVE these 4 lines:
 if sys.version_info >= (3, 8):  # pragma: no cover
     from zipfile import ZipFile
 else:  # pragma: no cover
     from zipfile38 import ZipFile

 # REPLACE WITH:
 from zipfile import ZipFile
 Also remove the import sys if it is no longer used after this removal (check whether sys is used elsewhere in codegen.py — it is used on line 284 for sys.platform == "win32", so keep the import).

 tests/plugin/codegen_test.py:19–22: Same 4-line removal → from zipfile import ZipFile

 setup.py: Remove "zipfile38>=0.0.3,<0.2" from install_requires.

 ---
 Phase 3 — New Tests

 3a. tests/lib/utils.test.ts — Add ProgressTracker.message test

 Add a describe('progress tracker') block after the existing tests, covering:
 1. message with zero submitted tasks returns '0 of 0 completed 0.00%' (no NaN/Infinity)
 2. message with tasks submitted shows correct percentage

 describe('progress tracker', () => {
     test('message with no tasks submitted', () => {
         const tracker = new ProgressTracker();
         expect(tracker.message).toMatch(/0\.00%/);
         expect(tracker.message).not.toContain('NaN');
         expect(tracker.message).not.toContain('Infinity');
     });
 });

 ProgressTracker is already exported from src/utils.ts and importable via ~/utils.

 3b. tests/plugin/resolver_test.py — Add contains_model tests for SET/DICT

 Add two tests after line 67, following the existing pattern using ResolvedType and ContainerType:

 def test_contains_model_set_containing_model():
     resolved_type = ResolvedType(
         ContainerType.SET,
         ResolvedType(ContainerType.MODEL, "Foo"),
     )
     assert contains_model(resolved_type) is True


 def test_contains_model_dict_containing_model():
     resolved_type = ResolvedType(
         ContainerType.DICT,
         ResolvedType(ContainerType.MODEL, "Foo"),
     )
     assert contains_model(resolved_type) is True

 ResolvedType and ContainerType are already imported at the top of resolver_test.py. contains_model is also already imported.

 ---
 Out of Scope (deferred)

 - AWS SDK v2 → v3 migration (DEP-01) — removes all 9 @ts-expect-error; large coordinated change
 - Enable strictNullChecks (TS-01) — surfaces real bugs; requires dedicated pass
 - Test private-property access (TEST-01/02) — requires public API changes to BaseResource
 - validate_codegen_model removal (INC-02) — tested dead code; safe to remove but needs separate PR
 - SUPPORT_LIB_VERSION sync (PY-04) — needs a version sourcing strategy decision
 - (this as any) in models.ts template (TMPL-03) — low risk but need to verify no generated TS compile errors

 ---
 Verification

 TypeScript

 npm run build       # must produce zero errors
 npm run lint        # must produce zero new warnings
 npm run test        # all tests pass; new ProgressTracker test passes

 Python

 source env/bin/activate
 pip install -e .
 pre-commit run pytest-local   # all Python tests pass, including new resolver tests

 Smoke test: verify template fix

 # Install plugin, run cfn init, verify generated handlers.ts:
 # 1. Has "extends BaseResource<ResourceModel, TypeConfigurationModel>"
 # 2. Has no unused `const client` variable
 # 3. Has no @ts-ignore comment
 # 4. tsc compiles without error
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

 Claude has written up a plan and is ready to execute. Would you like to proceed?

 ❯ 1. Yes, clear context (68% used) and bypass permissions
   2. Yes, and bypass permissions
   3. Yes, manually approve edits
   4. Type here to tell Claude what to change

 ctrl-g to edit in VS Code · ~/.claude/plans/stateful-purring-parnas.md
