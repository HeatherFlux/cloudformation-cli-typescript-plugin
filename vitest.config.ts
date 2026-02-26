import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 2000,
    pool: process.env.CI ? 'vmThreads' : 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['clover', 'json', 'lcov', 'text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*'],
      exclude: ['src/test/**/*', 'src/**/*.test.*'],
      thresholds: {
        statements: 70,
        branches: 90,
        lines: 70,
        functions: 90,
      },
    },
    globalSetup: './src/test/vitest.global-setup.ts',
  },
})
