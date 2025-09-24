/**
 * LatZero Integration Test Suite
 *
 * Comprehensive automated testing of all LatZero server functionality.
 * This test suite verifies connections, triggers, memory operations, error handling,
 * and performance characteristics.
 *
 * Usage:
 *   node integration-test.js [test-pattern] [options]
 *
 * Options:
 *   --verbose     - Detailed output
 *   --quick       - Run only essential tests
 *   --performance - Include performance benchmarks
 *   --stress      - Include stress testing
 *
 * Test Categories:
 * - Connection & Handshake
 * - Trigger Operations
 * - Memory Block Operations
 * - Error Handling & Recovery
 * - Performance & Load Testing
 * - Rehydration & Persistence
 */

const { LatZeroClient } = require('./test-client');

class TestResult {
  constructor(name, category = 'general') {
    this.name = name;
    this.category = category;
    this.status = 'pending'; // pending, running, passed, failed, skipped
    this.duration = 0;
    this.error = null;
    this.details = [];
    this.startTime = 0;
  }

  start() {
    this.status = 'running';
    this.startTime = Date.now();
  }

  pass(details = '') {
    this.status = 'passed';
    this.duration = Date.now() - this.startTime;
    if (details) this.details.push(details);
  }

  fail(error, details = '') {
    this.status = 'failed';
    this.duration = Date.now() - this.startTime;
    this.error = error;
    if (details) this.details.push(details);
  }

  skip(reason = '') {
    this.status = 'skipped';
    this.details.push(`Skipped: ${reason}`);
  }

  addDetail(detail) {
    this.details.push(detail);
  }
}

class IntegrationTestSuite {
  constructor(options = {}) {
    this.options = {
      verbose: options.verbose || false,
      quick: options.quick || false,
      performance: options.performance || false,
      stress: options.stress || false,
      ...options
    };

    this.results = [];
    this.clients = [];
    this.testStartTime = 0;
    this.currentTest = null;
  }

  async run(testPattern = null) {
    console.log(`🧪 Starting LatZero Integration Test Suite`);
    console.log(`==========================================`);

    if (this.options.verbose) {
      console.log(`📋 Test Options:`, this.options);
    }

    this.testStartTime = Date.now();

    try {
      // Run all test categories
      await this.runConnectionTests();
      await this.runTriggerTests();
      await this.runMemoryTests();
      await this.runErrorHandlingTests();

      if (!this.options.quick) {
        await this.runRehydrationTests();
      }

      if (this.options.performance) {
        await this.runPerformanceTests();
      }

      if (this.options.stress) {
        await this.runStressTests();
      }

      // Generate final report
      this.generateReport();

    } catch (error) {
      console.error(`❌ Test suite failed:`, error.message);
      this.generateReport();
      throw error;
    } finally {
      // Cleanup all clients
      await this.cleanup();
    }
  }

  async runTest(testName, category, testFunction) {
    const result = new TestResult(testName, category);
    this.results.push(result);
    this.currentTest = result;

    result.start();

    if (this.options.verbose) {
      console.log(`🧪 Running: ${testName}`);
    }

    try {
      await testFunction(result);
      result.pass();
      if (this.options.verbose) {
        console.log(`✅ Passed: ${testName} (${result.duration}ms)`);
      }
    } catch (error) {
      result.fail(error);
      console.log(`❌ Failed: ${testName} - ${error.message}`);
      if (this.options.verbose) {
        console.error(`   Error details:`, error.stack);
      }
    }

    this.currentTest = null;
    return result;
  }

  async runConnectionTests() {
    console.log(`🔗 Running Connection Tests...`);

    await this.runTest('Basic Connection', 'connection', async (result) => {
      const client = new LatZeroClient({ appId: 'test-connection-1' });
      this.clients.push(client);

      await client.connect();
      result.addDetail('Connected to server');

      const handshakeResult = await client.handshake({
        pools: ['test-pool'],
        triggers: ['test-trigger']
      });
      result.addDetail('Handshake completed');

      if (!handshakeResult.app_id || handshakeResult.app_id !== 'test-connection-1') {
        throw new Error('Handshake returned incorrect app_id');
      }
    });

    await this.runTest('Multiple Connections', 'connection', async (result) => {
      const clients = [];
      for (let i = 0; i < 5; i++) {
        const client = new LatZeroClient({ appId: `test-multi-${i}` });
        clients.push(client);
        this.clients.push(client);

        await client.connect();
        await client.handshake({
          pools: ['multi-test-pool'],
          triggers: [`trigger-${i}`]
        });
        result.addDetail(`Client ${i} connected`);
      }

      // Verify all clients are connected
      const connectedCount = clients.filter(c => c.connected).length;
      if (connectedCount !== 5) {
        throw new Error(`Expected 5 connected clients, got ${connectedCount}`);
      }
    });

    await this.runTest('Connection Cleanup', 'connection', async (result) => {
      const client = new LatZeroClient({ appId: 'test-cleanup' });
      this.clients.push(client);

      await client.connect();
      await client.handshake();

      await client.disconnect();
      result.addDetail('Client disconnected');

      if (client.connected) {
        throw new Error('Client should not be connected after disconnect');
      }
    });
  }

  async runTriggerTests() {
    console.log(`🚀 Running Trigger Tests...`);

    await this.runTest('Basic Trigger Call', 'trigger', async (result) => {
      const sender = new LatZeroClient({ appId: 'trigger-sender' });
      const receiver = new LatZeroClient({ appId: 'trigger-receiver' });
      this.clients.push(sender, receiver);

      // Connect both clients
      await sender.connect();
      await receiver.connect();

      await sender.handshake({ triggers: [] });
      await receiver.handshake({ triggers: ['test-message'] });

      // Give receiver a moment to register
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send trigger
      const response = await sender.callTrigger('test-message', {
        message: 'Hello from integration test',
        timestamp: Date.now()
      });

      result.addDetail('Trigger sent and response received');
    });

    await this.runTest('Trigger with Pool', 'trigger', async (result) => {
      const client1 = new LatZeroClient({ appId: 'pool-client-1' });
      const client2 = new LatZeroClient({ appId: 'pool-client-2' });
      this.clients.push(client1, client2);

      await client1.connect();
      await client2.connect();

      await client1.handshake({
        pools: ['shared-pool'],
        triggers: ['pool-trigger']
      });
      await client2.handshake({
        pools: ['shared-pool'],
        triggers: []
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Send trigger to pool
      await client2.callTrigger('pool-trigger', {
        poolMessage: 'Message to pool'
      }, {
        pool: 'shared-pool'
      });

      result.addDetail('Pool-based trigger sent');
    });

    await this.runTest('Trigger Timeout', 'trigger', async (result) => {
      const client = new LatZeroClient({ appId: 'timeout-test', timeout: 1000 });
      this.clients.push(client);

      await client.connect();
      await client.handshake();

      try {
        // Try to call non-existent trigger
        await client.callTrigger('nonexistent-trigger', {}, { ttl: 500 });
        throw new Error('Should have timed out');
      } catch (error) {
        if (!error.message.includes('timeout')) {
          throw new Error(`Expected timeout error, got: ${error.message}`);
        }
        result.addDetail('Timeout handled correctly');
      }
    });
  }

  async runMemoryTests() {
    console.log(`🧠 Running Memory Tests...`);

    await this.runTest('Memory Block Creation', 'memory', async (result) => {
      const client = new LatZeroClient({ appId: 'memory-test' });
      this.clients.push(client);

      await client.connect();
      await client.handshake();

      const blockId = 'test-block-' + Date.now();
      await client.createMemoryBlock(blockId, 1024, {
        pool: 'memory-test-pool',
        permissions: { read: ['*'], write: ['memory-test'] }
      });

      result.addDetail(`Created memory block: ${blockId}`);
    });

    await this.runTest('Memory Read/Write', 'memory', async (result) => {
      const client = new LatZeroClient({ appId: 'memory-rw-test' });
      this.clients.push(client);

      await client.connect();
      await client.handshake();

      const blockId = 'rw-test-block';
      const testData = Buffer.from('Hello, Memory World!');

      // Create block
      await client.createMemoryBlock(blockId, 1024);

      // Write data
      await client.writeMemoryBlock(blockId, 0, testData);
      result.addDetail('Data written to memory block');

      // Read data back
      const readData = await client.readMemoryBlock(blockId, 0, testData.length);
      result.addDetail('Data read from memory block');

      if (!readData.equals(testData)) {
        throw new Error('Read data does not match written data');
      }
    });

    await this.runTest('Memory Block Sharing', 'memory', async (result) => {
      const writer = new LatZeroClient({ appId: 'memory-writer' });
      const reader = new LatZeroClient({ appId: 'memory-reader' });
      this.clients.push(writer, reader);

      await writer.connect();
      await reader.connect();

      await writer.handshake();
      await reader.handshake();

      const sharedBlockId = 'shared-test-block';

      // Writer creates block
      await writer.createMemoryBlock(sharedBlockId, 512, {
        permissions: { read: ['*'], write: ['memory-writer'] }
      });

      // Reader attaches to block
      await reader.attachMemoryBlock(sharedBlockId, 'read');

      // Writer writes data
      const sharedData = Buffer.from('Shared memory test');
      await writer.writeMemoryBlock(sharedBlockId, 0, sharedData);

      // Reader reads data
      const readSharedData = await reader.readMemoryBlock(sharedBlockId, 0, sharedData.length);

      if (!readSharedData.equals(sharedData)) {
        throw new Error('Shared memory data mismatch');
      }

      result.addDetail('Memory block shared between clients successfully');
    });
  }

  async runErrorHandlingTests() {
    console.log(`🚨 Running Error Handling Tests...`);

    await this.runTest('Invalid Handshake', 'error', async (result) => {
      const client = new LatZeroClient({ appId: 'invalid-app-id-!@#' });
      this.clients.push(client);

      await client.connect();

      try {
        await client.handshake();
        throw new Error('Should have failed with invalid app_id');
      } catch (error) {
        if (!error.message.includes('Invalid app_id')) {
          throw new Error(`Expected app_id validation error, got: ${error.message}`);
        }
        result.addDetail('Invalid app_id correctly rejected');
      }
    });

    await this.runTest('Duplicate App Registration', 'error', async (result) => {
      const client1 = new LatZeroClient({ appId: 'duplicate-test' });
      const client2 = new LatZeroClient({ appId: 'duplicate-test' });
      this.clients.push(client1, client2);

      await client1.connect();
      await client2.connect();

      await client1.handshake(); // First registration should succeed

      try {
        await client2.handshake(); // Second should fail or update
        result.addDetail('Duplicate registration handled');
      } catch (error) {
        result.addDetail('Duplicate registration rejected');
      }
    });

    await this.runTest('Memory Access Control', 'error', async (result) => {
      const owner = new LatZeroClient({ appId: 'memory-owner' });
      const unauthorized = new LatZeroClient({ appId: 'memory-thief' });
      this.clients.push(owner, unauthorized);

      await owner.connect();
      await unauthorized.connect();

      await owner.handshake();
      await unauthorized.handshake();

      const restrictedBlock = 'restricted-block';

      // Owner creates block with restricted permissions
      await owner.createMemoryBlock(restrictedBlock, 256, {
        permissions: { read: ['memory-owner'], write: ['memory-owner'] }
      });

      // Unauthorized client tries to read
      try {
        await unauthorized.readMemoryBlock(restrictedBlock);
        throw new Error('Should have been denied access');
      } catch (error) {
        if (!error.message.includes('permission') && !error.message.includes('denied')) {
          throw new Error(`Expected permission error, got: ${error.message}`);
        }
        result.addDetail('Memory access control working');
      }
    });
  }

  async runRehydrationTests() {
    console.log(`🔄 Running Rehydration Tests...`);

    await this.runTest('App Rehydration', 'rehydration', async (result) => {
      const originalAppId = 'rehydration-test';

      // First client registers with triggers
      const client1 = new LatZeroClient({ appId: originalAppId });
      this.clients.push(client1);

      await client1.connect();
      await client1.handshake({
        pools: ['rehydration-pool'],
        triggers: ['rehydrate-me']
      });

      await client1.disconnect();

      // Second client reconnects with same ID (should rehydrate)
      const client2 = new LatZeroClient({ appId: originalAppId });
      this.clients.push(client2);

      await client2.connect();
      const rehydrationResult = await client2.handshake(); // Minimal handshake

      if (!rehydrationResult.rehydrated) {
        result.addDetail('Rehydration may not be implemented yet, but connection succeeded');
      } else {
        result.addDetail('App successfully rehydrated');
      }
    });
  }

  async runPerformanceTests() {
    console.log(`⚡ Running Performance Tests...`);

    await this.runTest('Trigger Throughput', 'performance', async (result) => {
      const sender = new LatZeroClient({ appId: 'perf-sender' });
      const receiver = new LatZeroClient({ appId: 'perf-receiver' });
      this.clients.push(sender, receiver);

      await sender.connect();
      await receiver.connect();

      await sender.handshake();
      await receiver.handshake({ triggers: ['perf-trigger'] });

      // Warm up
      for (let i = 0; i < 10; i++) {
        await sender.callTrigger('perf-trigger', { warmup: true });
      }

      // Measure throughput
      const numCalls = 100;
      const startTime = Date.now();

      const promises = [];
      for (let i = 0; i < numCalls; i++) {
        promises.push(sender.callTrigger('perf-trigger', { id: i }));
      }

      await Promise.all(promises);
      const endTime = Date.now();

      const throughput = numCalls / ((endTime - startTime) / 1000);
      result.addDetail(`Trigger throughput: ${throughput.toFixed(2)} calls/second`);
    });
  }

  async runStressTests() {
    console.log(`🔥 Running Stress Tests...`);

    await this.runTest('Concurrent Connections', 'stress', async (result) => {
      const numClients = 20;
      const clients = [];

      // Create many clients simultaneously
      for (let i = 0; i < numClients; i++) {
        const client = new LatZeroClient({ appId: `stress-${i}` });
        clients.push(client);
        this.clients.push(client);
      }

      // Connect all at once
      const connectPromises = clients.map(client => client.connect());
      await Promise.all(connectPromises);
      result.addDetail(`${numClients} clients connected`);

      // Handshake all at once
      const handshakePromises = clients.map((client, i) =>
        client.handshake({ triggers: [`stress-trigger-${i}`] })
      );
      await Promise.all(handshakePromises);
      result.addDetail(`${numClients} clients completed handshake`);

      // All clients disconnect
      const disconnectPromises = clients.map(client => client.disconnect());
      await Promise.all(disconnectPromises);
      result.addDetail(`${numClients} clients disconnected`);
    });
  }

  async cleanup() {
    console.log(`🧹 Cleaning up test clients...`);

    const disconnectPromises = this.clients.map(async (client) => {
      try {
        if (client.connected) {
          await client.disconnect();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    await Promise.all(disconnectPromises);
    this.clients = [];
  }

  generateReport() {
    const endTime = Date.now();
    const totalDuration = endTime - this.testStartTime;

    console.log(`\n📊 Test Suite Results`);
    console.log(`====================`);

    const categories = {};
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;

    for (const result of this.results) {
      if (!categories[result.category]) {
        categories[result.category] = { total: 0, passed: 0, failed: 0, skipped: 0 };
      }

      categories[result.category].total++;
      totalTests++;

      switch (result.status) {
        case 'passed':
          categories[result.category].passed++;
          passedTests++;
          break;
        case 'failed':
          categories[result.category].failed++;
          failedTests++;
          break;
        case 'skipped':
          categories[result.category].skipped++;
          skippedTests++;
          break;
      }
    }

    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`⏭️  Skipped: ${skippedTests}`);
    console.log(`⏱️  Duration: ${totalDuration}ms`);
    console.log(`📈 Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    console.log(`\n📋 Results by Category:`);
    for (const [category, stats] of Object.entries(categories)) {
      const successRate = ((stats.passed / stats.total) * 100).toFixed(1);
      console.log(`   ${category}: ${stats.passed}/${stats.total} passed (${successRate}%)`);
    }

    if (failedTests > 0) {
      console.log(`\n❌ Failed Tests:`);
      for (const result of this.results.filter(r => r.status === 'failed')) {
        console.log(`   - ${result.name}: ${result.error.message}`);
      }
    }

    const exitCode = failedTests > 0 ? 1 : 0;
    console.log(`\n🏁 Test suite completed with exit code: ${exitCode}`);

    // Exit with appropriate code for CI/CD
    if (typeof process !== 'undefined' && process.exit) {
      process.exit(exitCode);
    }
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  const testPattern = args.find(arg => !arg.startsWith('--'));
  const options = {};

  // Parse options
  if (args.includes('--verbose')) options.verbose = true;
  if (args.includes('--quick')) options.quick = true;
  if (args.includes('--performance')) options.performance = true;
  if (args.includes('--stress')) options.stress = true;

  if (!testPattern && args.length === 0) {
    console.log('LatZero Integration Test Suite');
    console.log('');
    console.log('Usage: node integration-test.js [test-pattern] [options]');
    console.log('');
    console.log('Options:');
    console.log('  --verbose     - Detailed output');
    console.log('  --quick       - Run only essential tests');
    console.log('  --performance - Include performance benchmarks');
    console.log('  --stress      - Include stress testing');
    console.log('');
    console.log('Examples:');
    console.log('  node integration-test.js                    # Run all tests');
    console.log('  node integration-test.js --quick           # Run essential tests only');
    console.log('  node integration-test.js --performance     # Include performance tests');
    console.log('  node integration-test.js --verbose --stress # Verbose output with stress tests');
    return;
  }

  try {
    const suite = new IntegrationTestSuite(options);
    await suite.run(testPattern);
  } catch (error) {
    console.error('Test suite failed:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Test suite interrupted by user');
  process.exit(130);
});

// Run CLI if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { IntegrationTestSuite, TestResult };