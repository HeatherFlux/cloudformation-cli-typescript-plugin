/**
 * Type definitions for CloudFormation Resource Provider schemas.
 *
 * These represent the JSON structure of a CloudFormation resource provider
 * schema file (`.json`), as defined by the CloudFormation CLI specification:
 * https://docs.aws.amazon.com/cloudformation-cli/latest/userguide/resource-type-schema.html
 */

/**
 * A single JSON Schema property definition within a resource schema.
 * Properties can be primitive types, references to definitions, arrays,
 * objects (maps), or oneOf/anyOf union types.
 */
export interface CfnPropertySchema {
    type?: string | string[];
    $ref?: string;
    items?: CfnPropertySchema;
    additionalProperties?: CfnPropertySchema | boolean;
    properties?: Record<string, CfnPropertySchema>;
    uniqueItems?: boolean;
    /** When true, items maintain insertion order even if uniqueItems is set. */
    insertionOrder?: boolean;
    oneOf?: CfnPropertySchema[];
    anyOf?: CfnPropertySchema[];
    allOf?: CfnPropertySchema[];
    description?: string;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
}

/** Tagging configuration for a resource type. */
export interface CfnTaggingConfig {
    taggable?: boolean;
    tagOnCreate?: boolean;
    tagUpdatable?: boolean;
    cloudFormationSystemTags?: boolean;
    tagProperty?: string;
}

/**
 * The top-level CloudFormation Resource Provider schema.
 * This is the structure of the `.json` schema file in a resource provider project.
 */
export interface CfnResourceSchema {
    /** The resource type name in the format `Organization::Service::Resource`. */
    typeName: string;
    description?: string;
    /** The resource's top-level properties. */
    properties: Record<string, CfnPropertySchema>;
    /** Reusable sub-schemas referenced via `$ref`. */
    definitions?: Record<string, CfnPropertySchema>;
    /** JSON pointers to the property/properties that form the primary identifier. */
    primaryIdentifier?: string[];
    /** Additional composite identifiers, each being a list of JSON pointers. */
    additionalIdentifiers?: string[][];
    /** Properties that cannot be set by the user (computed by the service). */
    readOnlyProperties?: string[];
    /** Properties that are accepted on write but not returned on read. */
    writeOnlyProperties?: string[];
    /** Properties that can only be set at creation time. */
    createOnlyProperties?: string[];
    /** Required properties for resource creation. */
    required?: string[];
    additionalProperties?: boolean;
    tagging?: CfnTaggingConfig;
}

/**
 * Optional type configuration schema — an additional resource schema for
 * type-level configuration, resolved as `TypeConfigurationModel`.
 */
export type CfnTypeConfigurationSchema = CfnResourceSchema;
