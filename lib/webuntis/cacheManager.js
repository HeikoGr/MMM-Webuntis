/**
 * Cache Manager Service
 * Centralized caching for WebUntis API responses and resolved class IDs
 */

/**
 * CacheManager class for managing various caches with TTL support
 */
class CacheManager {
  /**
   * Creates a new CacheManager instance
   * @param {Function} [logger] - Optional logger function for debug output
   */
  constructor(logger) {
    this._caches = {
      classId: new Map(), // classId cache: cacheKey -> classId
    };
    this._logger = logger || (() => {});
  }

  /**
   * Get a value from a specific cache
   *
   * @param {string} cacheName - Name of the cache ('classId')
   * @param {string} key - Cache key
   * @returns {any} Cached value or undefined if not found/expired
   */
  get(cacheName, key) {
    const cache = this._caches[cacheName];
    if (!cache) {
      this._logger('warn', `Unknown cache: ${cacheName}`);
      return undefined;
    }

    const entry = cache.get(key);
    if (!entry) return undefined;

    // Check TTL if present
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      cache.delete(key);
      return undefined;
    }

    return entry.value !== undefined ? entry.value : entry;
  }

  /**
   * Set a value in a specific cache
   *
   * @param {string} cacheName - Name of the cache ('classId')
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} [ttl] - Optional time-to-live in milliseconds
   */
  set(cacheName, key, value, ttl) {
    const cache = this._caches[cacheName];
    if (!cache) {
      this._logger('warn', `Unknown cache: ${cacheName}`);
      return;
    }

    const entry = ttl ? { value, expiresAt: Date.now() + ttl } : value;
    cache.set(key, entry);
  }

  /**
   * Check if a key exists in a cache (and is not expired)
   *
   * @param {string} cacheName - Name of the cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and is not expired
   */
  has(cacheName, key) {
    return this.get(cacheName, key) !== undefined;
  }

  /**
   * Clear a specific cache or a specific key
   *
   * @param {string} cacheName - Name of the cache to clear
   * @param {string} [key] - Optional specific key to clear (if omitted, clears entire cache)
   */
  clear(cacheName, key) {
    const cache = this._caches[cacheName];
    if (!cache) {
      this._logger('warn', `Unknown cache: ${cacheName}`);
      return;
    }

    if (key) {
      cache.delete(key);
      this._logger('debug', `Cleared ${cacheName} cache key: ${key}`);
    } else {
      cache.clear();
      this._logger('debug', `Cleared entire ${cacheName} cache`);
    }
  }

  /**
   * Clear all caches
   */
  clearAll() {
    Object.keys(this._caches).forEach((cacheName) => {
      this._caches[cacheName].clear();
    });
    this._logger('debug', 'Cleared all caches');
  }

  /**
   * Get statistics for a specific cache or all caches
   *
   * @param {string} [cacheName] - Optional cache name (if omitted, returns stats for all caches)
   * @returns {Object} Cache statistics
   */
  getStats(cacheName) {
    if (cacheName) {
      const cache = this._caches[cacheName];
      if (!cache) return { name: cacheName, exists: false };

      return {
        name: cacheName,
        size: cache.size,
        keys: Array.from(cache.keys()),
      };
    }

    // Return stats for all caches
    const stats = {};
    Object.keys(this._caches).forEach((name) => {
      const cache = this._caches[name];
      stats[name] = {
        size: cache.size,
        keys: Array.from(cache.keys()),
      };
    });
    return stats;
  }

  /**
   * Clean up expired entries from all caches
   */
  cleanupExpired() {
    let cleaned = 0;
    Object.entries(this._caches).forEach(([, cache]) => {
      const toDelete = [];
      cache.forEach((entry, key) => {
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
          toDelete.push(key);
        }
      });
      toDelete.forEach((key) => {
        cache.delete(key);
        cleaned++;
      });
    });
    if (cleaned > 0) {
      this._logger('debug', `Cleaned up ${cleaned} expired cache entries`);
    }
    return cleaned;
  }
}

module.exports = CacheManager;
