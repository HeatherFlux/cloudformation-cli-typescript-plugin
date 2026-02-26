import { createResourceZip } from '~/submit/zip';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

jest.mock('node:child_process', () => ({
    execFileSync: jest.fn(),
    execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
    ...jest.requireActual('node:fs'),
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    unlinkSync: jest.fn(),
}));

const mockExistsSync = fs.existsSync as jest.Mock;
const mockMkdirSync = fs.mkdirSync as jest.Mock;
const mockUnlinkSync = fs.unlinkSync as jest.Mock;
const mockExecFileSync = execFileSync as jest.Mock;

describe('createResourceZip', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    it('throws when build directory does not exist', () => {
        mockExistsSync.mockReturnValue(false);
        expect(() => createResourceZip('/missing', '/out.zip')).toThrow(
            'Build directory not found'
        );
    });

    it('creates output directory and zips build contents', () => {
        mockExistsSync.mockImplementation((p: string) => {
            if (String(p).includes('/missing')) return false;
            // buildDir exists, outputPath does not
            return String(p) === '/build/TypeFunction';
        });

        const result = createResourceZip('/build/TypeFunction', '/out/handler.zip');

        expect(mockMkdirSync).toHaveBeenCalledWith('/out', { recursive: true });
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'zip',
            ['-r', '-q', expect.stringContaining('handler.zip'), '.'],
            { cwd: '/build/TypeFunction', stdio: 'pipe' }
        );
        expect(result).toContain('handler.zip');
    });

    it('removes existing zip before creating new one', () => {
        // Both buildDir and outputPath exist
        mockExistsSync.mockReturnValue(true);

        createResourceZip('/build/TypeFunction', '/out/handler.zip');

        expect(mockUnlinkSync).toHaveBeenCalledWith('/out/handler.zip');
    });

    it('throws user-friendly error when zip binary is missing', () => {
        mockExistsSync.mockImplementation(
            (p: string) => String(p) === '/build/TypeFunction'
        );
        mockExecFileSync.mockImplementation(() => {
            throw new Error('spawn zip ENOENT');
        });

        expect(() =>
            createResourceZip('/build/TypeFunction', '/out/handler.zip')
        ).toThrow('"zip" command is not installed');
    });

    it('re-throws non-ENOENT errors from zip', () => {
        mockExistsSync.mockImplementation(
            (p: string) => String(p) === '/build/TypeFunction'
        );
        mockExecFileSync.mockImplementation(() => {
            throw new Error('disk full');
        });

        expect(() =>
            createResourceZip('/build/TypeFunction', '/out/handler.zip')
        ).toThrow('disk full');
    });
});
