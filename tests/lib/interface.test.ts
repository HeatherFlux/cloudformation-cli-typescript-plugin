import {
    BaseDto,
    BaseModel,
    BaseResourceHandlerRequest,
    Integer,
    UnmodeledRequest,
} from '~/interface';
import { SerializableModel } from '../data/sample-model';
import type { Dict } from '~/interface';

describe('when getting interface', () => {
    test('base resource model get type name', () => {
        const model = new SerializableModel();
        expect(model.getTypeName()).toBe(SerializableModel.TYPE_NAME);
    });

    test('base resource model deserialize', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = SerializableModel.deserialize(null as any);
        expect(model).toBeNull();
    });

    test('base resource model serialize', () => {
        const model = SerializableModel.deserialize({
            somekey: 'a',
            somestring: '',
            someotherkey: null,
            someint: null,
        });
        const serialized = JSON.parse(JSON.stringify(model));
        expect(Object.keys(serialized).length).toBe(2);
        expect(serialized.somekey).toBe('a');
        expect(serialized.somestring).toBe('');
        expect(serialized.someotherkey).not.toBeDefined();
    });

    test('base resource model to plain object', () => {
        const model = SerializableModel.deserialize({
            somekey: 'a',
            someotherkey: 'b',
        });
        const obj = model!.toJSON();
        expect(obj).toMatchObject({
            somekey: 'a',
            someotherkey: 'b',
        });
    });

    test('integer serialize from number to number', () => {
        const valueNumber = 123597129357;
        expect(typeof valueNumber).toBe('number');
        const valueInteger = Integer(valueNumber);
        expect(typeof valueInteger).toBe('bigint');
        const serialized = JSON.parse(JSON.stringify(valueInteger));
        expect(typeof serialized).toBe('number');
        expect(serialized).toBe(valueNumber);
    });

    test('integer serialize invalid number', () => {
        const parseInteger = () => {
            Integer(Math.pow(2, 53));
        };
        expect(parseInteger).toThrow(RangeError);
        expect(parseInteger).toThrow('Value is not a safe integer');
    });

    test('integer serialize from string to number', () => {
        const model = SerializableModel.deserialize({
            SomeInt: '35190274',
        });
        expect(model!['someint']).toBe(Integer(35190274));
        const serialized = model!.serialize();
        expect(typeof serialized['SomeInt']).toBe('number');
        expect(serialized['SomeInt']).toBe(35190274);
    });

    test('BaseModel constructor with truthy partial assigns properties', () => {
        class ConcreteModel extends BaseModel {}
        const model = new ConcreteModel({ someField: 'value' });
        expect((model as unknown as Record<string, unknown>)['someField']).toBe(
            'value'
        );
    });

    test('BaseDto constructor with null partial does not assign (falsy non-undefined)', () => {
        const req = new BaseResourceHandlerRequest(null);
        // null passes the !== undefined check but is falsy, so Object.assign is skipped
        expect(req).toBeInstanceOf(BaseResourceHandlerRequest);
        expect(req.awsAccountId).toBeUndefined();
    });

    test('BaseDto constructor with truthy partial assigns properties', () => {
        // Minimal concrete subclass with no @Expose() class fields of its own so
        // useDefineForClassFields does not clobber the Object.assign in super().
        class MinimalDto extends BaseDto {
            constructor(partial?: unknown) {
                super(partial);
            }
        }
        const dto = new MinimalDto({ dynamicProp: 'hello' });
        expect((dto as unknown as Record<string, unknown>)['dynamicProp']).toBe(
            'hello'
        );
    });

    test('toModeled without deserialize leaves resource states undefined', () => {
        // Covers the `?.` optional-chain false branch at interface.ts:314-317.
        // BaseModel inherits a static deserialize from BaseDto; use a plain
        // constructor function that has no deserialize property so the optional
        // chain short-circuits to undefined.
        const unmodeled = UnmodeledRequest.fromUnmodeled({
            awsAccountId: '123456789012',
            region: 'us-east-1',
        });
        // Plain function has no static deserialize → optional chain returns undefined
        function PlainRef() {}
        const request = unmodeled.toModeled(PlainRef as unknown as typeof BaseModel);
        expect(request).toBeInstanceOf(BaseResourceHandlerRequest);
        expect(request.desiredResourceState).toBeUndefined();
        expect(request.previousResourceState).toBeUndefined();
    });

    test('toModeled with deserialize populates resource states', () => {
        // Covers the `??` non-null branch at interface.ts:314-317:
        // when deserialize returns a model (not null/undefined) the ?? passes it through.
        const unmodeled = UnmodeledRequest.fromUnmodeled({
            awsAccountId: '123456789012',
            region: 'us-east-1',
            desiredResourceState: { somekey: 'val' },
        });
        const ModelRef: typeof SerializableModel & {
            deserialize: (data: Dict | null | undefined) => SerializableModel | null;
        } = SerializableModel as typeof SerializableModel & {
            deserialize: (data: Dict | null | undefined) => SerializableModel | null;
        };
        const request = unmodeled.toModeled(ModelRef);
        expect(request).toBeInstanceOf(BaseResourceHandlerRequest);
        expect(request.desiredResourceState).not.toBeNull();
    });

    test('unmodeled request partion', () => {
        const partionMap = [null, 'aws', 'aws-cn', 'aws-gov'];
        [null, 'us-east-1', 'cn-region1', 'us-gov-region1'].forEach(
            (region: string | null, index: number) => {
                const partion = UnmodeledRequest.getPartition(region);
                expect(partion).toBe(partionMap[index]);
            }
        );
    });
});
