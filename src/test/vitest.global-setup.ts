// oxlint-disable no-console
// Docs: https://vitest.dev/config/#globalsetup

/**
 * Runs once when Vitest starts.
 */
export default async function setup() {
  console.log('🚀 Vitest global setup running...')

  const testEnv = process.env.TEST_ENV || 'test'
  process.env.TEST_ENV = testEnv
  const envFile = `./.env.${testEnv}`
  process.loadEnvFile(envFile)

  console.log(`✅ Vitest global setup complete (TEST_ENV: ${testEnv})`)

  // Return teardown function
  return async () => {
    console.log('🧹 Vitest global teardown running...')
    // add any global teardown logic here
    console.log('✅ Vitest global teardown complete')
  }
}
