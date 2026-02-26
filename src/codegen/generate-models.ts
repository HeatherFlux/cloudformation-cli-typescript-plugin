/**
 * Generate a `models.ts` source file from a resolved CloudFormation schema.
 *
 * This is the TypeScript equivalent of the Jinja2 template at
 * `python/rpdk/typescript/templates/models.ts`. Instead of a templating
 * engine it uses plain string building, giving full type safety and
 * IDE support.
 */

import { resolveModels } from './resolver';
import type { ResolvedModels, ResolvedType } from './resolver';
import type { CfnResourceSchema } from './schema';
import { containsModel, getInnerType, translateType } from './translate';
import { tsPropName, uppercaseFirst } from './utils';

/** Options controlling how models.ts is generated. */
export interface GenerateModelsOptions {
    /** The support library package name to import from. */
    libName: string;
    /** The CloudFormation type name, e.g. `"Org::Service::Resource"`. */
    typeName: string;
    /** Resolved model map from `resolveModels()`. */
    models: ResolvedModels;
    /** Primary identifier paths from the schema, e.g. `["/properties/Id"]`. */
    primaryIdentifier?: string[];
    /** Additional identifier sets, each a list of paths. */
    additionalIdentifiers?: string[][];
    /** Whether a TypeConfigurationModel was generated (controls import). */
    containsTypeConfiguration?: boolean;
}

// ---------------------------------------------------------------------------
// Identifier path helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON pointer like `"/properties/BucketName"` into its component
 * parts below `/properties/`, e.g. `["BucketName"]`.
 * For nested paths like `"/properties/Config/Timeout"` returns `["Config", "Timeout"]`.
 */
function identifierComponents(path: string): string[] {
    // e.g. "/properties/BucketName" → ["", "properties", "BucketName"]
    const parts = path.split('/');
    return parts.slice(2); // drop "" and "properties"
}

/**
 * The IDENTIFIER_KEY constant name for a given path,
 * e.g. `"/properties/Id"` → `"IDENTIFIER_KEY_ID"`.
 */
function identifierKeyName(path: string): string {
    return `IDENTIFIER_KEY_${identifierComponents(path).join('_').toUpperCase()}`;
}

/**
 * The TypeScript property access chain for an identifier path,
 * e.g. `"/properties/Config/Timeout"` → `this.config.timeout`.
 */
function identifierAccessChain(path: string): string {
    return 'this.' + identifierComponents(path).map(tsPropName).join('.');
}

/**
 * Build a null-guard condition for the identifier access chain.
 * For `/properties/Id`: `this.id != null`
 * For `/properties/Config/Timeout`: `this.config != null && this.config.timeout != null`
 */
function identifierNullGuard(path: string): string {
    const components = identifierComponents(path);
    const guards: string[] = [];
    for (let i = 1; i <= components.length; i++) {
        const chain = 'this.' + components.slice(0, i).map(tsPropName).join('.');
        guards.push(`${chain} != null`);
    }
    return guards.join('\n            && ');
}

// ---------------------------------------------------------------------------
// Property decorator generation
// ---------------------------------------------------------------------------

function generatePropertyDecorators(
    propName: string,
    resolved: ResolvedType,
    tsName: string
): string {
    const lines: string[] = [];
    lines.push(`    @Expose({ name: '${propName}' })`);

    if (containsModel(resolved)) {
        const inner = getInnerType(resolved);
        lines.push(`    @Type(() => ${inner.type})`);
    } else {
        const inner = getInnerType(resolved);
        const classArgs = inner.classes.join(', ');
        lines.push(
            `    @Transform(`,
            `        (params: TransformFnParams) =>`,
            `            transformValue(${inner.wrapperType}, '${tsName}', params.value, params.obj, [${classArgs}]),`,
            `        {`,
            `            toClassOnly: true,`,
            `        }`,
            `    )`
        );
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Identifier method generation
// ---------------------------------------------------------------------------

function generateGetPrimaryIdentifier(primaryIdentifier: string[]): string {
    const body: string[] = [];

    for (const path of primaryIdentifier) {
        const keyConst = identifierKeyName(path);
        const nullGuard = identifierNullGuard(path);
        const accessChain = identifierAccessChain(path);
        body.push(
            `        if (${nullGuard}) {`,
            `            identifier[this.${keyConst}] = ${accessChain};`,
            `        }`
        );
    }

    return [
        `    @Exclude()`,
        `    public getPrimaryIdentifier(): Dict {`,
        `        const identifier: Dict = {};`,
        ...body,
        `        // only return the identifier if it can be used, i.e. if all components are present`,
        `        return Object.keys(identifier).length === ${primaryIdentifier.length} ? identifier : null;`,
        `    }`,
    ].join('\n');
}

function generateGetAdditionalIdentifiers(additionalIdentifiers: string[][]): string {
    const methodCalls = additionalIdentifiers.map((ids) => {
        const suffix = ids
            .map((id) => `_${uppercaseFirst(id.split('/').at(-1)!)}`)
            .join('');
        return `        if (this.getIdentifier${suffix}() != null) {\n            identifiers.push(this.getIdentifier${suffix}());\n        }`;
    });

    return [
        `    @Exclude()`,
        `    public getAdditionalIdentifiers(): Array<Dict> {`,
        `        const identifiers: Array<Dict> = new Array<Dict>();`,
        ...methodCalls,
        `        // only return the identifiers if any can be used`,
        `        return identifiers.length === 0 ? null : identifiers;`,
        `    }`,
    ].join('\n');
}

function generateIdentifierGetter(identifiers: string[]): string {
    const suffix = identifiers
        .map((id) => `_${uppercaseFirst(id.split('/').at(-1)!)}`)
        .join('');
    const body: string[] = [];

    for (const path of identifiers) {
        const keyConst = identifierKeyName(path);
        const nullGuard = identifierNullGuard(path);
        const accessChain = identifierAccessChain(path);
        body.push(
            `        if (${nullGuard}) {`,
            `            identifier[this.${keyConst}] = ${accessChain};`,
            `        }`
        );
    }

    return [
        `    @Exclude()`,
        `    public getIdentifier${suffix}(): Dict {`,
        `        const identifier: Dict = {};`,
        ...body,
        `        // only return the identifier if it can be used, i.e. if all components are present`,
        `        return Object.keys(identifier).length === ${identifiers.length} ? identifier : null;`,
        `    }`,
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Class generation
// ---------------------------------------------------------------------------

/**
 * Internal options type that guarantees `primaryIdentifier` and
 * `additionalIdentifiers` are present (they have already been defaulted to `[]`
 * by `generateModels` before this function is called).
 */
type ResolvedGenerateOptions = GenerateModelsOptions & {
    primaryIdentifier: string[];
    additionalIdentifiers: string[][];
};

function generateModelClass(
    modelName: string,
    properties: Record<string, ResolvedType>,
    options: ResolvedGenerateOptions
): string {
    const { typeName, primaryIdentifier, additionalIdentifiers } = options;

    const isRoot = modelName === 'ResourceModel';
    const lines: string[] = [];

    lines.push(`export class ${modelName} extends BaseModel {`);

    if (isRoot) {
        lines.push(`    @Exclude()`);
        lines.push(`    public static readonly TYPE_NAME: string = '${typeName}';`);
        lines.push('');

        // Collect all identifier paths, deduplicating across primary and additional
        const emittedKeys = new Set<string>();
        const allIdentifierPaths = [
            ...primaryIdentifier,
            ...additionalIdentifiers.flat(),
        ];
        for (const idPath of allIdentifierPaths) {
            const keyName = identifierKeyName(idPath);
            if (!emittedKeys.has(keyName)) {
                emittedKeys.add(keyName);
                lines.push(`    @Exclude()`);
                lines.push(`    protected readonly ${keyName}: string = '${idPath}';`);
                lines.push('');
            }
        }
    }

    for (const [propName, resolved] of Object.entries(properties)) {
        const tsName = tsPropName(propName);
        const tsType = translateType(resolved);
        lines.push(generatePropertyDecorators(propName, resolved, tsName));
        lines.push(`    ${tsName}?: Optional<${tsType}>;`);
        lines.push('');
    }

    if (isRoot) {
        lines.push(generateGetPrimaryIdentifier(primaryIdentifier));
        lines.push('');
        lines.push(generateGetAdditionalIdentifiers(additionalIdentifiers));

        for (const ids of additionalIdentifiers) {
            lines.push('');
            lines.push(generateIdentifierGetter(ids));
        }
    }

    lines.push('}');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the full `models.ts` source string for a resource provider project.
 *
 * @example
 * ```typescript
 * const schema = JSON.parse(await fs.readFile('my-resource.json', 'utf8'));
 * const models = resolveModels(schema);
 * const source = generateModels({ libName: '@acme/cfn-lib', typeName: schema.typeName, models });
 * await fs.writeFile('src/models.ts', source, 'utf8');
 * ```
 */
export function generateModels(options: GenerateModelsOptions): string {
    const {
        libName,
        models,
        primaryIdentifier = [],
        additionalIdentifiers = [],
    } = options;

    const parts: string[] = [];

    parts.push('// This is a generated file. Modifications will be overwritten.');
    parts.push(
        `import { BaseModel, Dict, integer, Integer, Optional, transformValue } from '${libName}';`
    );
    parts.push(
        `import { Exclude, Expose, Type, Transform, TransformFnParams } from 'class-transformer';`
    );
    parts.push('');

    for (const [modelName, properties] of Object.entries(models)) {
        parts.push(
            generateModelClass(modelName, properties, {
                ...options,
                primaryIdentifier,
                additionalIdentifiers,
            })
        );
        parts.push('');
    }

    return parts.join('\n');
}

/**
 * Convenience wrapper that resolves models from a schema and generates
 * the full `models.ts` source in one call.
 *
 * @param schema     The parsed CloudFormation resource schema.
 * @param libName    The support library package name.
 * @param extraModels Additional resolved models to merge in (e.g., from a
 *                   type configuration schema).
 */
export function generateModelsFromSchema(
    schema: CfnResourceSchema,
    libName: string,
    extraModels?: ResolvedModels
): string {
    const models = resolveModels(schema);
    if (extraModels) {
        Object.assign(models, extraModels);
    }

    return generateModels({
        libName,
        typeName: schema.typeName,
        models,
        primaryIdentifier: schema.primaryIdentifier ?? [],
        additionalIdentifiers: schema.additionalIdentifiers ?? [],
    });
}
