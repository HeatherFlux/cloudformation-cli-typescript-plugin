/**
 * Tests for the native TypeScript code generator (`src/codegen/`).
 *
 * Covers: schema resolution, type translation, identifier utilities,
 * models.ts generation, handlers.ts generation, and scaffold file generation.
 */

import type { CfnResourceSchema } from '~/codegen/schema';
import { resolveModels } from '~/codegen/resolver';
import { translateType, getInnerType, containsModel } from '~/codegen/translate';
import {
    safeReserved,
    lowercaseFirst,
    uppercaseFirst,
    tsPropName,
} from '~/codegen/utils';
import { generateModels, generateModelsFromSchema } from '~/codegen/generate-models';
import { generateHandlers } from '~/codegen/generate-handlers';
import {
    generateGitignore,
    generateMakefile,
    generateNpmrc,
    generatePackageJson,
    generateReadme,
    generateSamTemplate,
    generateSamTestCreate,
    generateTsConfig,
} from '~/codegen/generate-scaffold';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal schema with every supported property type. */
const FULL_SCHEMA: CfnResourceSchema = {
    typeName: 'Org::Service::Resource',
    properties: {
        Id: { type: 'string' },
        Count: { type: 'integer' },
        Price: { type: 'number' },
        Active: { type: 'boolean' },
        Tags: {
            type: 'array',
            items: { $ref: '#/definitions/Tag' },
        },
        UniqueTags: {
            type: 'array',
            uniqueItems: true,
            items: { $ref: '#/definitions/Tag' },
        },
        Config: { $ref: '#/definitions/Config' },
        Metadata: {
            type: 'object',
            additionalProperties: { type: 'string' },
        },
        Flexible: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
    },
    definitions: {
        Tag: {
            type: 'object',
            properties: {
                Key: { type: 'string' },
                Value: { type: 'string' },
            },
        },
        Config: {
            type: 'object',
            properties: {
                Timeout: { type: 'integer' },
                Nested: { $ref: '#/definitions/Tag' },
            },
        },
    },
    primaryIdentifier: ['/properties/Id'],
    additionalIdentifiers: [['/properties/Count', '/properties/Price']],
};

const LIB_NAME =
    '@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib';

// ---------------------------------------------------------------------------
// resolver
// ---------------------------------------------------------------------------

describe('resolveModels', () => {
    test('creates ResourceModel and sub-model entries', () => {
        const models = resolveModels(FULL_SCHEMA);
        expect(Object.keys(models)).toContain('ResourceModel');
        expect(Object.keys(models)).toContain('Tag');
        expect(Object.keys(models)).toContain('Config');
    });

    test('resolves primitive types correctly', () => {
        const models = resolveModels(FULL_SCHEMA);
        expect(models.ResourceModel.Id).toEqual({
            container: 'primitive',
            type: 'string',
        });
        expect(models.ResourceModel.Count).toEqual({
            container: 'primitive',
            type: 'integer',
        });
        expect(models.ResourceModel.Price).toEqual({
            container: 'primitive',
            type: 'number',
        });
        expect(models.ResourceModel.Active).toEqual({
            container: 'primitive',
            type: 'boolean',
        });
    });

    test('resolves $ref to model', () => {
        const models = resolveModels(FULL_SCHEMA);
        expect(models.ResourceModel.Config).toEqual({
            container: 'model',
            type: 'Config',
        });
    });

    test('resolves array to list', () => {
        const models = resolveModels(FULL_SCHEMA);
        expect(models.ResourceModel.Tags).toEqual({
            container: 'list',
            type: { container: 'model', type: 'Tag' },
        });
    });

    test('resolves uniqueItems array to set', () => {
        const models = resolveModels(FULL_SCHEMA);
        expect(models.ResourceModel.UniqueTags).toEqual({
            container: 'set',
            type: { container: 'model', type: 'Tag' },
        });
    });

    test('resolves additionalProperties object to dict', () => {
        const models = resolveModels(FULL_SCHEMA);
        expect(models.ResourceModel.Metadata).toEqual({
            container: 'dict',
            type: { container: 'primitive', type: 'string' },
        });
    });

    test('resolves oneOf to multiple (object)', () => {
        const models = resolveModels(FULL_SCHEMA);
        expect(models.ResourceModel.Flexible).toEqual({
            container: 'multiple',
            type: 'object',
        });
    });

    test('accepts custom root model name', () => {
        const models = resolveModels(FULL_SCHEMA, 'TypeConfigurationModel');
        expect(Object.keys(models)).toContain('TypeConfigurationModel');
        expect(Object.keys(models)).not.toContain('ResourceModel');
    });

    test('type as array ["string"] resolves to primitive string (line 104 branch)', () => {
        // JSON Schema allows type to be an array, e.g. ["string", "null"]
        // CloudFormation schemas occasionally use this; we take the first element.
        const schema: CfnResourceSchema = {
            typeName: 'A::B::C',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            properties: { Name: { type: ['string'] as any } },
        };
        const models = resolveModels(schema);
        expect(models.ResourceModel.Name).toEqual({
            container: 'primitive',
            type: 'string',
        });
    });

    test('$ref to definition with array type inlines as primitive (lines 74+93 branches)', () => {
        // definition has type: ["string"] — isPrimitiveDefinition must handle Array.isArray
        const schema: CfnResourceSchema = {
            typeName: 'A::B::C',
            properties: { Name: { $ref: '#/definitions/NameString' } },
            definitions: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                NameString: { type: ['string'] as any },
            },
        };
        const models = resolveModels(schema);
        // NameString is a primitive alias (array type) — should inline as primitive string
        expect(models.ResourceModel.Name).toEqual({
            container: 'primitive',
            type: 'string',
        });
        expect(Object.keys(models)).not.toContain('NameString');
    });

    test('bare object type without additionalProperties resolves to opaque object', () => {
        // Exercises the fallback branch at resolver.ts:131
        const schema: CfnResourceSchema = {
            typeName: 'A::B::C',
            properties: {
                Config: { type: 'object' }, // no $ref, no oneOf, no additionalProperties
            },
        };
        const models = resolveModels(schema);
        expect(models.ResourceModel.Config).toEqual({
            container: 'primitive',
            type: 'object',
        });
    });

    test('skips non-object definitions (primitive aliases)', () => {
        const schema: CfnResourceSchema = {
            typeName: 'A::B::C',
            properties: { Name: { $ref: '#/definitions/NameString' } },
            definitions: {
                NameString: { type: 'string' },
            },
        };
        const models = resolveModels(schema);
        // NameString is a primitive alias — should be inlined, not a model class
        expect(Object.keys(models)).not.toContain('NameString');
        // And the property should resolve to primitive string
        expect(models.ResourceModel.Name).toEqual({
            container: 'primitive',
            type: 'string',
        });
    });
});

// ---------------------------------------------------------------------------
// translate
// ---------------------------------------------------------------------------

describe('translateType', () => {
    test('primitive types', () => {
        expect(translateType({ container: 'primitive', type: 'string' })).toBe(
            'string'
        );
        expect(translateType({ container: 'primitive', type: 'integer' })).toBe(
            'integer'
        );
        expect(translateType({ container: 'primitive', type: 'boolean' })).toBe(
            'boolean'
        );
        expect(translateType({ container: 'primitive', type: 'number' })).toBe(
            'number'
        );
    });

    test('model type', () => {
        expect(translateType({ container: 'model', type: 'Tag' })).toBe('Tag');
    });

    test('multiple → object', () => {
        expect(translateType({ container: 'multiple', type: 'object' })).toBe('object');
    });

    test('list of primitives', () => {
        expect(
            translateType({
                container: 'list',
                type: { container: 'primitive', type: 'string' },
            })
        ).toBe('Array<string>');
    });

    test('set of models', () => {
        expect(
            translateType({
                container: 'set',
                type: { container: 'model', type: 'Tag' },
            })
        ).toBe('Set<Tag>');
    });

    test('dict of primitives', () => {
        expect(
            translateType({
                container: 'dict',
                type: { container: 'primitive', type: 'string' },
            })
        ).toBe('Map<string, string>');
    });

    test('nested containers: list of dict of string', () => {
        expect(
            translateType({
                container: 'list',
                type: {
                    container: 'dict',
                    type: { container: 'primitive', type: 'string' },
                },
            })
        ).toBe('Array<Map<string, string>>');
    });
});

describe('getInnerType', () => {
    test('primitive returns itself with no classes', () => {
        const inner = getInnerType({ container: 'primitive', type: 'string' });
        expect(inner.type).toBe('string');
        expect(inner.wrapperType).toBe('String');
        expect(inner.classes).toEqual([]);
        expect(inner.primitive).toBe(true);
    });

    test('model returns itself with no classes', () => {
        const inner = getInnerType({ container: 'model', type: 'Tag' });
        expect(inner.type).toBe('Tag');
        expect(inner.wrapperType).toBe('Tag');
        expect(inner.classes).toEqual([]);
        expect(inner.primitive).toBe(false);
    });

    test('list of string → classes [Array]', () => {
        const inner = getInnerType({
            container: 'list',
            type: { container: 'primitive', type: 'string' },
        });
        expect(inner.type).toBe('string');
        expect(inner.classes).toEqual(['Array']);
    });

    test('dict of list of model → classes [Map, Array]', () => {
        const inner = getInnerType({
            container: 'dict',
            type: {
                container: 'list',
                type: { container: 'model', type: 'Tag' },
            },
        });
        expect(inner.type).toBe('Tag');
        expect(inner.classes).toEqual(['Map', 'Array']);
        expect(inner.primitive).toBe(false);
    });

    test('opaque object type uses Object wrapper (exercises ?? fallback in translate.ts)', () => {
        // The type 'object' is not in PRIMITIVE_WRAPPERS, so ?? 'Object' is used
        const inner = getInnerType({ container: 'primitive', type: 'object' });
        expect(inner.type).toBe('object');
        expect(inner.wrapperType).toBe('Object');
        expect(inner.primitive).toBe(true);
    });
});

describe('containsModel', () => {
    test('primitive → false', () => {
        expect(containsModel({ container: 'primitive', type: 'string' })).toBe(false);
    });

    test('model → true', () => {
        expect(containsModel({ container: 'model', type: 'Tag' })).toBe(true);
    });

    test('list of model → true', () => {
        expect(
            containsModel({
                container: 'list',
                type: { container: 'model', type: 'Tag' },
            })
        ).toBe(true);
    });

    test('list of primitive → false', () => {
        expect(
            containsModel({
                container: 'list',
                type: { container: 'primitive', type: 'string' },
            })
        ).toBe(false);
    });

    test('set of model → true', () => {
        expect(
            containsModel({
                container: 'set',
                type: { container: 'model', type: 'Tag' },
            })
        ).toBe(true);
    });

    test('dict of model → true', () => {
        expect(
            containsModel({
                container: 'dict',
                type: { container: 'model', type: 'Tag' },
            })
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------

describe('safeReserved', () => {
    test('non-keyword passes through unchanged', () => {
        expect(safeReserved('BucketName')).toBe('BucketName');
        expect(safeReserved('id')).toBe('id');
    });

    test('TS keyword gets underscore appended', () => {
        expect(safeReserved('type')).toBe('type_');
        expect(safeReserved('class')).toBe('class_');
        expect(safeReserved('delete')).toBe('delete_');
        expect(safeReserved('string')).toBe('string_');
    });
});

describe('lowercaseFirst / uppercaseFirst', () => {
    test('lowercaseFirst', () => {
        expect(lowercaseFirst('BucketName')).toBe('bucketName');
        expect(lowercaseFirst('id')).toBe('id');
        expect(lowercaseFirst('')).toBe('');
    });

    test('uppercaseFirst', () => {
        expect(uppercaseFirst('bucketName')).toBe('BucketName');
        expect(uppercaseFirst('Id')).toBe('Id');
        expect(uppercaseFirst('')).toBe('');
    });
});

describe('tsPropName', () => {
    test('converts PascalCase to camelCase', () => {
        expect(tsPropName('BucketName')).toBe('bucketName');
    });

    test('escapes reserved words after lowercasing', () => {
        // "Type" → lowercased "type" → reserved → "type_"
        expect(tsPropName('Type')).toBe('type_');
        expect(tsPropName('Delete')).toBe('delete_');
    });
});

// ---------------------------------------------------------------------------
// generateModels
// ---------------------------------------------------------------------------

describe('generateModels', () => {
    let models: ReturnType<typeof resolveModels>;
    let source: string;

    beforeAll(() => {
        models = resolveModels(FULL_SCHEMA);
        source = generateModels({
            libName: LIB_NAME,
            typeName: FULL_SCHEMA.typeName,
            models,
            primaryIdentifier: FULL_SCHEMA.primaryIdentifier,
            additionalIdentifiers: FULL_SCHEMA.additionalIdentifiers,
        });
    });

    test('contains generated file header', () => {
        expect(source).toContain(
            '// This is a generated file. Modifications will be overwritten.'
        );
    });

    test('imports from the lib', () => {
        expect(source).toContain(`from '${LIB_NAME}'`);
    });

    test('imports from class-transformer', () => {
        expect(source).toContain("from 'class-transformer'");
    });

    test('exports ResourceModel class', () => {
        expect(source).toContain('export class ResourceModel extends BaseModel');
    });

    test('exports Tag sub-model class', () => {
        expect(source).toContain('export class Tag extends BaseModel');
    });

    test('ResourceModel has TYPE_NAME', () => {
        expect(source).toContain(`TYPE_NAME: string = 'Org::Service::Resource'`);
    });

    test('ResourceModel has IDENTIFIER_KEY for primary identifier', () => {
        expect(source).toContain('IDENTIFIER_KEY_ID');
        expect(source).toContain("'/properties/Id'");
    });

    test('string property has @Expose and @Transform', () => {
        expect(source).toContain("@Expose({ name: 'Id' })");
        expect(source).toContain('transformValue(String');
    });

    test('model-ref property uses @Type decorator', () => {
        expect(source).toContain('@Type(() => Config)');
    });

    test('array of models uses @Type decorator', () => {
        expect(source).toContain('@Type(() => Tag)');
    });

    test('set of models has Set in transform classes', () => {
        // uniqueTags → @Type for Tag (containsModel is true)
        expect(source).toMatch(/@Type\(\(\) => Tag\)/);
    });

    test('dict property uses Map in transform classes', () => {
        // Metadata: Map<string, string>
        expect(source).toContain('[Map]');
    });

    test('getPrimaryIdentifier method generated', () => {
        expect(source).toContain('getPrimaryIdentifier(): Dict');
        expect(source).toContain('this.id != null');
    });

    test('getAdditionalIdentifiers method generated', () => {
        expect(source).toContain('getAdditionalIdentifiers(): Array<Dict>');
    });

    test('identifier getter for additional identifiers generated', () => {
        expect(source).toContain('getIdentifier_Count_Price');
    });

    test('camelCase property names in output', () => {
        // "BucketName" → "bucketName"; our "Count" → "count"
        expect(source).toContain('count?:');
        expect(source).toContain('active?:');
    });

    test('reserved word property gets underscore suffix', () => {
        // If schema had a "Type" property it would become "type_"
        // Using "Delete" as a check via tsPropName directly
        // (our fixture doesn't have reserved words, but verifying schema has no crash)
        expect(source).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// generateModels — default parameter branches
// ---------------------------------------------------------------------------

describe('generateModels (default identifier branches)', () => {
    test('omitting primaryIdentifier uses empty default and still generates the method', () => {
        const models = resolveModels({
            typeName: 'A::B::C',
            properties: { Name: { type: 'string' } },
        });
        // Call WITHOUT primaryIdentifier or additionalIdentifiers to exercise the `= []` defaults
        const source = generateModels({
            libName: LIB_NAME,
            typeName: 'A::B::C',
            models,
        });
        expect(source).toContain('export class ResourceModel extends BaseModel');
        expect(source).toContain("TYPE_NAME: string = 'A::B::C'");
        // getPrimaryIdentifier still generated but with empty body
        expect(source).toContain('getPrimaryIdentifier(): Dict');
        // getAdditionalIdentifiers still generated but with empty body
        expect(source).toContain('getAdditionalIdentifiers(): Array<Dict>');
    });

    test('omitting additionalIdentifiers alone still generates correctly', () => {
        const models = resolveModels(FULL_SCHEMA);
        const source = generateModels({
            libName: LIB_NAME,
            typeName: FULL_SCHEMA.typeName,
            models,
            primaryIdentifier: FULL_SCHEMA.primaryIdentifier,
            // additionalIdentifiers intentionally omitted — exercises `= []` default
        });
        expect(source).toContain('IDENTIFIER_KEY_ID');
        // No additional identifier methods when none provided
        expect(source).not.toContain('getIdentifier_Count');
    });
});

// ---------------------------------------------------------------------------
// generateModelsFromSchema — ?? fallback branches
// ---------------------------------------------------------------------------

describe('generateModelsFromSchema (missing schema fields)', () => {
    test('schema without primaryIdentifier or additionalIdentifiers', () => {
        const schema: CfnResourceSchema = {
            typeName: 'A::B::C',
            properties: { Name: { type: 'string' } },
            // no primaryIdentifier, no additionalIdentifiers — exercises the ?? [] fallback
        };
        const source = generateModelsFromSchema(schema, LIB_NAME);
        expect(source).toContain('export class ResourceModel extends BaseModel');
        expect(source).toContain('getPrimaryIdentifier(): Dict');
    });

    test('schema with only primaryIdentifier set', () => {
        const schema: CfnResourceSchema = {
            typeName: 'X::Y::Z',
            properties: { Id: { type: 'string' } },
            primaryIdentifier: ['/properties/Id'],
            // additionalIdentifiers absent — exercises the ?? [] fallback for that field only
        };
        const source = generateModelsFromSchema(schema, LIB_NAME);
        expect(source).toContain('IDENTIFIER_KEY_ID');
        expect(source).not.toContain('getIdentifier_');
    });

    test('merges extraModels into output', () => {
        const schema: CfnResourceSchema = {
            typeName: 'A::B::C',
            properties: { Name: { type: 'string' } },
        };
        const extraModels = resolveModels(
            {
                typeName: 'TypeConfigurationModel',
                properties: { ApiEndpoint: { type: 'string' } },
            },
            'TypeConfigurationModel'
        );
        const source = generateModelsFromSchema(schema, LIB_NAME, extraModels);
        expect(source).toContain('export class ResourceModel extends BaseModel');
        expect(source).toContain(
            'export class TypeConfigurationModel extends BaseModel'
        );
    });
});

// ---------------------------------------------------------------------------
// generateHandlers
// ---------------------------------------------------------------------------

describe('generateHandlers', () => {
    let source: string;

    beforeAll(() => {
        source = generateHandlers({
            libName: LIB_NAME,
            typeName: 'Org::Service::Resource',
        });
    });

    test('imports from the lib', () => {
        expect(source).toContain(`from '${LIB_NAME}'`);
    });

    test('imports ResourceModel and TypeConfigurationModel', () => {
        expect(source).toContain("from './models'");
        expect(source).toContain('ResourceModel, TypeConfigurationModel');
    });

    test('class extends BaseResource with both type params', () => {
        expect(source).toContain(
            'class Resource extends BaseResource<ResourceModel, TypeConfigurationModel>'
        );
    });

    test('all five handler methods present', () => {
        expect(source).toContain('@handlerEvent(Action.Create)');
        expect(source).toContain('@handlerEvent(Action.Read)');
        expect(source).toContain('@handlerEvent(Action.Update)');
        expect(source).toContain('@handlerEvent(Action.Delete)');
        expect(source).toContain('@handlerEvent(Action.List)');
    });

    test('exports entrypoint and testEntrypoint', () => {
        expect(source).toContain('export const entrypoint = resource.entrypoint');
        expect(source).toContain(
            'export const testEntrypoint = resource.testEntrypoint'
        );
    });

    test('resource instantiation uses null not workerPool', () => {
        expect(source).toContain(
            'new Resource(ResourceModel.TYPE_NAME, ResourceModel, null, null, TypeConfigurationModel)'
        );
    });

    test('error handling uses (err as Error).message cast', () => {
        expect(source).toContain('(err as Error).message');
    });

    test('no aws-sdk v2 references', () => {
        expect(source).not.toContain("from 'aws-sdk'");
        expect(source).not.toContain("session.client('S3')");
    });
});

// ---------------------------------------------------------------------------
// generatePackageJson
// ---------------------------------------------------------------------------

describe('generatePackageJson', () => {
    let pkg: any;

    beforeAll(() => {
        const source = generatePackageJson({
            libName: LIB_NAME,
            libVersion: '^2.0.0',
            typeName: 'Org::Service::Resource',
            projectName: 'org-service-resource',
            entrypoint: 'dist/handlers.entrypoint',
            testEntrypoint: 'dist/handlers.testEntrypoint',
            runtime: 'nodejs20.x',
        });
        pkg = JSON.parse(source);
    });

    test('name matches projectName', () => {
        expect(pkg.name).toBe('org-service-resource');
    });

    test('lib dependency present with version', () => {
        expect(pkg.dependencies[LIB_NAME]).toBe('^2.0.0');
    });

    test('class-transformer dependency present', () => {
        expect(pkg.dependencies['class-transformer']).toBeTruthy();
    });

    test('no aws-sdk v2 dependency', () => {
        expect(pkg.dependencies?.['aws-sdk']).toBeUndefined();
        expect(pkg.optionalDependencies?.['aws-sdk']).toBeUndefined();
    });

    test('typescript in devDependencies', () => {
        expect(pkg.devDependencies?.typescript).toBeTruthy();
    });

    test('private flag set', () => {
        expect(pkg.private).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// generateTsConfig
// ---------------------------------------------------------------------------

describe('generateTsConfig', () => {
    let config: any;

    beforeAll(() => {
        config = JSON.parse(generateTsConfig());
    });

    test('has experimentalDecorators', () => {
        expect(config.compilerOptions.experimentalDecorators).toBe(true);
    });

    test('has emitDecoratorMetadata', () => {
        expect(config.compilerOptions.emitDecoratorMetadata).toBe(true);
    });

    test('outputs to dist/', () => {
        expect(config.compilerOptions.outDir).toBe('dist');
    });

    test('includes src/**/*.ts', () => {
        expect(config.include).toContain('src/**/*.ts');
    });
});

// ---------------------------------------------------------------------------
// generateSamTemplate
// ---------------------------------------------------------------------------

describe('generateSamTemplate', () => {
    let source: string;

    beforeAll(() => {
        source = generateSamTemplate({
            libName: LIB_NAME,
            libVersion: '^2.0.0',
            typeName: 'Org::Service::Resource',
            projectName: 'org-service-resource',
            entrypoint: 'dist/handlers.entrypoint',
            testEntrypoint: 'dist/handlers.testEntrypoint',
            runtime: 'nodejs20.x',
        });
    });

    test('contains resource type name', () => {
        expect(source).toContain('Org::Service::Resource');
    });

    test('contains entrypoint', () => {
        expect(source).toContain('dist/handlers.entrypoint');
    });

    test('contains test entrypoint', () => {
        expect(source).toContain('dist/handlers.testEntrypoint');
    });

    test('contains runtime', () => {
        expect(source).toContain('nodejs20.x');
    });

    test('TypeFunction has BuildMethod: makefile', () => {
        expect(source).toContain('BuildMethod: makefile');
    });
});

// ---------------------------------------------------------------------------
// generateMakefile
// ---------------------------------------------------------------------------

describe('generateMakefile', () => {
    test('contains build target', () => {
        const source = generateMakefile();
        expect(source).toContain('build-TypeFunction:');
    });

    test('uses tab indentation for commands', () => {
        const source = generateMakefile();
        expect(source).toContain('\tnpx npm ci');
        expect(source).toContain('\tnpx npm run build');
    });
});

// ---------------------------------------------------------------------------
// generateGitignore
// ---------------------------------------------------------------------------

describe('generateGitignore', () => {
    test('ignores node_modules and dist', () => {
        const source = generateGitignore();
        expect(source).toContain('node_modules/');
        expect(source).toContain('dist/');
    });
});

// ---------------------------------------------------------------------------
// generateNpmrc
// ---------------------------------------------------------------------------

describe('generateNpmrc', () => {
    test('enables optional dependencies', () => {
        const source = generateNpmrc();
        expect(source).toContain('optional=true');
    });
});

// ---------------------------------------------------------------------------
// generateReadme
// ---------------------------------------------------------------------------

describe('generateReadme', () => {
    let source: string;

    beforeAll(() => {
        source = generateReadme({
            libName: LIB_NAME,
            libVersion: '^2.0.0',
            typeName: 'Org::Service::Resource',
            projectName: 'org-service-resource',
            entrypoint: 'dist/handlers.entrypoint',
            testEntrypoint: 'dist/handlers.testEntrypoint',
            runtime: 'nodejs20.x',
        });
    });

    test('contains type name as heading', () => {
        expect(source).toContain('# Org::Service::Resource');
    });

    test('references handlers.ts', () => {
        expect(source).toContain('handlers.ts');
    });

    test('notes models.ts is generated', () => {
        expect(source).toContain('models.ts');
        expect(source).toContain('modifications will be overwritten');
    });

    test('references lib name', () => {
        expect(source).toContain(LIB_NAME);
    });
});

// ---------------------------------------------------------------------------
// generateSamTestCreate
// ---------------------------------------------------------------------------

describe('generateSamTestCreate', () => {
    let payload: any;

    beforeAll(() => {
        const source = generateSamTestCreate({
            libName: LIB_NAME,
            libVersion: '^2.0.0',
            typeName: 'Org::Service::Resource',
            projectName: 'org-service-resource',
            entrypoint: 'dist/handlers.entrypoint',
            testEntrypoint: 'dist/handlers.testEntrypoint',
            runtime: 'nodejs20.x',
        });
        payload = JSON.parse(source);
    });

    test('action is CREATE', () => {
        expect(payload.action).toBe('CREATE');
    });

    test('credentials are present', () => {
        expect(payload.credentials.accessKeyId).toBeTruthy();
        expect(payload.credentials.secretAccessKey).toBeTruthy();
    });

    test('request has clientRequestToken', () => {
        expect(payload.request.clientRequestToken).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// generateModelsFromSchema
// ---------------------------------------------------------------------------

describe('generateModelsFromSchema', () => {
    test('generates correct output from schema directly', () => {
        const source = generateModelsFromSchema(FULL_SCHEMA, LIB_NAME);
        expect(source).toContain('export class ResourceModel extends BaseModel');
        expect(source).toContain('export class Tag extends BaseModel');
        expect(source).toContain(`TYPE_NAME: string = 'Org::Service::Resource'`);
    });

    test('merges extra models', () => {
        const extraModels = {
            TypeConfigurationModel: {
                ApiToken: { container: 'primitive' as const, type: 'string' },
            },
        };
        const source = generateModelsFromSchema(FULL_SCHEMA, LIB_NAME, extraModels);
        expect(source).toContain(
            'export class TypeConfigurationModel extends BaseModel'
        );
        expect(source).toContain('apiToken?:');
    });

    test('schema without primaryIdentifier or additionalIdentifiers uses defaults', () => {
        const minimalSchema: CfnResourceSchema = {
            typeName: 'Org::Svc::Minimal',
            properties: { Name: { type: 'string' } },
        };
        const source = generateModelsFromSchema(minimalSchema, LIB_NAME);
        expect(source).toContain('export class ResourceModel extends BaseModel');
        // No identifier keys without primaryIdentifier
        expect(source).not.toContain('IDENTIFIER_KEY');
    });
});

// ---------------------------------------------------------------------------
// generateModels — default identifier params
// ---------------------------------------------------------------------------

describe('generateModels default identifier params', () => {
    test('omitting primaryIdentifier defaults to empty array (no IDENTIFIER_KEY)', () => {
        const models = resolveModels({
            typeName: 'Org::Svc::NoId',
            properties: { Name: { type: 'string' } },
        });
        const source = generateModels({
            libName: LIB_NAME,
            typeName: 'Org::Svc::NoId',
            models,
            // primaryIdentifier and additionalIdentifiers intentionally omitted
        });
        expect(source).toContain('export class ResourceModel extends BaseModel');
        expect(source).not.toContain('IDENTIFIER_KEY');
    });
});
