/**
 * Unit tests for lib/errorUtils.js
 * Tests error handling utilities: wrapAsync, tryOrDefault, tryOrThrow, tryOrNull
 */

const { wrapAsync, tryOrDefault, tryOrThrow, tryOrNull } = require('../../lib/errorUtils');

describe('lib/errorUtils', () => {
  const mockLogger = jest.fn();
  const mockWarnings = new Set();

  beforeEach(() => {
    mockLogger.mockClear();
    mockWarnings.clear();
  });

  // =========================================================================
  // wrapAsync tests
  // =========================================================================
  describe('wrapAsync', () => {
    test('returns result on success', async () => {
      const fn = async () => ({ data: 'success' });
      const result = await wrapAsync(fn, { logger: mockLogger, defaultValue: null });
      expect(result).toEqual({ data: 'success' });
    });

    test('logs error on failure', async () => {
      const fn = async () => {
        throw new Error('Network error');
      };
      const result = await wrapAsync(fn, { logger: mockLogger, defaultValue: [] });
      expect(result).toEqual([]);
      expect(mockLogger).toHaveBeenCalled();
    });

    test('collects user-friendly warnings', async () => {
      const fn = async () => {
        throw new Error('401 Unauthorized');
      };
      const result = await wrapAsync(fn, {
        logger: mockLogger,
        context: { studentTitle: 'Max', server: 'webuntis.com' },
        defaultValue: [],
        warnings: mockWarnings,
      });
      expect(result).toEqual([]);
      expect(mockWarnings.size).toBeGreaterThan(0);
    });

    test('rethrows error when rethrow=true', async () => {
      const fn = async () => {
        throw new Error('Critical error');
      };
      await expect(wrapAsync(fn, { logger: mockLogger, rethrow: true })).rejects.toThrow('Critical error');
    });

    test('ignores logger errors gracefully', async () => {
      const badLogger = () => {
        throw new Error('Logger broken');
      };
      const fn = async () => {
        throw new Error('Test error');
      };
      // Should not throw, despite bad logger
      const result = await wrapAsync(fn, { logger: badLogger, defaultValue: 'fallback' });
      expect(result).toBe('fallback');
    });
  });

  // =========================================================================
  // tryOrDefault tests (sync)
  // =========================================================================
  describe('tryOrDefault', () => {
    test('returns result on success', () => {
      const fn = () => ({ parsed: true });
      const result = tryOrDefault(fn, { default: false }, mockLogger);
      expect(result).toEqual({ parsed: true });
    });

    test('returns default value on error', () => {
      const fn = () => {
        throw new Error('Parse failed');
      };
      const result = tryOrDefault(fn, [], mockLogger);
      expect(result).toEqual([]);
      expect(mockLogger).toHaveBeenCalled();
    });

    test('logs error even with bad logger', () => {
      const fn = () => {
        throw new Error('Error');
      };
      const badLogger = () => {
        throw new Error('Logger broken');
      };
      const result = tryOrDefault(fn, 'fallback', badLogger);
      expect(result).toBe('fallback');
    });
  });

  // =========================================================================
  // tryOrThrow tests (sync, propagates)
  // =========================================================================
  describe('tryOrThrow', () => {
    test('returns result on success', () => {
      const fn = () => 42;
      const result = tryOrThrow(fn, mockLogger);
      expect(result).toBe(42);
    });

    test('logs and rethrows error', () => {
      const fn = () => {
        throw new Error('Validation failed');
      };
      expect(() => tryOrThrow(fn, mockLogger)).toThrow('Validation failed');
      expect(mockLogger).toHaveBeenCalled();
    });

    test('rethrows original error, not logger error', () => {
      const badLogger = () => {
        throw new Error('Logger error');
      };
      const fn = () => {
        throw new Error('Original error');
      };
      expect(() => tryOrThrow(fn, badLogger)).toThrow('Original error');
    });
  });

  // =========================================================================
  // tryOrNull tests (sync, silent)
  // =========================================================================
  describe('tryOrNull', () => {
    test('returns result on success', () => {
      const fn = () => ({ value: 123 });
      const result = tryOrNull(fn, mockLogger);
      expect(result).toEqual({ value: 123 });
    });

    test('returns null on error', () => {
      const fn = () => {
        throw new Error('Parse error');
      };
      const result = tryOrNull(fn, mockLogger);
      expect(result).toBeNull();
      expect(mockLogger).toHaveBeenCalled();
    });

    test('returns null even with bad logger', () => {
      const badLogger = () => {
        throw new Error('Logger broken');
      };
      const fn = () => {
        throw new Error('Error');
      };
      const result = tryOrNull(fn, badLogger);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Integration: Pattern selection
  // =========================================================================
  describe('pattern selection', () => {
    test('wrapAsync for optional API calls (network fallback)', async () => {
      // Simulates: fetch timetable, if fails return empty array and collect warning
      const apiCall = async () => {
        throw new Error('503 Service Unavailable');
      };
      const warnings = new Set();
      const result = await wrapAsync(apiCall, {
        logger: mockLogger,
        context: { dataType: 'timetable', studentTitle: 'Student' },
        defaultValue: [],
        warnings,
      });
      expect(result).toEqual([]);
      expect(warnings.size).toBeGreaterThan(0); // User gets warning
    });

    test('tryOrThrow for required config parsing (fail-fast)', () => {
      // Simulates: config must be valid JSON or we stop
      const parseConfig = () => {
        throw new Error('Invalid JSON');
      };
      expect(() => tryOrThrow(parseConfig, mockLogger)).toThrow();
    });

    test('tryOrNull for optional string parsing (silent graceful)', () => {
      // Simulates: try to parse optional metadata, but if fails just skip
      const parseMetadata = () => {
        throw new Error('Not a string');
      };
      const result = tryOrNull(parseMetadata, mockLogger);
      expect(result).toBeNull(); // Silent, no error bubbled
    });
  });
});
