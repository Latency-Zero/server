/**
 * Integration tests for LatZero Server
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const { LatZeroServer } = require('../../index');
const path = require('path');
const os = require('os');

describe('LatZero Server Integration', () => {
  let server;
  let testConfig;

  beforeEach(() => {
    testConfig = {
      port: 45228, // Use different port for testing
      host: '127.0.0.1',
      dataDir: path.join(os.tmpdir(), 'latzero-test', Date.now().toString()),
      logLevel: 'error', // Reduce log noise during tests
      enableTLS: false,
      clusterMode: false
    };
    
    server = new LatZeroServer(testConfig);
  });

  afterEach(async () => {
    if (server && server.isRunning) {
      await server.shutdown();
    }
  });

  describe('server lifecycle', () => {
    test('should initialize server components', async () => {
      await server.initialize();
      
      expect(server.persistence).toBeDefined();
      expect(server.security).toBeDefined();
      expect(server.memoryManager).toBeDefined();
      expect(server.appRegistry).toBeDefined();
      expect(server.poolManager).toBeDefined();
      expect(server.triggerRouter).toBeDefined();
      expect(server.transport).toBeDefined();
    });

    test('should start and stop server', async () => {
      await server.start();
      
      expect(server.isRunning).toBe(true);
      
      await server.shutdown();
      
      expect(server.isRunning).toBe(false);
    });

    test('should provide server status', async () => {
      await server.initialize();
      
      const status = server.getStatus();
      
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('config');
      expect(status).toHaveProperty('stats');
      expect(status.config.port).toBe(testConfig.port);
      expect(status.config.host).toBe(testConfig.host);
    });
  });

  describe('component integration', () => {
    test('should create default pools on initialization', async () => {
      await server.initialize();
      
      const pools = server.poolManager.listPools();
      const poolNames = pools.map(p => p.name);
      
      expect(poolNames).toContain('default');
      expect(poolNames).toContain('system');
    });

    test('should handle graceful shutdown with active components', async () => {
      await server.start();
      
      // Verify all components are running
      expect(server.transport.isRunning).toBe(true);
      expect(server.poolManager.pools.size).toBeGreaterThan(0);
      
      await server.shutdown();
      
      // Verify clean shutdown
      expect(server.isRunning).toBe(false);
      expect(server.transport.isRunning).toBe(false);
    });
  });

  describe('error handling', () => {
    test('should handle initialization errors gracefully', async () => {
      // Create server with invalid configuration
      const invalidServer = new LatZeroServer({
        port: -1, // Invalid port
        dataDir: '/invalid/path/that/does/not/exist'
      });

      await expect(invalidServer.start()).rejects.toThrow();
    });

    test('should prevent double start', async () => {
      await server.start();
      
      await expect(server.start()).rejects.toThrow('Server is already running');
      
      await server.shutdown();
    });
  });

  describe('configuration', () => {
    test('should use default configuration values', () => {
      const defaultServer = new LatZeroServer();
      
      expect(defaultServer.config.port).toBe(45227);
      expect(defaultServer.config.host).toBe('127.0.0.1');
      expect(defaultServer.config.logLevel).toBe('info');
      expect(defaultServer.config.enableTLS).toBe(false);
      expect(defaultServer.config.clusterMode).toBe(false);
    });

    test('should override default configuration', () => {
      const customConfig = {
        port: 9999,
        host: '0.0.0.0',
        logLevel: 'debug',
        enableTLS: true,
        clusterMode: true
      };
      
      const customServer = new LatZeroServer(customConfig);
      
      expect(customServer.config.port).toBe(9999);
      expect(customServer.config.host).toBe('0.0.0.0');
      expect(customServer.config.logLevel).toBe('debug');
      expect(customServer.config.enableTLS).toBe(true);
      expect(customServer.config.clusterMode).toBe(true);
    });
  });
});