/**
 * Jest test setup file
 * This file is run before each test suite
 */

// Global test configuration
global.console = {
  ...console,
  // Suppress console.log during tests unless explicitly needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Mock timers for consistent testing
jest.useFakeTimers();

// Global test utilities
global.testUtils = {
  /**
   * Create a mock configuration for testing
   */
  createMockConfig: (overrides = {}) => ({
    port: 45228,
    host: '127.0.0.1',
    dataDir: '/tmp/latzero-test',
    logLevel: 'error',
    enableTLS: false,
    clusterMode: false,
    ...overrides
  }),

  /**
   * Wait for a specified amount of time
   */
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Create a mock connection object
   */
  createMockConnection: (id = 1) => ({
    id: id,
    isActive: true,
    send: jest.fn(),
    close: jest.fn()
  }),

  /**
   * Create a mock message object
   */
  createMockMessage: (type, data = {}) => ({
    action: type,
    id: `test-${Date.now()}`,
    timestamp: Date.now(),
    ...data
  })
};

// Setup and teardown hooks
beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

afterEach(() => {
  // Clean up any test artifacts
  jest.clearAllTimers();
});