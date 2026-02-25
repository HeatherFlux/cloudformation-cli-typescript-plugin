/**
 * Type translation helpers: convert `ResolvedType` nodes to TypeScript type
 * strings and extract the "inner type" metadata needed for `class-transformer`
 * decorator generation.
 *
 * TypeScript equivalent of the `translate_type`, `get_inner_type`, and
 * `contains_model` filter functions in `python/rpdk/typescript/resolver.py`.
 */

import type { ResolvedType } from './resolver';

// ---------------------------------------------------------------------------
// Type → TypeScript string
// ---------------------------------------------------------------------------

/**
 * Wrapper (boxed) type names used in `transformValue()` calls.
 * These correspond to the custom wrapper types exported by the support library.
 */
const PRIMITIVE_WRAPPERS: Record<string, string> = {
    string: 'String',
    integer: 'Integer',
    boolean: 'Boolean',
    number: 'Number',
    object: 'Object',
};

/**
 * Translate a resolved type to its full TypeScript type string.
 *
 * @example
 * translateType({ container: 'primitive', type: 'string' }) === 'string'
 * translateType({ container: 'list', type: { container: 'model', type: 'Tag' } }) === 'Array<Tag>'
 * translateType({ container: 'dict', type: { container: 'primitive', type: 'string' } }) === 'Map<string, string>'
 */
export function translateType(resolved: ResolvedType): string {
    switch (resolved.container) {
        case 'primitive':
        case 'model':
            return resolved.type as string;
        case 'multiple':
            return 'object';
        case 'list':
            return `Array<${translateType(resolved.type as ResolvedType)}>`;
        case 'set':
            return `Set<${translateType(resolved.type as ResolvedType)}>`;
        case 'dict':
            return `Map<string, ${translateType(resolved.type as ResolvedType)}>`;
    }
}

// ---------------------------------------------------------------------------
// Inner type extraction
// ---------------------------------------------------------------------------

/**
 * The "inner type" — the primitive or model class at the core of a resolved
 * type, plus the container class names layered around it.
 *
 * Used to generate `@Transform(transformValue(...))` decorator arguments.
 */
export interface InnerType {
    /** The primitive name or model class name at the core, e.g. `"string"` or `"Tag"`. */
    type: string;
    /**
     * The boxed/wrapper type name used in `transformValue()` calls.
     * For primitives this is e.g. `"String"`, `"Integer"`.
     * For models this equals `type`.
     */
    wrapperType: string;
    /**
     * Container class names from outermost inward, e.g. `["Array"]` or
     * `["Map", "Array"]`. Used as the last argument to `transformValue`.
     */
    classes: string[];
    /** True if the core type is a primitive (not a model). */
    primitive: boolean;
}

function collectInner(resolved: ResolvedType, classes: string[]): InnerType {
    switch (resolved.container) {
        case 'primitive':
        case 'multiple': {
            const type = resolved.type as string;
            return {
                type,
                wrapperType: PRIMITIVE_WRAPPERS[type] ?? 'Object',
                classes,
                primitive: true,
            };
        }
        case 'model': {
            const type = resolved.type as string;
            return { type, wrapperType: type, classes, primitive: false };
        }
        case 'list':
            return collectInner(resolved.type as ResolvedType, [...classes, 'Array']);
        case 'set':
            return collectInner(resolved.type as ResolvedType, [...classes, 'Set']);
        case 'dict':
            return collectInner(resolved.type as ResolvedType, [...classes, 'Map']);
    }
}

/**
 * Extract the inner type info needed to generate `@Transform` / `@Type`
 * decorator arguments for a property.
 */
export function getInnerType(resolved: ResolvedType): InnerType {
    return collectInner(resolved, []);
}

// ---------------------------------------------------------------------------
// Model detection
// ---------------------------------------------------------------------------

/**
 * Return `true` if the resolved type references a model class at any nesting
 * depth. When true the property uses `@Type(() => ModelClass)` instead of
 * `@Transform(transformValue(...))`.
 *
 * @example containsModel({ container: 'list', type: { container: 'model', type: 'Tag' } }) === true
 * @example containsModel({ container: 'list', type: { container: 'primitive', type: 'string' } }) === false
 */
export function containsModel(resolved: ResolvedType): boolean {
    switch (resolved.container) {
        case 'model':
            return true;
        case 'list':
        case 'set':
        case 'dict':
            return containsModel(resolved.type as ResolvedType);
        default:
            return false;
    }
}
