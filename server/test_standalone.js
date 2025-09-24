/**
 * Test script for standalone AppRegistry implementation
 */

const { AppRegistry } = require('./appRegistry_standalone');

// Mock PersistenceManager
class MockPersistenceManager {
  constructor(config) {
    this.config = config;
    this.apps = new Map();
  }
  
  async initialize() {
    console.log('[MOCK] PersistenceManager initialized');
  }
  
  async shutdown() {
    console.log('[MOCK] PersistenceManager shutdown');
  }
  
  async registerApp(app_id, triggers, pools, metadata) {
    const appData = {
      appId: app_id,
      triggers,
      pools,
      meta: metadata,
      registered: Date.now()
    };
    this.apps.set(app_id, appData);
    return appData;
  }
  
  async getApp(app_id) {
    return this.apps.get(app_id) || null;
  }
  
  async updateApp(app_id, updates) {
    const app = this.apps.get(app_id);
    if (app) {
      Object.assign(app, updates);
    }
    return app;
  }
  
  async removeApp(app_id) {
    return this.apps.delete(app_id);
  }
  
  async getAllApps() {
    return Array.from(this.apps.values());
  }
  
  async loadAppRegistrations() {
    return Array.from(this.apps.values());
  }
}

// Mock connection class for testing
class MockConnection {
  constructor(id) {
    this.id = id;
    this.isActive = true;
    this.sentMessages = [];
  }

  send(message) {
    this.sentMessages.push(message);
    console.log(`[BLUE] 📤 Connection ${this.id} sent:`, JSON.stringify(message, null, 2));
    return true;
  }

  close() {
    this.isActive = false;
  }
}

async function testAppRegistry() {
  console.log('[YELLOW] 🧪 Starting AppRegistry Tests...');
  
  try {
    // Initialize persistence manager
    const persistence = new MockPersistenceManager({ memoryMode: true });
    await persistence.initialize();
    
    // Initialize app registry
    const config = {
      registry: {
        cleanupInterval: 60000,
        rehydrationCacheMaxAge: 300000
      }
    };
    
    const appRegistry = new AppRegistry(config, persistence);
    await appRegistry.initialize();
    
    // Test 1: Register a new app
    console.log('[CYAN] \n📋 Test 1: Register new app');
    const connection1 = new MockConnection(1);
    const registration1 = await appRegistry.registerApp(
      'test-app-1',
      ['trigger1', 'trigger2'],
      ['pool1', 'default'],
      { version: '1.0.0' },
      connection1
    );
    
    console.log('[GREEN] ✅ App registered:', registration1.appId);
    
    // Test 2: Process handshake
    console.log('[CYAN] \n📋 Test 2: Process handshake');
    const connection2 = new MockConnection(2);
    const handshakeMessage = {
      type: 'handshake',
      id: 'msg-123',
      app_id: 'test-app-2',
      pools: ['pool2'],
      triggers: ['trigger3', 'trigger4'],
      metadata: { version: '2.0.0' },
      protocol_version: '0.1.0'
    };
    
    const registration2 = await appRegistry.processHandshake(handshakeMessage, connection2);
    console.log('[GREEN] ✅ Handshake processed for:', registration2.appId);
    
    // Test 3: Get all apps
    console.log('[CYAN] \n📋 Test 3: Get all apps');
    const allApps = await appRegistry.getAllApps();
    console.log(`[GREEN] ✅ Found ${allApps.length} apps:`, allApps.map(app => app.appId));
    
    // Test 4: Get apps by pool
    console.log('[CYAN] \n📋 Test 4: Get apps by pool');
    const pool1Apps = await appRegistry.getAppsByPool('pool1');
    console.log(`[GREEN] ✅ Found ${pool1Apps.length} apps in pool1:`, pool1Apps.map(app => app.appId));
    
    // Test 5: Update app
    console.log('[CYAN] \n📋 Test 5: Update app');
    const updatedApp = await appRegistry.updateApp('test-app-1', {
      triggers: ['trigger1', 'trigger5'],
      metadata: { version: '1.1.0' }
    });
    console.log('[GREEN] ✅ App updated:', updatedApp.appId);
    
    // Test 6: Get trigger handlers
    console.log('[CYAN] \n📋 Test 6: Get trigger handlers');
    const handlers = appRegistry.getTriggersHandlers('trigger1');
    console.log(`[GREEN] ✅ Found ${handlers.length} handlers for trigger1:`, handlers.map(h => h.appId));
    
    // Test 7: Test rehydration
    console.log('[CYAN] \n📋 Test 7: Test rehydration');
    
    // Disconnect app
    await appRegistry.handleDisconnection(connection1);
    console.log('[YELLOW] 📤 App disconnected');
    
    // Reconnect with minimal handshake (rehydration)
    const connection3 = new MockConnection(3);
    const rehydrationMessage = {
      type: 'handshake',
      id: 'msg-456',
      app_id: 'test-app-1',
      pools: [],
      triggers: [],
      metadata: {},
      protocol_version: '0.1.0'
    };
    
    const rehydratedApp = await appRegistry.processHandshake(rehydrationMessage, connection3);
    console.log('[GREEN] ✅ App rehydrated:', rehydratedApp.appId);
    console.log('[BLUE]    Restored triggers:', rehydratedApp.triggers);
    
    // Test 8: Validation tests
    console.log('[CYAN] \n📋 Test 8: Validation tests');
    
    // Test invalid app_id
    try {
      await appRegistry.registerApp('', ['trigger'], ['pool']);
      console.log('[RED] ❌ Should have failed for empty app_id');
    } catch (error) {
      console.log('[GREEN] ✅ Correctly rejected empty app_id');
    }
    
    // Test invalid triggers
    try {
      await appRegistry.registerApp('test-app', [''], ['pool']);
      console.log('[RED] ❌ Should have failed for empty trigger');
    } catch (error) {
      console.log('[GREEN] ✅ Correctly rejected empty trigger');
    }
    
    // Test 9: Statistics
    console.log('[CYAN] \n📋 Test 9: Registry statistics');
    const stats = appRegistry.getStats();
    console.log('[GREEN] ✅ Registry stats:', JSON.stringify(stats, null, 2));
    
    // Test 10: Remove app
    console.log('[CYAN] \n📋 Test 10: Remove app');
    const removed = await appRegistry.removeApp('test-app-2');
    console.log('[GREEN] ✅ App removed:', removed);
    
    // Final stats
    const finalStats = appRegistry.getStats();
    console.log('[BLUE] \n📊 Final stats:', JSON.stringify(finalStats, null, 2));
    
    // Cleanup
    await appRegistry.shutdown();
    await persistence.shutdown();
    
    console.log('[GREEN] \n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('[RED] \n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testAppRegistry().catch(error => {
    console.error('[RED] ❌ Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = { testAppRegistry };