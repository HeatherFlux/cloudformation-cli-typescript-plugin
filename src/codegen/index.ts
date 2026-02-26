/**
 * Native TypeScript code generator for CloudFormation resource provider projects.
 *
 * This module is the TypeScript-native replacement for the Python plugin's
 * Jinja2 template rendering pipeline (`python/rpdk/typescript/`).
 *
 * ## Overview
 *
 * Given a CloudFormation resource provider schema (`.json` file), this module:
 * 1. **Parses** the schema into typed `CfnResourceSchema` objects.
 * 2. **Resolves** schema properties to their `ResolvedType` representations
 *    (primitives, model references, arrays, sets, maps).
 * 3. **Generates** valid TypeScript source code for `models.ts` and the
 *    initial `handlers.ts` scaffold.
 * 4. **Generates** project scaffold files (`package.json`, `tsconfig.json`,
 *    `template.yml`, `Makefile`, `README.md`, etc.).
 *
 * ## Example — generate models.ts
 *
 * ```typescript
 * import { resolveModels, generateModels } from './codegen';
 * import type { CfnResourceSchema } from './codegen';
 *
 * const schema: CfnResourceSchema = JSON.parse(schemaJson);
 * const models = resolveModels(schema);
 * const source = generateModels({
 *     libName: '@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib',
 *     typeName: schema.typeName,
 *     models,
 *     primaryIdentifier: schema.primaryIdentifier,
 *     additionalIdentifiers: schema.additionalIdentifiers,
 * });
 * // write source to src/models.ts
 * ```
 *
 * ## Example — generate full project scaffold
 *
 * ```typescript
 * import { generateHandlers, generatePackageJson, generateSamTemplate } from './codegen';
 *
 * const handlers = generateHandlers({ libName, typeName });
 * const pkgJson  = generatePackageJson({ libName, libVersion, typeName, projectName, ... });
 * const samYml   = generateSamTemplate({ typeName, entrypoint, testEntrypoint, runtime });
 * ```
 */

// Schema types
export type {
    CfnPropertySchema,
    CfnResourceSchema,
    CfnTypeConfigurationSchema,
} from './schema';

// Type resolution
export type { ContainerType, ResolvedType, ResolvedModels } from './resolver';
export { resolveModels } from './resolver';

// Translation helpers
export type { InnerType } from './translate';
export { translateType, getInnerType, containsModel } from './translate';

// Identifier utilities
export { safeReserved, lowercaseFirst, uppercaseFirst, tsPropName } from './utils';

// Code generation
export type { GenerateModelsOptions } from './generate-models';
export { generateModels, generateModelsFromSchema } from './generate-models';

export type { GenerateHandlersOptions } from './generate-handlers';
export { generateHandlers } from './generate-handlers';

export type { ScaffoldOptions } from './generate-scaffold';
export {
    generateGitignore,
    generateMakefile,
    generateNpmrc,
    generatePackageJson,
    generateReadme,
    generateSamIgnore,
    generateSamTemplate,
    generateSamTestCreate,
    generateTsConfig,
} from './generate-scaffold';
