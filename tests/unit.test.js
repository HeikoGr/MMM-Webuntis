/**
 * Unit Tests for MMM-Webuntis with API Mocking
 * Run with: npm test
 */

// Mock fetchClient before requiring any modules that use it
jest.mock('../lib/fetchClient');

const AuthService = require('../lib/authService');
const CacheManager = require('../lib/cacheManager');
const fetchClient = require('../lib/fetchClient');

// Test fixtures
const mockBearerToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwZXJzb25faWQiOjk5OTksImV4cCI6MTY0MDAwMDAwMH0.test';

// ===================================
// AuthService Tests
// ===================================
describe('AuthService', () => {
  let authService;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService({ logger: () => { } });
  });

  describe('Token Extraction', () => {
    test('should extract person_id from valid JWT', () => {
      const result = authService.extractPersonIdFromToken(mockBearerToken);
      expect(result).toBe(9999);
    });

    test('should return null for invalid JWT', () => {
      expect(authService.extractPersonIdFromToken('invalid')).toBeNull();
      expect(authService.extractPersonIdFromToken('')).toBeNull();
      expect(authService.extractPersonIdFromToken(null)).toBeNull();
    });

    test('should return null for malformed JWT', () => {
      const malformed = 'header.payload'; // Missing signature
      expect(authService.extractPersonIdFromToken(malformed)).toBeNull();
    });

    test('should handle JWT without person_id field', () => {
      // JWT with different payload structure
      const jwtWithoutPersonId = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoidGVzdCJ9.test';
      expect(authService.extractPersonIdFromToken(jwtWithoutPersonId)).toBeNull();
    });
  });

  describe('Student Discovery from appData', () => {
    test('should derive students from appData', () => {
      const mockAppData = {
        user: {
          students: [
            { id: 111, displayName: 'Max Mustermann', imageUrl: null },
            { id: 222, displayName: 'Lisa Musterfrau', imageUrl: 'https://example.com/photo.jpg' },
          ],
        },
      };

      const students = authService.deriveStudentsFromAppData(mockAppData);

      expect(students).toHaveLength(2);
      expect(students[0]).toEqual({
        title: 'Max Mustermann',
        studentId: 111,
        imageUrl: null,
      });
      expect(students[1]).toEqual({
        title: 'Lisa Musterfrau',
        studentId: 222,
        imageUrl: 'https://example.com/photo.jpg',
      });
    });

    test('should return empty array for invalid appData', () => {
      expect(authService.deriveStudentsFromAppData(null)).toEqual([]);
      expect(authService.deriveStudentsFromAppData({})).toEqual([]);
      expect(authService.deriveStudentsFromAppData({ user: {} })).toEqual([]);
      expect(authService.deriveStudentsFromAppData({ user: { students: null } })).toEqual([]);
    });

    test('should handle students without displayName', () => {
      const mockAppData = {
        user: {
          students: [
            { id: 111, name: 'Fallback Name' },
            { id: 222 }, // No name at all
          ],
        },
      };

      const students = authService.deriveStudentsFromAppData(mockAppData);

      expect(students).toHaveLength(2);
      expect(students[0].title).toBe('Fallback Name');
      expect(students[1].title).toBe('Student 2');
    });
  });

  describe('Cache Management', () => {
    test('should clear specific cache by key', () => {
      authService._authCache.set('key1', { token: 'token1' });
      authService._authCache.set('key2', { token: 'token2' });

      const invalidated = authService.invalidateCache('key1');
      expect(invalidated).toBe(true);
      expect(authService._authCache.has('key1')).toBe(false);
      expect(authService._authCache.has('key2')).toBe(true);
    });

    test('should return false when invalidating non-existent key', () => {
      const result = authService.invalidateCache('nonexistent');
      expect(result).toBe(false);
    });

    test('should clear all cache', () => {
      authService._authCache.set('key1', { token: 'token1' });
      authService._authCache.set('key2', { token: 'token2' });

      authService.clearCache();
      expect(authService._authCache.size).toBe(0);
    });

    test('should get cache statistics', () => {
      authService._authCache.set('key1', { token: 'token1' });
      authService._authCache.set('key2', { token: 'token2' });

      const stats = authService.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });
  });

  describe('Cache Expiration', () => {
    test('should return cached value if not expired', () => {
      const futureTime = Date.now() + 600000; // 10 minutes from now
      authService._authCache.set('test-key', {
        token: mockBearerToken,
        expiresAt: futureTime,
      });

      // Mock getAuth to use cache
      const cached = authService._authCache.get('test-key');
      expect(cached.token).toBe(mockBearerToken);
      expect(cached.expiresAt).toBe(futureTime);
    });
  });
});

// ===================================
// CacheManager Tests
// ===================================
describe('CacheManager', () => {
  let cacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager(() => { });
  });

  describe('TTL Support', () => {
    test('should expire entries after TTL', async () => {
      cacheManager.set('classId', 'test-key', 123, 100);

      expect(cacheManager.get('classId', 'test-key')).toBe(123);

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cacheManager.get('classId', 'test-key')).toBeUndefined();
    });

    test('should not expire without TTL', () => {
      cacheManager.set('classId', 'test-key', 123);
      expect(cacheManager.get('classId', 'test-key')).toBe(123);
    });

    test('should handle multiple cache types', () => {
      cacheManager.set('classId', 'key1', 100);
      cacheManager.set('classId', 'key2', 200);

      expect(cacheManager.get('classId', 'key1')).toBe(100);
      expect(cacheManager.get('classId', 'key2')).toBe(200);
    });
  });

  describe('Cache Operations', () => {
    test('should check if key exists', () => {
      cacheManager.set('classId', 'key1', 100);

      expect(cacheManager.has('classId', 'key1')).toBe(true);
      expect(cacheManager.has('classId', 'nonexistent')).toBe(false);
    });

    test('should clear specific cache key', () => {
      cacheManager.set('classId', 'key1', 100, 60000);
      cacheManager.set('classId', 'key2', 200, 60000);

      cacheManager.clear('classId', 'key1');

      expect(cacheManager.get('classId', 'key1')).toBeUndefined();
      expect(cacheManager.get('classId', 'key2')).toBe(200);
    });

    test('should clear entire cache type', () => {
      cacheManager.set('classId', 'key1', 100);
      cacheManager.set('classId', 'key2', 200);

      cacheManager.clear('classId');

      expect(cacheManager.get('classId', 'key1')).toBeUndefined();
      expect(cacheManager.get('classId', 'key2')).toBeUndefined();
    });

    test('should clear all caches', () => {
      cacheManager.set('classId', 'key1', 100);
      cacheManager.set('classId', 'key2', 200);

      cacheManager.clearAll();

      expect(cacheManager.get('classId', 'key1')).toBeUndefined();
      expect(cacheManager.get('classId', 'key2')).toBeUndefined();
    });

    test('should handle unknown cache gracefully', () => {
      const result = cacheManager.get('unknown', 'key1');
      expect(result).toBeUndefined();

      // Should not throw
      expect(() => cacheManager.set('unknown', 'key1', 100)).not.toThrow();
    });
  });

  describe('Statistics', () => {
    test('should provide size information', () => {
      cacheManager.set('classId', 'key1', 100);
      cacheManager.set('classId', 'key2', 200);

      const stats = cacheManager.getStats();
      expect(stats.classId.size).toBe(2);
    });

    test('should show zero for empty cache', () => {
      const stats = cacheManager.getStats();
      expect(stats.classId.size).toBe(0);
    });
  });
});

// ===================================
// FetchClient Mock Tests
// ===================================
describe('FetchClient Mocking', () => {
  test('should properly mock POST requests', async () => {
    fetchClient.post.mockResolvedValueOnce({
      data: { success: true },
      status: 200,
    });

    const result = await fetchClient.post('https://example.com/api', { test: 'data' });

    expect(result.data.success).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchClient.post).toHaveBeenCalledWith('https://example.com/api', { test: 'data' });
  });

  test('should properly mock GET requests', async () => {
    fetchClient.get.mockResolvedValueOnce({
      data: { items: [1, 2, 3] },
      status: 200,
    });

    const result = await fetchClient.get('https://example.com/api/items');

    expect(result.data.items).toHaveLength(3);
    expect(fetchClient.get).toHaveBeenCalledTimes(1);
  });

  test('should handle mock errors', async () => {
    const mockError = new Error('Network error');
    fetchClient.get.mockRejectedValueOnce(mockError);

    await expect(fetchClient.get('https://example.com/api')).rejects.toThrow('Network error');
  });
});
