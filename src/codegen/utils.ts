/**
 * Utilities for generating valid TypeScript identifiers from CloudFormation
 * schema property names.
 *
 * TypeScript equivalent of `python/rpdk/typescript/utils.py`.
 */

/**
 * TypeScript language keywords and reserved identifiers.
 *
 * When a CloudFormation property name collides with one of these,
 * we append an underscore to form a valid identifier.
 *
 * Source: https://github.com/Microsoft/TypeScript/issues/2536
 */
export const LANGUAGE_KEYWORDS: ReadonlySet<string> = new Set([
    'abstract',
    'any',
    'as',
    'async',
    'await',
    'bigint',
    'boolean',
    'break',
    'case',
    'catch',
    'class',
    'configurable',
    'const',
    'constructor',
    'continue',
    'debugger',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'enumerable',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'in',
    'implements',
    'import',
    'instanceof',
    'interface',
    'is',
    'let',
    'module',
    'namespace',
    'never',
    'new',
    'null',
    'number',
    'of',
    'package',
    'private',
    'protected',
    'public',
    'readonly',
    'require',
    'return',
    'set',
    'static',
    'string',
    'super',
    'switch',
    'symbol',
    'this',
    'throw',
    'true',
    'try',
    'type',
    'typeof',
    'undefined',
    'value',
    'var',
    'void',
    'while',
    'with',
    'writable',
    'yield',
]);

/**
 * Append `_` to any name that collides with a TypeScript keyword.
 *
 * @example safeReserved('type') === 'type_'
 * @example safeReserved('Name') === 'Name'
 */
export function safeReserved(name: string): string {
    return LANGUAGE_KEYWORDS.has(name) ? `${name}_` : name;
}

/** Lowercase the first character of a string. */
export function lowercaseFirst(str: string): string {
    if (!str) return str;
    return str.charAt(0).toLowerCase() + str.slice(1);
}

/** Uppercase the first character of a string. */
export function uppercaseFirst(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a CloudFormation property name (PascalCase) to a TypeScript
 * property identifier (camelCase), escaping reserved words.
 *
 * @example tsPropName('Type') === 'type_'
 * @example tsPropName('BucketName') === 'bucketName'
 */
export function tsPropName(name: string): string {
    return safeReserved(lowercaseFirst(name));
}
