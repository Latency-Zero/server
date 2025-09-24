/**
 * Test script for AppRegistry implementation
 */

const { AppRegistry } = require('./appRegistry');
const { PersistenceManager } = require('./persistence');
const chalk = require('chalk');

// Mock PoolManager for testing
class MockPoolManager {
  constructor() {
    this.memberships = new Map();
  }

  async addAppToPool(appId, poolName) {
    if (!this.memberships.has(appId)) {
      this.memberships.set(appId, new Set());
    }
    this.memberships.get(appId).add(poolName);
    console.log(chalk.cyan(`🏊 Mock added app ${appId} to pool ${poolName}`));
    return true;
  }

  async removeAppFromPool(appId, poolName) {
    if (this.memberships.has(appId)) {
      this.memberships.get(appId).delete(poolName);
    }
    console.log(chalk.cyan(`🏊 Mock removed app ${appId} from pool ${poolName}`));
    return true;
  }

  validatePoolMembership(appId, poolName) {
    return this.memberships.has(appId) && this.memberships.get(appId).has(poolName);
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
    console.log(chalk.blue(`📤 Connection ${this.id} sent:`, JSON.stringify(message, null, 2)));
    return true;
  }

  close() {
    this.isActive = false;
  }
}

async function testAppRegistry() {
  console.log(chalk.yellow('🧪 Starting AppRegistry Tests...'));
  
  try {
    // Initialize persistence manager
    const persistence = new PersistenceManager({ memoryMode: true });
    await persistence.initialize();

    // Initialize mock pool manager
    const poolManager = new MockPoolManager();

    // Initialize app registry
    const config = {
      registry: {
        cleanupInterval: 60000,
        rehydrationCacheMaxAge: 300000
      }
    };

    const appRegistry = new AppRegistry(config, persistence, poolManager);
    await appRegistry.initialize();
    
    // Test 1: Register a new app
    console.log(chalk.cyan('\n📋 Test 1: Register new app'));
    const connection1 = new MockConnection(1);
    const registration1 = await appRegistry.registerApp(
      'test-app-1',
      ['trigger1', 'trigger2'],
      ['pool1', 'default'],
      { version: '1.0.0' },
      connection1
    );
    
    console.log(chalk.green('✅ App registered:', registration1.appId));
    
    // Test 2: Process handshake
    console.log(chalk.cyan('\n📋 Test 2: Process handshake'));
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
    console.log(chalk.green('✅ Handshake processed for:', registration2.appId));
    
    // Test 3: Get all apps
    console.log(chalk.cyan('\n📋 Test 3: Get all apps'));
    const allApps = await appRegistry.getAllApps();
    console.log(chalk.green(`✅ Found ${allApps.length} apps:`, allApps.map(app => app.appId)));
    
    // Test 4: Get apps by pool
    console.log(chalk.cyan('\n📋 Test 4: Get apps by pool'));
    const pool1Apps = await appRegistry.getAppsByPool('pool1');
    console.log(chalk.green(`✅ Found ${pool1Apps.length} apps in pool1:`, pool1Apps.map(app => app.appId)));
    
    // Test 5: Update app
    console.log(chalk.cyan('\n📋 Test 5: Update app'));
    const updatedApp = await appRegistry.updateApp('test-app-1', {
      triggers: ['trigger1', 'trigger5'],
      metadata: { version: '1.1.0' }
    });
    console.log(chalk.green('✅ App updated:', updatedApp.appId));
    
    // Test 6: Get trigger handlers
    console.log(chalk.cyan('\n📋 Test 6: Get trigger handlers'));
    const handlers = appRegistry.getTriggersHandlers('trigger1');
    console.log(chalk.green(`✅ Found ${handlers.length} handlers for trigger1:`, handlers.map(h => h.appId)));
    
    // Test 7: Test rehydration
    console.log(chalk.cyan('\n📋 Test 7: Test rehydration'));
    
    // Disconnect app
    await appRegistry.handleDisconnection(connection1);
    console.log(chalk.yellow('📤 App disconnected'));
    
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
    console.log(chalk.green('✅ App rehydrated:', rehydratedApp.appId));
    console.log(chalk.blue('   Restored triggers:', rehydratedApp.triggers));
    
    // Test 8: Validation tests
    console.log(chalk.cyan('\n📋 Test 8: Validation tests'));
    
    // Test invalid app_id
    try {
      await appRegistry.registerApp('', ['trigger'], ['pool']);
      console.log(chalk.red('❌ Should have failed for empty app_id'));
    } catch (error) {
      console.log(chalk.green('✅ Correctly rejected empty app_id'));
    }
    
    // Test invalid triggers
    try {
      await appRegistry.registerApp('test-app', [''], ['pool']);
      console.log(chalk.red('❌ Should have failed for empty trigger'));
    } catch (error) {
      console.log(chalk.green('✅ Correctly rejected empty trigger'));
    }
    
    // Test 9: Statistics
    console.log(chalk.cyan('\n📋 Test 9: Registry statistics'));
    const stats = appRegistry.getStats();
    console.log(chalk.green('✅ Registry stats:', JSON.stringify(stats, null, 2)));
    
    // Test 10: Remove app
    console.log(chalk.cyan('\n📋 Test 10: Remove app'));
    const removed = await appRegistry.removeApp('test-app-2');
    console.log(chalk.green('✅ App removed:', removed));
    
    // Final stats
    const finalStats = appRegistry.getStats();
    console.log(chalk.blue('\n📊 Final stats:', JSON.stringify(finalStats, null, 2)));
    
    // Cleanup
    await appRegistry.shutdown();
    await persistence.shutdown();
    
    console.log(chalk.green('\n🎉 All tests completed successfully!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testAppRegistry().catch(error => {
    console.error(chalk.red('❌ Test execution failed:'), error);
    process.exit(1);
  });
}

module.exports = { testAppRegistry };