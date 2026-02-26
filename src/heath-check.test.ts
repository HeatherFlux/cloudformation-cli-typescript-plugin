// confirm package is wired up correctly
import { healthCheck } from './health-check.ts'
import { healthCheck as indexHealthCheck } from './index.ts'
import { logger } from '@extend/logger'

describe('package health check', () => {
  const loggerSpy = vi.spyOn(logger, 'info')

  // export env.SILENT_LOGS to be true
  it('env.SILENT_LOGS is true', () => {
    expect(process.env.SILENT_LOGS).toBe('true')
  })

  // export env.TEST_ENV to be 'test'
  it('env.TEST_ENV is test', () => {
    expect(process.env.TEST_ENV).toBe('test')
  })

  it('healthCheck method exists in TS source', () => {
    const result = healthCheck()
    expect(result).toBe(true)
  })

  it('healthCheck method exists in index export', () => {
    const result = indexHealthCheck()
    expect(result).toBe(true)
  })

  it('healthCheck is successful', () => {
    healthCheck()
    expect(loggerSpy).toBeCalledWith('Package health check successful 🎉')
  })
})
