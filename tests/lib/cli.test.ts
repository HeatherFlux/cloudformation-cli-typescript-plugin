/**
 * Tests for the cfn-ts CLI (`src/bin/cfn-ts.ts`).
 *
 * We test the argument parser and both commands end-to-end by invoking the
 * compiled CLI as a child process against a temporary directory. This avoids
 * mocking `fs` while still being deterministic.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI = path.resolve(__dirname, '../../dist/bin/cfn-ts.js');

function run(
    args: string[],
    cwd = process.cwd()
): { stdout: string; stderr: string; code: number } {
    try {
        const stdout = execFileSync(process.execPath, [CLI, ...args], {
            cwd,
            encoding: 'utf8',
            env: { ...process.env, NO_COLOR: '1' },
        });
        return { stdout, stderr: '', code: 0 };
    } catch (e: any) {
        return {
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? '',
            code: e.status ?? 1,
        };
    }
}

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cfn-ts-test-'));
}

const TEST_SCHEMA = {
    typeName: 'Org::Test::Widget',
    description: 'A test widget resource',
    properties: {
        Id: { type: 'string' },
        Name: { type: 'string' },
        Tags: {
            type: 'array',
            items: { $ref: '#/definitions/Tag' },
        },
    },
    definitions: {
        Tag: {
            type: 'object',
            properties: {
                Key: { type: 'string' },
                Value: { type: 'string' },
            },
        },
    },
    primaryIdentifier: ['/properties/Id'],
    additionalProperties: false,
};

// ---------------------------------------------------------------------------
// --help / --version
// ---------------------------------------------------------------------------

describe('cfn-ts --help', () => {
    test('exits 0 and shows usage', () => {
        const { stdout, code } = run(['--help']);
        expect(code).toBe(0);
        expect(stdout).toContain('cfn-ts');
        expect(stdout).toContain('generate');
        expect(stdout).toContain('init');
    });

    test('no-args shows help', () => {
        const { stdout, code } = run([]);
        expect(code).toBe(0);
        expect(stdout).toContain('cfn-ts');
    });
});

describe('cfn-ts --version', () => {
    test('exits 0 and prints a version string', () => {
        const { stdout, code } = run(['--version']);
        expect(code).toBe(0);
        expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
});

// ---------------------------------------------------------------------------
// cfn-ts init
// ---------------------------------------------------------------------------

describe('cfn-ts init', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('exits 1 when --type-name is missing', () => {
        const { stderr, code } = run(['init']);
        expect(code).toBe(1);
        expect(stderr).toContain('--type-name');
    });

    test('exits 1 for invalid type name format', () => {
        const { stderr, code } = run([
            'init',
            '--type-name',
            'not-valid',
            '--output',
            tmpDir,
        ]);
        expect(code).toBe(1);
        expect(stderr).toContain('Invalid type name');
    });

    test('creates all expected scaffold files', () => {
        const { code } = run([
            'init',
            '--type-name',
            'Org::Test::Widget',
            '--output',
            tmpDir,
        ]);
        expect(code).toBe(0);

        const expected = [
            '.gitignore',
            '.npmrc',
            'package.json',
            'tsconfig.json',
            'template.yml',
            'Makefile',
            'README.md',
            path.join('sam-tests', 'create.json'),
            path.join('src', 'handlers.ts'),
            path.join('src', 'models.ts'),
            'org-test-widget.json',
        ];

        for (const file of expected) {
            expect(fs.existsSync(path.join(tmpDir, file))).toBe(true);
        }
    });

    test('generated package.json has correct name and lib dependency', () => {
        run(['init', '--type-name', 'Org::Test::Widget', '--output', tmpDir]);
        const pkg = JSON.parse(
            fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8')
        );
        expect(pkg.name).toBe('org-test-widget');
        expect(
            pkg.dependencies[
                '@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib'
            ]
        ).toBeTruthy();
        expect(pkg.dependencies['aws-sdk']).toBeUndefined();
    });

    test('generated tsconfig.json has experimentalDecorators and emitDecoratorMetadata', () => {
        run(['init', '--type-name', 'Org::Test::Widget', '--output', tmpDir]);
        const config = JSON.parse(
            fs.readFileSync(path.join(tmpDir, 'tsconfig.json'), 'utf8')
        );
        expect(config.compilerOptions.experimentalDecorators).toBe(true);
        expect(config.compilerOptions.emitDecoratorMetadata).toBe(true);
    });

    test('generated handlers.ts has all five handler stubs', () => {
        run(['init', '--type-name', 'Org::Test::Widget', '--output', tmpDir]);
        const handlers = fs.readFileSync(
            path.join(tmpDir, 'src', 'handlers.ts'),
            'utf8'
        );
        expect(handlers).toContain('Action.Create');
        expect(handlers).toContain('Action.Read');
        expect(handlers).toContain('Action.Update');
        expect(handlers).toContain('Action.Delete');
        expect(handlers).toContain('Action.List');
        expect(handlers).toContain(
            'BaseResource<ResourceModel, TypeConfigurationModel>'
        );
    });

    test('generated models.ts has ResourceModel and TypeConfigurationModel', () => {
        run(['init', '--type-name', 'Org::Test::Widget', '--output', tmpDir]);
        const models = fs.readFileSync(path.join(tmpDir, 'src', 'models.ts'), 'utf8');
        expect(models).toContain('export class ResourceModel extends BaseModel');
        expect(models).toContain(
            'export class TypeConfigurationModel extends BaseModel'
        );
        expect(models).toContain("TYPE_NAME: string = 'Org::Test::Widget'");
    });

    test('is idempotent — re-run skips existing files but regenerates models.ts', () => {
        run(['init', '--type-name', 'Org::Test::Widget', '--output', tmpDir]);

        // Modify handlers.ts to check it is not overwritten
        const handlersPath = path.join(tmpDir, 'src', 'handlers.ts');
        fs.writeFileSync(handlersPath, '// custom content\n');

        run(['init', '--type-name', 'Org::Test::Widget', '--output', tmpDir]);

        // handlers.ts should NOT be overwritten (user file)
        expect(fs.readFileSync(handlersPath, 'utf8')).toBe('// custom content\n');
        // models.ts IS always overwritten
        const models = fs.readFileSync(path.join(tmpDir, 'src', 'models.ts'), 'utf8');
        expect(models).toContain('export class ResourceModel');
    });

    test('stdout reports created files with checkmarks', () => {
        const { stdout, code } = run([
            'init',
            '--type-name',
            'Org::Test::Widget',
            '--output',
            tmpDir,
        ]);
        expect(code).toBe(0);
        expect(stdout).toContain('Initialisation complete');
        expect(stdout).toContain('Next steps');
    });
});

// ---------------------------------------------------------------------------
// cfn-ts generate
// ---------------------------------------------------------------------------

describe('cfn-ts generate', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        // Create src/ and write a rich schema
        fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'org-test-widget.json'),
            JSON.stringify(TEST_SCHEMA, null, 4),
            'utf8'
        );
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('exits 0 and writes src/models.ts', () => {
        const { code } = run(['generate', '--output', tmpDir]);
        expect(code).toBe(0);
        expect(fs.existsSync(path.join(tmpDir, 'src', 'models.ts'))).toBe(true);
    });

    test('auto-discovers schema file', () => {
        const { code, stdout } = run(['generate', '--output', tmpDir]);
        expect(code).toBe(0);
        expect(stdout).toContain('org-test-widget.json');
    });

    test('accepts explicit --schema path', () => {
        const { code } = run([
            'generate',
            '--schema',
            'org-test-widget.json',
            '--output',
            tmpDir,
        ]);
        expect(code).toBe(0);
    });

    test('generated models.ts contains correct ResourceModel properties', () => {
        run(['generate', '--output', tmpDir]);
        const models = fs.readFileSync(path.join(tmpDir, 'src', 'models.ts'), 'utf8');
        expect(models).toContain("TYPE_NAME: string = 'Org::Test::Widget'");
        expect(models).toContain('id?:');
        expect(models).toContain('name?:');
        expect(models).toContain('tags?:');
        expect(models).toContain('@Type(() => Tag)');
    });

    test('generated models.ts contains TypeConfigurationModel', () => {
        run(['generate', '--output', tmpDir]);
        const models = fs.readFileSync(path.join(tmpDir, 'src', 'models.ts'), 'utf8');
        expect(models).toContain(
            'export class TypeConfigurationModel extends BaseModel'
        );
    });

    test('generated models.ts has IDENTIFIER_KEY for primary identifier', () => {
        run(['generate', '--output', tmpDir]);
        const models = fs.readFileSync(path.join(tmpDir, 'src', 'models.ts'), 'utf8');
        expect(models).toContain('IDENTIFIER_KEY_ID');
        expect(models).toContain("'/properties/Id'");
    });

    test('exits 1 when no schema file found', () => {
        const emptyDir = makeTmpDir();
        fs.mkdirSync(path.join(emptyDir, 'src'), { recursive: true });
        const { stderr, code } = run(['generate', '--output', emptyDir]);
        expect(code).toBe(1);
        expect(stderr).toContain('No schema file found');
        fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    test('exits 1 when explicit schema path does not exist', () => {
        const { stderr, code } = run([
            'generate',
            '--schema',
            'nonexistent.json',
            '--output',
            tmpDir,
        ]);
        expect(code).toBe(1);
        expect(stderr).toContain('not found');
    });

    test('exits 1 when multiple schema files found', () => {
        // Add a second schema file
        fs.writeFileSync(
            path.join(tmpDir, 'another-resource.json'),
            JSON.stringify({
                typeName: 'Org::Test::Other',
                properties: {},
                additionalProperties: false,
            }),
            'utf8'
        );
        const { stderr, code } = run(['generate', '--output', tmpDir]);
        expect(code).toBe(1);
        expect(stderr).toContain('Multiple schema files found');
    });

    test('always overwrites existing models.ts', () => {
        const modelsPath = path.join(tmpDir, 'src', 'models.ts');
        fs.writeFileSync(modelsPath, '// old content\n');

        run(['generate', '--output', tmpDir]);

        const content = fs.readFileSync(modelsPath, 'utf8');
        expect(content).not.toContain('// old content');
        expect(content).toContain('export class ResourceModel');
    });
});
