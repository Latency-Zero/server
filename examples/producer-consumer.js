/**
 * LatZero Producer-Consumer Pattern Example
 *
 * This example demonstrates a classic producer-consumer pattern using LatZero triggers.
 * Multiple producer processes generate work items, while consumer processes handle
 * the work asynchronously through trigger calls.
 *
 * Usage:
 *   node producer-consumer.js producer [num-items]
 *   node producer-consumer.js consumer [worker-id]
 *   node producer-consumer.js demo
 *
 * The demo mode runs both producers and consumers simultaneously.
 */

const { LatZeroClient } = require('./test-client');

class Producer {
  constructor(appId, numItems = 10) {
    this.appId = appId;
    this.numItems = numItems;
    this.client = new LatZeroClient({ appId });
  }

  async start() {
    console.log(`🏭 Starting Producer: ${this.appId}`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['work-pool'],
        triggers: [], // Producers don't register triggers
        metadata: { role: 'producer', capacity: this.numItems }
      });

      console.log(`✅ Producer ${this.appId} connected and ready`);

      // Produce work items
      for (let i = 0; i < this.numItems; i++) {
        const workItem = {
          id: `${this.appId}-item-${i}`,
          data: `Work item ${i} from ${this.appId}`,
          priority: Math.floor(Math.random() * 10),
          timestamp: Date.now()
        };

        try {
          console.log(`📤 Producing work item: ${workItem.id}`);
          await this.client.callTrigger('process-work', workItem, {
            pool: 'work-pool',
            ttl: 30000
          });
          console.log(`✅ Work item ${workItem.id} sent successfully`);

          // Small delay between items
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`❌ Failed to send work item ${workItem.id}:`, error.message);
        }
      }

      console.log(`🏭 Producer ${this.appId} finished producing ${this.numItems} items`);
    } catch (error) {
      console.error(`❌ Producer ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }
}

class Consumer {
  constructor(appId, workerId = 1) {
    this.appId = appId;
    this.workerId = workerId;
    this.client = new LatZeroClient({ appId });
    this.processedCount = 0;
    this.isRunning = true;
  }

  async start() {
    console.log(`👷 Starting Consumer: ${this.appId} (Worker ${this.workerId})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['work-pool'],
        triggers: ['process-work'], // Consumers register for work
        metadata: { role: 'consumer', workerId: this.workerId }
      });

      console.log(`✅ Consumer ${this.appId} connected and listening for work`);

      // In a real implementation, consumers would run indefinitely
      // For this demo, we'll simulate processing for a limited time
      const startTime = Date.now();
      const runDuration = 30000; // 30 seconds

      while (this.isRunning && (Date.now() - startTime) < runDuration) {
        // In the real trigger system, work would come via incoming trigger calls
        // For this demo, we'll simulate waiting for work
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if we should simulate processing work
        if (Math.random() < 0.3) { // 30% chance every second
          this.simulateWorkProcessing();
        }
      }

      console.log(`👷 Consumer ${this.appId} finished. Processed: ${this.processedCount} items`);
    } catch (error) {
      console.error(`❌ Consumer ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  simulateWorkProcessing() {
    // In a real system, this would be triggered by incoming work items
    // For demo purposes, we'll simulate receiving and processing work
    this.processedCount++;
    const workItem = {
      id: `simulated-work-${this.processedCount}`,
      data: `Simulated work item ${this.processedCount}`,
      priority: Math.floor(Math.random() * 10)
    };

    console.log(`⚙️  Processing work item: ${workItem.id} (priority: ${workItem.priority})`);

    // Simulate processing time based on priority
    const processingTime = (11 - workItem.priority) * 100; // Higher priority = faster processing
    setTimeout(() => {
      console.log(`✅ Completed work item: ${workItem.id}`);
    }, processingTime);
  }

  stop() {
    this.isRunning = false;
  }
}

class WorkQueue {
  constructor() {
    this.client = new LatZeroClient({ appId: 'work-queue' });
    this.queue = [];
    this.isRunning = true;
  }

  async start() {
    console.log(`📋 Starting Work Queue Manager`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['work-pool'],
        triggers: ['process-work'], // Queue receives all work submissions
        metadata: { role: 'queue-manager' }
      });

      console.log(`✅ Work Queue connected and managing work distribution`);

      // In a real implementation, this would manage work distribution
      // For demo purposes, we'll show queue statistics
      const statsInterval = setInterval(() => {
        if (!this.isRunning) {
          clearInterval(statsInterval);
          return;
        }
        console.log(`📊 Queue Status: ${this.queue.length} items pending`);
      }, 5000);

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 15000));
      this.isRunning = false;

      console.log(`📋 Work Queue finished. Total items processed: ${this.queue.length}`);
    } catch (error) {
      console.error(`❌ Work Queue error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  stop() {
    this.isRunning = false;
  }
}

class ProducerConsumerDemo {
  constructor() {
    this.producers = [];
    this.consumers = [];
    this.queue = null;
  }

  async run() {
    console.log(`🚀 Starting Producer-Consumer Demo`);
    console.log(`=====================================`);

    try {
      // Start work queue
      this.queue = new WorkQueue();
      const queuePromise = this.queue.start();

      // Small delay to ensure queue is ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start multiple producers
      const numProducers = 2;
      for (let i = 0; i < numProducers; i++) {
        const producer = new Producer(`producer-${i + 1}`, 5); // 5 items each
        this.producers.push(producer);
        producer.start();
      }

      // Start multiple consumers
      const numConsumers = 3;
      const consumerPromises = [];
      for (let i = 0; i < numConsumers; i++) {
        const consumer = new Consumer(`consumer-${i + 1}`, i + 1);
        this.consumers.push(consumer);
        consumerPromises.push(consumer.start());
      }

      // Wait for all producers to complete
      await Promise.all(this.producers.map(p => p.start()));

      // Let consumers run a bit longer to process remaining work
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Stop consumers
      this.consumers.forEach(c => c.stop());

      // Wait for consumers to finish
      await Promise.all(consumerPromises);

      // Stop queue
      this.queue.stop();
      await queuePromise;

      console.log(`✅ Producer-Consumer Demo completed successfully`);

    } catch (error) {
      console.error(`❌ Demo failed:`, error.message);
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
    console.log('LatZero Producer-Consumer Example');
    console.log('');
    console.log('Usage:');
    console.log('  node producer-consumer.js producer [num-items]');
    console.log('  node producer-consumer.js consumer [worker-id]');
    console.log('  node producer-consumer.js queue');
    console.log('  node producer-consumer.js demo');
    console.log('');
    console.log('Examples:');
    console.log('  node producer-consumer.js producer 10    # Produce 10 work items');
    console.log('  node producer-consumer.js consumer 1     # Start consumer worker 1');
    console.log('  node producer-consumer.js demo           # Run full demo');
    return;
  }

  try {
    switch (command) {
      case 'producer':
        const numItems = parseInt(args[1]) || 10;
        const producer = new Producer(`producer-${Date.now()}`, numItems);
        await producer.start();
        break;

      case 'consumer':
        const workerId = parseInt(args[1]) || 1;
        const consumer = new Consumer(`consumer-${Date.now()}`, workerId);
        await consumer.start();
        break;

      case 'queue':
        const queue = new WorkQueue();
        await queue.start();
        break;

      case 'demo':
        const demo = new ProducerConsumerDemo();
        await demo.run();
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

module.exports = { Producer, Consumer, WorkQueue, ProducerConsumerDemo };