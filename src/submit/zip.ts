/**
 * ZIP packaging for `cfn-ts submit`.
 *
 * Creates a ZIP archive from the SAM build output directory.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Create a ZIP archive of `buildDir` contents at `outputPath`.
 *
 * Uses the system `zip` binary. The archive contains files with paths
 * relative to `buildDir`.
 *
 * @param buildDir   Absolute path to `build/TypeFunction/`.
 * @param outputPath Absolute path for the output ZIP file.
 * @returns The absolute path to the created ZIP file.
 */
export function createResourceZip(buildDir: string, outputPath: string): string {
    if (!fs.existsSync(buildDir)) {
        throw new Error(`Build directory not found: ${buildDir}`);
    }

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Remove existing zip if present
    if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
    }

    const absOutput = path.resolve(outputPath);

    try {
        execFileSync('zip', ['-r', '-q', absOutput, '.'], {
            cwd: buildDir,
            stdio: 'pipe',
        });
    } catch (e) {
        // If zip binary is not available, try falling back to tar+gzip
        // (CloudFormation also accepts .zip created by other tools)
        if (
            e instanceof Error &&
            (e.message.includes('ENOENT') || e.message.includes('not found'))
        ) {
            throw new Error(
                'The "zip" command is not installed. ' +
                    'Install it (e.g., "brew install zip" or "apt-get install zip") and retry.'
            );
        }
        throw e;
    }

    return absOutput;
}
