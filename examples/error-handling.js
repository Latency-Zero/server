/**
 * LatZero Error Handling and Recovery Example
 *
 * This example demonstrates comprehensive error handling strategies and recovery
 * mechanisms for LatZero applications. It shows how to handle connection failures,
 * timeouts, invalid operations, and implement robust retry logic.
 *
 * Usage:
 *   node error-handling.js unreliable-client [error-type]
 *   node error-handling.js fault-tolerant-app
 *   node error-handling.js recovery-demo
 *   node error-handling.js stress-test
 *
 * Error scenarios demonstrated:
 * - Connection failures and reconnection
 * - Timeout handling and retries
 * - Invalid operations and validation
 * - Resource exhaustion and cleanup
 * - Circuit breaker patterns
 */

const { LatZeroClient } = require('./test-client');

class UnreliableClient {
  constructor(appId, errorType = 'random') {
    this.appId = appId;
    this.errorType = errorType;
    this.client = new LatZeroClient({ appId, timeout: 5000 });
    this.errorCount = 0;
    this.successCount = 0;
    this.isRunning = true;
  }

  async start() {
    console.log(`🎲 Starting Unreliable Client: ${this.appId} (error type: ${this.errorType})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['error-test-pool'],
        triggers: ['test-trigger'],
        metadata: { role: 'unreliable-client', errorType: this.errorType }
      });

      console.log(`✅ Unreliable Client ${this.appId} connected`);

      // Simulate operations that may fail
      const operationInterval = setInterval(async () => {
        if (!this.isRunning) return;

        try {
          await this.performUnreliableOperation();
          this.successCount++;
        } catch (error) {
          this.errorCount++;
          console.log(`❌ Operation failed (${this.errorCount}): ${error.message}`);
        }
      }, 2000);

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 15000));
      clearInterval(operationInterval);
      this.isRunning = false;

      console.log(`🎲 Unreliable Client ${this.appId} finished`);
      console.log(`📊 Success: ${this.successCount}, Errors: ${this.errorCount}`);
    } catch (error) {
      console.error(`❌ Unreliable Client ${this.appId} startup error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  async performUnreliableOperation() {
    switch (this.errorType) {
      case 'connection':
        // Simulate connection failures
        if (Math.random() < 0.3) {
          throw new Error('Simulated connection failure');
        }
        await this.client.callTrigger('test-trigger', { type: 'connection-test' });
        break;

      case 'timeout':
        // Simulate timeouts
        if (Math.random() < 0.4) {
          await new Promise(resolve => setTimeout(resolve, 6000)); // Exceed timeout
          throw new Error('Simulated timeout');
        }
        await this.client.callTrigger('test-trigger', { type: 'timeout-test' });
        break;

      case 'invalid-data':
        // Simulate invalid data
        if (Math.random() < 0.3) {
          await this.client.callTrigger('', {}); // Invalid trigger name
        } else {
          await this.client.callTrigger('test-trigger', { type: 'invalid-data-test' });
        }
        break;

      case 'memory':
        // Simulate memory operation failures
        if (Math.random() < 0.3) {
          await this.client.readMemoryBlock('nonexistent-block');
        } else {
          await this.client.callTrigger('test-trigger', { type: 'memory-test' });
        }
        break;

      case 'random':
      default:
        // Random mix of errors
        const errorTypes = ['connection', 'timeout', 'invalid-data', 'memory'];
        const randomError = errorTypes[Math.floor(Math.random() * errorTypes.length)];
        await this.performSpecificError(randomError);
        break;
    }
  }

  async performSpecificError(errorType) {
    // Delegate to specific error simulation
    const tempClient = new UnreliableClient(`${this.appId}-temp`, errorType);
    tempClient.client = this.client; // Use same client
    await tempClient.performUnreliableOperation();
  }

  stop() {
    this.isRunning = false;
  }
}

class FaultTolerantApp {
  constructor(appId) {
    this.appId = appId;
    this.client = null;
    this.isRunning = true;
    this.retryConfig = {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2
    };
    this.circuitBreaker = {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      lastFailureTime: 0,
      timeout: 60000, // 1 minute
      failureThreshold: 5
    };
    this.stats = {
      operations: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      reconnects: 0
    };
  }

  async start() {
    console.log(`🛡️  Starting Fault Tolerant App: ${this.appId}`);

    // Start with connection
    await this.ensureConnection();

    // Main operation loop with error handling
    while (this.isRunning) {
      try {
        await this.performOperationWithRetry();
        this.stats.operations++;
        this.stats.successes++;

        // Reset circuit breaker on success
        if (this.circuitBreaker.state === 'half-open') {
          this.circuitBreaker.state = 'closed';
          this.circuitBreaker.failureCount = 0;
          console.log(`🔄 Circuit breaker reset to closed`);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        this.stats.failures++;
        console.log(`❌ Operation failed: ${error.message}`);

        // Update circuit breaker
        this.updateCircuitBreaker(error);

        // Check if we should retry connection
        if (error.message.includes('disconnected') || error.message.includes('connection')) {
          await this.handleConnectionFailure();
        }
      }
    }

    console.log(`🛡️  Fault Tolerant App ${this.appId} finished`);
    console.log(`📊 Final Stats:`, this.stats);
  }

  async ensureConnection() {
    if (!this.client || !this.client.connected) {
      try {
        this.client = new LatZeroClient({
          appId: this.appId,
          timeout: 10000,
          reconnect: true
        });

        await this.client.connect();
        await this.client.handshake({
          pools: ['fault-tolerant-pool'],
          triggers: ['fault-test-trigger'],
          metadata: { role: 'fault-tolerant', retryConfig: this.retryConfig }
        });

        this.stats.reconnects++;
        console.log(`🔄 Reconnected (${this.stats.reconnects} total)`);
      } catch (error) {
        console.error(`❌ Connection failed: ${error.message}`);
        throw error;
      }
    }
  }

  async performOperationWithRetry() {
    return await this.retry(async () => {
      if (this.circuitBreaker.state === 'open') {
        throw new Error('Circuit breaker is open');
      }

      await this.ensureConnection();

      // Simulate various operations that might fail
      const operationType = Math.random();
      if (operationType < 0.4) {
        // Trigger operation
        await this.client.callTrigger('fault-test-trigger', {
          operation: 'trigger-test',
          timestamp: Date.now()
        });
      } else if (operationType < 0.7) {
        // Memory operation
        try {
          await this.client.readMemoryBlock('test-block');
        } catch {
          // Block might not exist, that's ok for this test
        }
      } else {
        // Mixed operation
        await this.client.callTrigger('fault-test-trigger', {
          operation: 'mixed-test',
          data: 'test payload'
        });
      }
    });
  }

  async retry(operation) {
    let lastError;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffFactor, attempt),
            this.retryConfig.maxDelay
          );

          this.stats.retries++;
          console.log(`⏳ Retry ${attempt + 1}/${this.retryConfig.maxRetries} in ${delay}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  updateCircuitBreaker(error) {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failureCount >= this.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'open';
      console.log(`🚫 Circuit breaker opened (${this.circuitBreaker.failureCount} failures)`);
    }
  }

  async handleConnectionFailure() {
    console.log(`🔌 Connection failure detected, attempting recovery...`);

    // Close existing connection
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }

    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Attempt reconnection
    try {
      await this.ensureConnection();
      console.log(`✅ Connection recovered`);
    } catch (error) {
      console.error(`❌ Connection recovery failed: ${error.message}`);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.client) {
      this.client.disconnect();
    }
  }
}

class RecoveryDemo {
  constructor() {
    this.unreliableClients = [];
    this.faultTolerantApps = [];
  }

  async run() {
    console.log(`🚀 Starting Error Handling and Recovery Demo`);
    console.log(`=============================================`);

    try {
      // Start unreliable clients to generate errors
      const errorTypes = ['connection', 'timeout', 'invalid-data', 'memory'];
      const unreliablePromises = [];

      for (let i = 0; i < errorTypes.length; i++) {
        const client = new UnreliableClient(`unreliable-${i + 1}`, errorTypes[i]);
        this.unreliableClients.push(client);
        unreliablePromises.push(client.start());
      }

      // Start fault-tolerant applications
      const faultTolerantPromises = [];
      for (let i = 0; i < 2; i++) {
        const app = new FaultTolerantApp(`fault-tolerant-${i + 1}`);
        this.faultTolerantApps.push(app);
        faultTolerantPromises.push(app.start());
      }

      // Let everything run for demo duration
      await new Promise(resolve => setTimeout(resolve, 20000));

      // Stop all components
      this.unreliableClients.forEach(c => c.stop());
      this.faultTolerantApps.forEach(a => a.stop());

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log(`✅ Error Handling and Recovery Demo completed`);
      console.log(`📊 Demo Summary:`);
      console.log(`   - Unreliable Clients: ${this.unreliableClients.length}`);
      console.log(`   - Fault Tolerant Apps: ${this.faultTolerantApps.length}`);

    } catch (error) {
      console.error(`❌ Demo failed:`, error.message);
    }
  }
}

class StressTest {
  constructor() {
    this.clients = [];
    this.errors = [];
    this.startTime = Date.now();
  }

  async run() {
    console.log(`🔥 Starting Error Handling Stress Test`);
    console.log(`======================================`);

    const numClients = 10;
    const testDuration = 30000; // 30 seconds

    try {
      // Start multiple clients simultaneously
      const clientPromises = [];
      for (let i = 0; i < numClients; i++) {
        const client = new UnreliableClient(`stress-client-${i + 1}`, 'random');
        this.clients.push(client);
        clientPromises.push(client.start());
      }

      // Run stress test
      console.log(`🔥 Running stress test with ${numClients} clients for ${testDuration/1000}s...`);

      // Monitor progress
      const monitorInterval = setInterval(() => {
        const elapsed = Date.now() - this.startTime;
        const totalErrors = this.clients.reduce((sum, c) => sum + c.errorCount, 0);
        const totalSuccesses = this.clients.reduce((sum, c) => sum + c.successCount, 0);

        console.log(`📊 Stress Test Progress (${Math.floor(elapsed/1000)}s): ${totalSuccesses} successes, ${totalErrors} errors`);
      }, 5000);

      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, testDuration));
      clearInterval(monitorInterval);

      // Stop all clients
      this.clients.forEach(c => c.stop());

      // Collect final statistics
      const finalStats = this.clients.map((c, i) => ({
        client: i + 1,
        successes: c.successCount,
        errors: c.errorCount,
        successRate: c.successCount / (c.successCount + c.errorCount) * 100
      }));

      console.log(`✅ Stress test completed`);
      console.log(`📊 Final Results:`);
      finalStats.forEach(stat => {
        console.log(`   Client ${stat.client}: ${stat.successes}✓ ${stat.errors}✗ (${stat.successRate.toFixed(1)}% success)`);
      });

      const totalSuccesses = finalStats.reduce((sum, s) => sum + s.successes, 0);
      const totalErrors = finalStats.reduce((sum, s) => sum + s.errors, 0);
      const overallSuccessRate = totalSuccesses / (totalSuccesses + totalErrors) * 100;

      console.log(`📊 Overall: ${totalSuccesses} successes, ${totalErrors} errors (${overallSuccessRate.toFixed(1)}% success rate)`);

    } catch (error) {
      console.error(`❌ Stress test failed:`, error.message);
    }
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('LatZero Error Handling and Recovery Example');
    console.log('');
    console.log('Usage:');
    console.log('  node error-handling.js unreliable-client [error-type]');
    console.log('  node error-handling.js fault-tolerant-app');
    console.log('  node error-handling.js recovery-demo');
    console.log('  node error-handling.js stress-test');
    console.log('');
    console.log('Error Types:');
    console.log('  connection   - Connection failures');
    console.log('  timeout      - Operation timeouts');
    console.log('  invalid-data - Invalid operations/data');
    console.log('  memory       - Memory operation failures');
    console.log('  random       - Mix of all error types');
    console.log('');
    console.log('Examples:');
    console.log('  node error-handling.js unreliable-client timeout');
    console.log('  node error-handling.js fault-tolerant-app');
    console.log('  node error-handling.js recovery-demo');
    console.log('  node error-handling.js stress-test');
    return;
  }

  try {
    switch (command) {
      case 'unreliable-client':
        const errorType = args[1] || 'random';
        const unreliableClient = new UnreliableClient(`unreliable-${Date.now()}`, errorType);
        await unreliableClient.start();
        break;

      case 'fault-tolerant-app':
        const faultTolerantApp = new FaultTolerantApp(`fault-tolerant-${Date.now()}`);
        await faultTolerantApp.start();
        break;

      case 'recovery-demo':
        const recoveryDemo = new RecoveryDemo();
        await recoveryDemo.run();
        break;

      case 'stress-test':
        const stressTest = new StressTest();
        await stressTest.run();
        break;

      default:
        console.log(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

// Run CLI if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { UnreliableClient, FaultTolerantApp, RecoveryDemo, StressTest };