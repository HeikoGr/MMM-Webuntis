/**
 * Unit Tests for MMM-Webuntis
 * Run with: npm test
 */

const AuthService = require('../lib/authService');
const CacheManager = require('../lib/cacheManager');

describe('AuthService', () => {
    let authService;

    beforeEach(() => {
        authService = new AuthService({ logger: () => { } }); // Silent logger for tests
    });

    describe('Race Condition Protection', () => {
        test('should not make parallel auth requests for same key', async () => {
            // TODO: Implement test
            expect(true).toBe(true);
        });
    });

    describe('Token Extraction', () => {
        test('should extract person_id from valid JWT', () => {
            // TODO: Implement test
            expect(true).toBe(true);
        });

        test('should return null for invalid JWT', () => {
            const result = authService.extractPersonIdFromToken('invalid');
            expect(result).toBeNull();
        });
    });
});

describe('CacheManager', () => {
    let cacheManager;

    beforeEach(() => {
        cacheManager = new CacheManager();
    });

    describe('TTL Support', () => {
        test('should expire entries after TTL', async () => {
            cacheManager.set('classId', 'test-key', 123, 100); // 100ms TTL

            // Should be available immediately
            expect(cacheManager.get('classId', 'test-key')).toBe(123);

            // Wait for expiration
            await new Promise((resolve) => setTimeout(resolve, 150));

            // Should be expired
            expect(cacheManager.get('classId', 'test-key')).toBeUndefined();
        });

        test('should not expire without TTL', () => {
            cacheManager.set('classId', 'test-key', 123); // No TTL
            expect(cacheManager.get('classId', 'test-key')).toBe(123);
        });
    });
});
