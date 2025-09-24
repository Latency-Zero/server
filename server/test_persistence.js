/**
 * Simple test script for the PersistenceManager implementation
 */

const { PersistenceManager } = require('./persistence');
const path = require('path');
const fs = require('fs').promises;

async function testPersistence() {
  console.log('🧪 Testing PersistenceManager implementation...\n');

  // Create test data directory
  const testDataDir = path.join(__dirname, 'test_data');
  
  try {
    // Clean up any existing test data
    await fs.rmdir(testDataDir, { recursive: true }).catch(() => {});
    
    // Initialize persistence manager
    const persistence = new PersistenceManager({
      dataDir: testDataDir,
      memoryMode: false,
      backupInterval: 60000 // 1 minute for testing
    });

    console.log('✅ PersistenceManager created successfully');

    // Initialize the persistence layer
    await persistence.initialize();
    console.log('✅ Persistence layer initialized');

    // Test AppRegistry CRUD operations
    console.log('\n📋 Testing AppRegistry CRUD operations...');
    
    // Register an app
    const appResult = await persistence.registerApp('test-app-1', ['trigger1', 'trigger2'], ['pool1', 'pool2'], {
      version: '1.0.0',
      description: 'Test application'
    });
    console.log('✅ App registered:', appResult.app_id);

    // Get the app
    const retrievedApp = await persistence.getApp('test-app-1');
    console.log('✅ App retrieved:', retrievedApp.appId);

    // Update the app
    const updatedApp = await persistence.updateApp('test-app-1', {
      triggers: ['trigger1', 'trigger2', 'trigger3'],
      meta: { version: '1.1.0', description: 'Updated test application' }
    });
    console.log('✅ App updated, new trigger count:', updatedApp.triggers.length);

    // Get all apps
    const allApps = await persistence.getAllApps();
    console.log('✅ All apps retrieved, count:', allApps.length);

    // Test Pool CRUD operations
    console.log('\n🏊 Testing Pool CRUD operations...');
    
    // Create a pool
    const poolResult = await persistence.createPool('test-pool-1', 'local', false, {
      description: 'Test pool for development',
      owners: ['test-app-1'],
      policies: { read: ['*'], write: ['test-app-1'] }
    });
    console.log('✅ Pool created:', poolResult.name);

    // Get the pool
    const retrievedPool = await persistence.getPool('test-pool-1');
    console.log('✅ Pool retrieved:', retrievedPool.name);

    // Update the pool
    const updatedPool = await persistence.updatePool('test-pool-1', {
      description: 'Updated test pool',
      encrypted: true
    });
    console.log('✅ Pool updated, encrypted:', updatedPool.encrypted);

    // Get all pools
    const allPools = await persistence.getAllPools();
    console.log('✅ All pools retrieved, count:', allPools.length);

    // Test Memory Block CRUD operations
    console.log('\n🧠 Testing Memory Block CRUD operations...');
    
    // Create a memory block
    const blockResult = await persistence.createMemoryBlock('test-block-1', 1024, 'json', {
      name: 'Test JSON Block',
      pool: 'test-pool-1',
      persistent: true,
      permissions: { read: ['test-app-1'], write: ['test-app-1'] }
    });
    console.log('✅ Memory block created:', blockResult.id);

    // Get the memory block
    const retrievedBlock = await persistence.getMemoryBlock('test-block-1');
    console.log('✅ Memory block retrieved:', retrievedBlock.id);

    // Update the memory block
    const updatedBlock = await persistence.updateMemoryBlock('test-block-1', {
      name: 'Updated Test JSON Block',
      encrypted: true
    });
    console.log('✅ Memory block updated, version:', updatedBlock.version);

    // Get all memory blocks
    const allBlocks = await persistence.getAllMemoryBlocks();
    console.log('✅ All memory blocks retrieved, count:', allBlocks.length);

    // Test transaction support
    console.log('\n💾 Testing transaction support...');
    
    await persistence.transaction(async () => {
      await persistence.registerApp('tx-app-1', ['tx-trigger'], ['tx-pool'], { transactional: true });
      await persistence.createPool('tx-pool-1', 'local', false, { description: 'Transactional pool' });
      return 'Transaction completed successfully';
    });
    console.log('✅ Transaction completed successfully');

    // Test backup functionality
    console.log('\n📦 Testing backup functionality...');
    const backupPath = await persistence.createBackup();
    console.log('✅ Backup created at:', backupPath);

    // Get statistics
    console.log('\n📊 Getting persistence statistics...');
    const stats = persistence.getStats();
    console.log('✅ Statistics retrieved:', {
      schemaVersion: stats.schemaVersion,
      activeTransactions: stats.activeTransactions,
      preparedStatements: stats.preparedStatements
    });

    // Cleanup
    await persistence.shutdown();
    console.log('✅ Persistence layer shutdown complete');

    console.log('\n🎉 All tests passed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testPersistence().catch(console.error);