/**
 * Schema resolver: maps CloudFormation resource provider schema properties
 * to their resolved TypeScript type representations.
 *
 * This is the TypeScript equivalent of `python/rpdk/typescript/resolver.py`
 * and `rpdk.core.jsonutils.resolver.resolve_models()`.
 */

import type { CfnPropertySchema, CfnResourceSchema } from './schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Represents how a TypeScript type is containerized:
 * - `primitive` — a scalar type: string, integer, number, boolean, or object
 * - `model`     — a reference to another model class
 * - `list`      — Array<T>
 * - `set`       — Set<T>  (uniqueItems=true, insertionOrder!=true)
 * - `dict`      — Map<string, T>  (object with additionalProperties)
 * - `multiple`  — oneOf / anyOf — becomes `object`
 */
export type ContainerType =
    | 'primitive'
    | 'model'
    | 'list'
    | 'set'
    | 'dict'
    | 'multiple';

/**
 * A fully-resolved type node for a schema property.
 *
 * For container types (`list`, `set`, `dict`), `type` is the nested `ResolvedType`.
 * For `primitive` and `model`, `type` is a string (the type name or model name).
 * For `multiple`, `type` is always `"object"`.
 */
export interface ResolvedType {
    container: ContainerType;
    type: string | ResolvedType;
}

/**
 * A fully-resolved model map: model name → (property name → resolved type).
 * The root resource model is always keyed as `"ResourceModel"` (or the
 * name passed to `resolveModels`).
 */
export type ResolvedModels = Record<string, Record<string, ResolvedType>>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** CloudFormation schema primitive types → TypeScript type names. */
const PRIMITIVE_MAP: Record<string, string> = {
    string: 'string',
    integer: 'integer',
    boolean: 'boolean',
    number: 'number',
};

/** Extract the definition name from a `$ref` value like `#/definitions/Tag`. */
function refToName(ref: string): string {
    const parts = ref.split('/');
    return parts[parts.length - 1];
}

/**
 * Determine whether a definition schema is a simple primitive wrapper
 * (e.g., a string enum) rather than a proper model class.
 */
function isPrimitiveDefinition(def: CfnPropertySchema): boolean {
    const t = Array.isArray(def.type) ? def.type[0] : def.type;
    return !!t && t in PRIMITIVE_MAP;
}

/**
 * Resolve a single property schema node to its `ResolvedType`.
 *
 * Handles: $ref, oneOf/anyOf, array (list/set), object+additionalProperties
 * (dict), and primitive scalar types.
 */
function resolveProperty(
    prop: CfnPropertySchema,
    definitions: Record<string, CfnPropertySchema>
): ResolvedType {
    // $ref → model, primitive alias, or inline-resolved type
    if (prop.$ref) {
        const name = refToName(prop.$ref);
        const def = definitions[name];
        if (def) {
            if (isPrimitiveDefinition(def)) {
                const t = Array.isArray(def.type) ? def.type[0] : (def.type as string);
                return { container: 'primitive', type: PRIMITIVE_MAP[t] };
            }
            // If the definition is not a proper model (no properties), resolve it inline
            // This handles list/map aliases and type-less definitions
            const defType = Array.isArray(def.type) ? def.type[0] : def.type;
            if (defType !== 'object' || !def.properties) {
                return resolveProperty(def, definitions);
            }
        }
        return { container: 'model', type: name };
    }

    // oneOf / anyOf → multiple (object)
    if (prop.oneOf || prop.anyOf) {
        return { container: 'multiple', type: 'object' };
    }

    const typeStr = Array.isArray(prop.type) ? prop.type[0] : prop.type;

    // array → list or set (uniqueItems=true without insertionOrder=true)
    if (typeStr === 'array' && prop.items) {
        const inner = resolveProperty(prop.items, definitions);
        if (prop.uniqueItems && prop.insertionOrder !== true) {
            return { container: 'set', type: inner };
        }
        return { container: 'list', type: inner };
    }

    // object + additionalProperties object → dict / map
    if (
        typeStr === 'object' &&
        prop.additionalProperties &&
        typeof prop.additionalProperties !== 'boolean'
    ) {
        const valueType = resolveProperty(prop.additionalProperties, definitions);
        return { container: 'dict', type: valueType };
    }

    // primitive scalar
    if (typeStr && PRIMITIVE_MAP[typeStr]) {
        return { container: 'primitive', type: PRIMITIVE_MAP[typeStr] };
    }

    // fallback: treat as opaque object
    return { container: 'primitive', type: 'object' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve all models from a CloudFormation resource schema.
 *
 * Produces a `ResolvedModels` map with:
 * - `rootName` (default `"ResourceModel"`) for the top-level resource properties
 * - One entry per `definitions` object that has `properties` (i.e., is a model class)
 *
 * Primitive-only definitions (string enums, etc.) are not emitted as model
 * entries — they are inlined at usage sites as primitives.
 *
 * @param schema       The parsed CloudFormation resource schema.
 * @param rootName     The name for the root model class (default `"ResourceModel"`).
 */
export function resolveModels(
    schema: CfnResourceSchema,
    rootName = 'ResourceModel'
): ResolvedModels {
    const definitions = schema.definitions ?? {};
    const result: ResolvedModels = {};

    // Root resource properties → ResourceModel
    result[rootName] = {};
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
        result[rootName][propName] = resolveProperty(propSchema, definitions);
    }

    // Definitions → sub-model classes (skip non-object / primitive aliases)
    for (const [defName, defSchema] of Object.entries(definitions)) {
        if (defSchema.type === 'object' && defSchema.properties) {
            result[defName] = {};
            for (const [propName, propSchema] of Object.entries(defSchema.properties)) {
                result[defName][propName] = resolveProperty(propSchema, definitions);
            }
        }
    }

    return result;
}
