import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  // If you'd like multiple entrypoints in this package, define them manually here:
  // entry: {
  //     index: 'src/index.ts',
  //     ai: 'src/ai/index.ts',
  // },
  outDir: './dist',
  platform: 'node',
  exports: true,
  format: 'esm',
  // format: ['cjs', 'esm']
  // If your input contains TLA, it can only be bundled and emitted with esm format.
})
