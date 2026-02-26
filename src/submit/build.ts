/**
 * Build utilities for `cfn-ts submit`.
 *
 * Validates prerequisites, installs dependencies, and runs SAM build.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BuildOptions {
    /** Project root directory. */
    projectDir: string;
    /** Use Docker for SAM build. */
    useDocker?: boolean;
}

/**
 * Detect the package manager from lockfile presence.
 * Returns the install command to run.
 */
export function detectInstallCommand(projectDir: string): string {
    if (fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) {
        return 'pnpm install --frozen-lockfile';
    }
    if (fs.existsSync(path.join(projectDir, 'yarn.lock'))) {
        return 'yarn install --frozen-lockfile';
    }
    if (fs.existsSync(path.join(projectDir, 'package-lock.json'))) {
        return 'npm ci --include=optional';
    }
    // No lockfile — fall back to npm install (creates one)
    return 'npm install';
}

/**
 * Validate that required tools are on PATH.
 * Throws with an actionable message if anything is missing.
 */
export function validatePrerequisites(): void {
    // Check node
    try {
        const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
        const major = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);
        if (isNaN(major) || major < 20) {
            throw new Error(
                `Node.js >= 20 is required (found ${nodeVersion}). ` +
                    'Install from https://nodejs.org/'
            );
        }
    } catch (e) {
        if (e instanceof Error && e.message.includes('Node.js >= 20')) throw e;
        throw new Error('Node.js is not installed. Install from https://nodejs.org/');
    }

    // Check sam
    try {
        execSync('sam --version', { encoding: 'utf8', stdio: 'pipe' });
    } catch {
        throw new Error(
            'AWS SAM CLI is not installed. ' +
                'Install from https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html'
        );
    }
}

/**
 * Run the full build pipeline: SAM build (which triggers the Makefile).
 *
 * The project's Makefile handles dependency installation and compilation
 * inside SAM's temporary build directory. We only need to validate
 * prerequisites and invoke SAM.
 */
export function buildProject(options: BuildOptions): void {
    const { projectDir, useDocker } = options;

    validatePrerequisites();

    // Remove previous build artifacts
    const buildDir = path.join(projectDir, 'build');
    if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
    }

    // SAM build — the Makefile handles npm install + tsc
    const samArgs = [
        'sam',
        'build',
        '--build-dir',
        path.join(projectDir, 'build'),
        'TypeFunction',
    ];
    if (useDocker) {
        samArgs.push('--use-container');
    }

    execSync(samArgs.join(' '), {
        cwd: projectDir,
        stdio: 'inherit',
    });
}
