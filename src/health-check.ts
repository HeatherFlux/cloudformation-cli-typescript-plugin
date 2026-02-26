// Note: for packages to be used on client apps.  We will need to delete the reference to
// '@extend/logger' as it calls `fs` internally which is not available on the client
import { logger } from '@extend/logger'

/**
 * Dummy method, used to prove the index.js is exporting correctly
 * once bundled, we call this method to confirm the package is working as expected
 * @returns true
 */
export function healthCheck(): true {
  logger.info('Package health check successful 🎉')
  return true
}
