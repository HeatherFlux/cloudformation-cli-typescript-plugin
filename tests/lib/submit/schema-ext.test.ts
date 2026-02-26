import { extractHandlerPermissions } from '~/submit/schema-ext';
import type { CfnResourceSchemaWithHandlers } from '~/submit/schema-ext';

describe('extractHandlerPermissions', () => {
    const baseSchema: CfnResourceSchemaWithHandlers = {
        typeName: 'Test::Svc::Resource',
        description: 'test',
        properties: {},
        primaryIdentifier: ['/properties/Id'],
        additionalProperties: false,
    };

    it('returns empty array when no handlers section', () => {
        expect(extractHandlerPermissions(baseSchema)).toEqual([]);
    });

    it('returns empty array when handlers section is empty', () => {
        expect(extractHandlerPermissions({ ...baseSchema, handlers: {} })).toEqual([]);
    });

    it('collects permissions from all handlers', () => {
        const schema: CfnResourceSchemaWithHandlers = {
            ...baseSchema,
            handlers: {
                create: { permissions: ['s3:CreateBucket'] },
                read: { permissions: ['s3:GetBucket'] },
                delete: { permissions: ['s3:DeleteBucket'] },
            },
        };
        expect(extractHandlerPermissions(schema)).toEqual([
            's3:CreateBucket',
            's3:DeleteBucket',
            's3:GetBucket',
        ]);
    });

    it('deduplicates permissions across handlers', () => {
        const schema: CfnResourceSchemaWithHandlers = {
            ...baseSchema,
            handlers: {
                create: { permissions: ['s3:PutObject', 's3:GetObject'] },
                read: { permissions: ['s3:GetObject'] },
                update: { permissions: ['s3:PutObject', 's3:GetObject'] },
            },
        };
        expect(extractHandlerPermissions(schema)).toEqual([
            's3:GetObject',
            's3:PutObject',
        ]);
    });

    it('returns sorted results', () => {
        const schema: CfnResourceSchemaWithHandlers = {
            ...baseSchema,
            handlers: {
                create: { permissions: ['zzz:Action', 'aaa:Action', 'mmm:Action'] },
            },
        };
        expect(extractHandlerPermissions(schema)).toEqual([
            'aaa:Action',
            'mmm:Action',
            'zzz:Action',
        ]);
    });

    it('handles handlers with no permissions array', () => {
        const schema: CfnResourceSchemaWithHandlers = {
            ...baseSchema,
            handlers: {
                create: { permissions: ['s3:CreateBucket'] },
                read: {} as any,
            },
        };
        expect(extractHandlerPermissions(schema)).toEqual(['s3:CreateBucket']);
    });

    it('handles all five handler types', () => {
        const schema: CfnResourceSchemaWithHandlers = {
            ...baseSchema,
            handlers: {
                create: { permissions: ['a:1'] },
                read: { permissions: ['a:2'] },
                update: { permissions: ['a:3'] },
                delete: { permissions: ['a:4'] },
                list: { permissions: ['a:5'] },
            },
        };
        expect(extractHandlerPermissions(schema)).toEqual([
            'a:1',
            'a:2',
            'a:3',
            'a:4',
            'a:5',
        ]);
    });
});
