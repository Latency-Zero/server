/**
 * Unit tests for Transport module
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const Transport = require('../../transport');

describe('Transport', () => {
  let transport;
  let mockConfig;
  let mockTriggerRouter;

  beforeEach(() => {
    mockConfig = {
      port: 45227,
      host: '127.0.0.1',
      enableTLS: false
    };
    
    mockTriggerRouter = {
      handleMessage: jest.fn()
    };
    
    transport = new Transport(mockConfig, mockTriggerRouter);
  });

  afterEach(async () => {
    if (transport && transport.isRunning) {
      await transport.shutdown();
    }
  });

  describe('initialization', () => {
    test('should initialize with correct configuration', async () => {
      await transport.initialize();
      
      expect(transport.config.port).toBe(45227);
      expect(transport.config.host).toBe('127.0.0.1');
      expect(transport.config.enableTLS).toBe(false);
    });

    test('should create server instance', async () => {
      await transport.initialize();
      
      expect(transport.server).toBeDefined();
      expect(transport.isRunning).toBe(false);
    });
  });

  describe('connection handling', () => {
    test('should track active connections', async () => {
      await transport.initialize();
      
      expect(transport.connections.size).toBe(0);
    });

    test('should handle connection cleanup', async () => {
      await transport.initialize();
      
      // TODO: Add connection simulation tests
      expect(transport.getStats().activeConnections).toBe(0);
    });
  });

  describe('statistics', () => {
    test('should provide transport statistics', () => {
      const stats = transport.getStats();
      
      expect(stats).toHaveProperty('activeConnections');
      expect(stats).toHaveProperty('isRunning');
      expect(stats).toHaveProperty('port');
      expect(stats).toHaveProperty('host');
      expect(stats).toHaveProperty('tlsEnabled');
    });
  });
});