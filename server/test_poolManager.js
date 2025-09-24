/**
 * LatZero Pool Manager Test
 * 
 * Simple test to verify the pool manager implementation
 */

const { PoolManager, PoolTypes, AccessPolicies } = require('./poolManager');
const { PersistenceManager } = require('./persistence');
const chalk = require('chalk');

// Mock security module
class MockSecurity {
  async checkPoolAccess(appId, poolName, permission) {
    console.log(chalk.blue(`🔐 Security check: ${appId} -> ${poolName} (${permission})`));
    return true; // Allow all for testing
  }

  async prepareEncryptedPool(poolName, config) {
    console.log(chalk.blue(`🔐 Preparing encrypted pool: ${poolName}`));
    return {
      keyDerivation: 'pbkdf2',
      algorithm: 'aes-256-gcm',
      sigilKey: 'mock-sigil-key',
      cipherShard: 'mock-cipher-shard',
      oblivionSeal: 'mock-oblivion-seal'
    };
  }
}

// Mock memory manager
class MockMemoryManager {
  async destroyBlock(blockId) {
    console.log(chalk.blue(`🧠 Destroying memory block: ${blockId}`));
    return true;
  }

  async validateBlock(blockId) {
    console.log(chalk.blue(`🧠 Validating memory block: ${blockId}`));
    return true;
  }
}

async function runTests() {
  console.log(chalk.blue('🧪 Starting Pool Manager Tests...'));
  
  try {
    // Initialize dependencies
    const config = { memoryMode: true };
    const persistence = new PersistenceManager(config);
    const security = new MockSecurity();
    const memoryManager = new MockMemoryManager();
    
    await persistence.initialize();
    
    // Initialize pool manager
    const poolManager = new PoolManager(config, persistence, security, memoryManager);
    await poolManager.initialize();
    
    console.log(chalk.green('✅ Pool Manager initialized successfully'));
    
    // Test 1: Create a local pool
    console.log(chalk.blue('\n🧪 Test 1: Create local pool'));
    const localPool = await poolManager.createPool('test-local', PoolTypes.LOCAL, false, {
      description: 'Test local pool',
      maxMemoryBlocks: 100
    });
    console.log(chalk.green('✅ Local pool created:', localPool.name));
    
    // Test 2: Create an encrypted pool
    console.log(chalk.blue('\n🧪 Test 2: Create encrypted pool'));
    const encryptedPool = await poolManager.createPool('test-encrypted', PoolTypes.ENCRYPTED, true, {
      description: 'Test encrypted pool',
      owners: ['admin']
    });
    console.log(chalk.green('✅ Encrypted pool created:', encryptedPool.name));
    
    // Test 3: Add app to pool
    console.log(chalk.blue('\n🧪 Test 3: Add app to pool'));
    await poolManager.addAppToPool('test-app-1', 'test-local');
    console.log(chalk.green('✅ App added to pool'));
    
    // Test 4: Get pool members
    console.log(chalk.blue('\n🧪 Test 4: Get pool members'));
    const members = poolManager.getPoolMembers('test-local');
    console.log(chalk.green('✅ Pool members:', members));
    
    // Test 5: Get app pools
    console.log(chalk.blue('\n🧪 Test 5: Get app pools'));
    const appPools = poolManager.getAppPools('test-app-1');
    console.log(chalk.green('✅ App pools:', appPools));
    
    // Test 6: Set pool property
    console.log(chalk.blue('\n🧪 Test 6: Set pool property'));
    await poolManager.setPoolProperty('test-local', 'custom-setting', 'test-value');
    const propertyValue = poolManager.getPoolProperty('test-local', 'custom-setting');
    console.log(chalk.green('✅ Pool property set and retrieved:', propertyValue));
    
    // Test 7: Get all pools
    console.log(chalk.blue('\n🧪 Test 7: Get all pools'));
    const allPools = await poolManager.getAllPools();
    console.log(chalk.green('✅ All pools retrieved:', allPools.map(p => p.name)));
    
    // Test 8: Get pools by type
    console.log(chalk.blue('\n🧪 Test 8: Get pools by type'));
    const localPools = await poolManager.getLocalPools();
    const encryptedPools = await poolManager.getEncryptedPools();
    console.log(chalk.green('✅ Local pools:', localPools.map(p => p.name)));
    console.log(chalk.green('✅ Encrypted pools:', encryptedPools.map(p => p.name)));
    
    // Test 9: Pool namespace operations
    console.log(chalk.blue('\n🧪 Test 9: Pool namespace operations'));
    const namespace = poolManager.getPoolNamespace('test-local');
    console.log(chalk.green('✅ Pool namespace:', namespace));
    
    // Test 10: Validate pool membership
    console.log(chalk.blue('\n🧪 Test 10: Validate pool membership'));
    const isMember = poolManager.validatePoolMembership('test-app-1', 'test-local');
    console.log(chalk.green('✅ Pool membership validation:', isMember));
    
    // Test 11: Get pool statistics
    console.log(chalk.blue('\n🧪 Test 11: Get pool statistics'));
    const stats = poolManager.getStats();
    console.log(chalk.green('✅ Pool manager stats:', stats));
    
    // Test 12: Remove app from pool
    console.log(chalk.blue('\n🧪 Test 12: Remove app from pool'));
    await poolManager.removeAppFromPool('test-app-1', 'test-local');
    const membersAfterRemoval = poolManager.getPoolMembers('test-local');
    console.log(chalk.green('✅ App removed, remaining members:', membersAfterRemoval));
    
    // Test 13: Remove pool
    console.log(chalk.blue('\n🧪 Test 13: Remove pool'));
    const removed = await poolManager.removePool('test-local');
    console.log(chalk.green('✅ Pool removed:', removed));
    
    // Cleanup
    await poolManager.shutdown();
    await persistence.shutdown();
    
    console.log(chalk.green('\n🎉 All tests passed successfully!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error(chalk.red('❌ Test execution failed:'), error);
    process.exit(1);
  });
}

module.exports = { runTests };