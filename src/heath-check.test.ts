import { healthCheck } from './health-check';
import { healthCheck as indexHealthCheck } from './index';

describe('package health check', () => {
    it('healthCheck method exists in TS source', () => {
        const result = healthCheck();
        expect(result).toBe(true);
    });

    it('healthCheck method exists in index export', () => {
        const result = indexHealthCheck();
        expect(result).toBe(true);
    });
});
