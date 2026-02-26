/**
 * Schema extensions for the submit command.
 *
 * Extends `CfnResourceSchema` with the `handlers` section that declares
 * IAM permissions needed by each CRUD+L handler.
 */

import type { CfnResourceSchema } from '../codegen/schema';

/** A single handler definition from the schema. */
interface HandlerDefinition {
    permissions: string[];
    timeoutInMinutes?: number;
}

/** Resource schema with the optional `handlers` section. */
export interface CfnResourceSchemaWithHandlers extends CfnResourceSchema {
    handlers?: {
        create?: HandlerDefinition;
        read?: HandlerDefinition;
        update?: HandlerDefinition;
        delete?: HandlerDefinition;
        list?: HandlerDefinition;
    };
}

/**
 * Extract the deduplicated union of all IAM permissions declared across
 * all handlers in the schema.
 *
 * @returns Sorted array of IAM action strings (e.g. `["s3:CreateBucket", "s3:DeleteBucket"]`).
 *          Empty array if no handlers or no permissions are declared.
 */
export function extractHandlerPermissions(
    schema: CfnResourceSchemaWithHandlers
): string[] {
    if (!schema.handlers) return [];

    const perms = new Set<string>();
    const handlers = Object.values(schema.handlers);
    for (const handler of handlers) {
        if (handler?.permissions) {
            for (const p of handler.permissions) {
                perms.add(p);
            }
        }
    }
    return [...perms].sort();
}
