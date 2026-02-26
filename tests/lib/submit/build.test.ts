import {
    detectInstallCommand,
    validatePrerequisites,
    buildProject,
} from '~/submit/build';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

jest.mock('node:child_process', () => ({
    execSync: jest.fn(),
    execFileSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
    ...jest.requireActual('node:fs'),
    existsSync: jest.fn(),
    rmSync: jest.fn(),
}));

describe('build utilities', () => {
    describe('detectInstallCommand', () => {
        const mockExistsSync = fs.existsSync as jest.Mock;

        afterEach(() => mockExistsSync.mockReset());

        it('detects pnpm from pnpm-lock.yaml', () => {
            mockExistsSync.mockImplementation((p: string) =>
                String(p).includes('pnpm-lock.yaml')
            );
            expect(detectInstallCommand('/proj')).toBe(
                'pnpm install --frozen-lockfile'
            );
        });

        it('detects yarn from yarn.lock', () => {
            mockExistsSync.mockImplementation((p: string) =>
                String(p).includes('yarn.lock')
            );
            expect(detectInstallCommand('/proj')).toBe(
                'yarn install --frozen-lockfile'
            );
        });

        it('defaults to npm', () => {
            mockExistsSync.mockReturnValue(false);
            expect(detectInstallCommand('/proj')).toBe('npm ci --include=optional');
        });
    });

    describe('validatePrerequisites', () => {
        const mockExecSync = execSync as jest.Mock;

        afterEach(() => mockExecSync.mockReset());

        it('passes when all tools are available', () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'node --version') return 'v20.10.0';
                if (cmd === 'sam --version') return 'SAM CLI, version 1.100.0';
                return '';
            });
            expect(() => validatePrerequisites()).not.toThrow();
        });

        it('throws when node is too old', () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'node --version') return 'v18.0.0';
                return '';
            });
            expect(() => validatePrerequisites()).toThrow('Node.js >= 20');
        });

        it('throws when node is not installed', () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'node --version') throw new Error('ENOENT');
                return '';
            });
            expect(() => validatePrerequisites()).toThrow('not installed');
        });

        it('throws when sam is not installed', () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'node --version') return 'v20.10.0';
                if (cmd.includes('sam')) throw new Error('ENOENT');
                return '';
            });
            expect(() => validatePrerequisites()).toThrow('SAM CLI');
        });
    });

    describe('buildProject', () => {
        const mockExecSync = execSync as jest.Mock;
        const mockExistsSync = fs.existsSync as jest.Mock;
        const mockRmSync = fs.rmSync as jest.Mock;

        afterEach(() => {
            mockExecSync.mockReset();
            mockExistsSync.mockReset();
            mockRmSync.mockReset();
        });

        it('runs install and sam build', () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'node --version') return 'v20.10.0';
                if (cmd.includes('sam --version')) return 'SAM CLI, version 1.100.0';
                return '';
            });
            mockExistsSync.mockReturnValue(false);

            buildProject({ projectDir: '/proj' });

            // install + validate(node) + validate(sam) + sam build
            expect(mockExecSync).toHaveBeenCalledTimes(4);
            const samCall = mockExecSync.mock.calls[3][0];
            expect(samCall).toContain('sam build');
            expect(samCall).not.toContain('--use-container');
        });

        it('passes --use-container when useDocker is true', () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'node --version') return 'v20.10.0';
                if (cmd.includes('sam --version')) return 'SAM CLI, version 1.100.0';
                return '';
            });
            mockExistsSync.mockReturnValue(false);

            buildProject({ projectDir: '/proj', useDocker: true });

            const samCall = mockExecSync.mock.calls[3][0];
            expect(samCall).toContain('--use-container');
        });

        it('removes existing build directory before building', () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'node --version') return 'v20.10.0';
                if (cmd.includes('sam --version')) return 'SAM CLI, version 1.100.0';
                return '';
            });
            mockExistsSync.mockReturnValue(true); // build dir exists

            buildProject({ projectDir: '/proj' });

            expect(mockRmSync).toHaveBeenCalledWith(expect.stringContaining('build'), {
                recursive: true,
                force: true,
            });
        });
    });
});
