/**
 * LatZero Memory Block Sharing Example
 *
 * This example demonstrates inter-process memory sharing using LatZero memory blocks.
 * Multiple processes can create, attach to, and manipulate shared memory regions
 * for high-performance data exchange.
 *
 * Usage:
 *   node memory-sharing.js writer [block-id] [data-size]
 *   node memory-sharing.js reader [block-id]
 *   node memory-sharing.js monitor [block-id]
 *   node memory-sharing.js demo
 *
 * Features demonstrated:
 * - Memory block creation with different permissions
 * - Concurrent read/write operations
 * - Memory pool management
 * - Data serialization strategies
 */

const { LatZeroClient } = require('./test-client');

class MemoryWriter {
  constructor(appId, blockId = 'shared-data', dataSize = 1024) {
    this.appId = appId;
    this.blockId = blockId;
    this.dataSize = dataSize;
    this.client = new LatZeroClient({ appId });
    this.writeCount = 0;
  }

  async start() {
    console.log(`✏️  Starting Memory Writer: ${this.appId} (block: ${this.blockId})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['memory-pool'],
        triggers: ['memory-updated'], // Notify readers of updates
        metadata: { role: 'writer', blockId: this.blockId }
      });

      // Create or attach to memory block
      try {
        await this.client.createMemoryBlock(this.blockId, this.dataSize, {
          pool: 'memory-pool',
          permissions: {
            read: ['*'],  // Allow anyone to read
            write: [this.appId]  // Only this writer can write
          },
          persistent: true
        });
        console.log(`✅ Created memory block: ${this.blockId} (${this.dataSize} bytes)`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`📎 Attaching to existing memory block: ${this.blockId}`);
          await this.client.attachMemoryBlock(this.blockId, 'write');
        } else {
          throw error;
        }
      }

      // Write data continuously
      const writeInterval = setInterval(async () => {
        try {
          const timestamp = Date.now();
          const data = this.generateData(timestamp);

          await this.client.writeMemoryBlock(this.blockId, 0, data);
          this.writeCount++;

          // Notify readers of the update
          await this.client.callTrigger('memory-updated', {
            blockId: this.blockId,
            writer: this.appId,
            timestamp: timestamp,
            size: data.length
          }, {
            pool: 'memory-pool'
          });

          console.log(`📤 Wrote ${data.length} bytes to ${this.blockId} (total: ${this.writeCount})`);
        } catch (error) {
          console.error(`❌ Write error:`, error.message);
          clearInterval(writeInterval);
        }
      }, 2000); // Write every 2 seconds

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 20000));
      clearInterval(writeInterval);

      console.log(`✏️  Memory Writer ${this.appId} finished. Total writes: ${this.writeCount}`);
    } catch (error) {
      console.error(`❌ Memory Writer ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  generateData(timestamp) {
    // Generate different types of test data
    const dataTypes = ['json', 'binary', 'text'];

    switch (dataTypes[this.writeCount % dataTypes.length]) {
      case 'json':
        const jsonData = {
          timestamp,
          writer: this.appId,
          sequence: this.writeCount,
          data: Array.from({ length: 10 }, (_, i) => Math.random())
        };
        return Buffer.from(JSON.stringify(jsonData));

      case 'binary':
        const binaryData = Buffer.alloc(Math.min(256, this.dataSize));
        for (let i = 0; i < binaryData.length; i++) {
          binaryData[i] = Math.floor(Math.random() * 256);
        }
        return binaryData;

      case 'text':
        const textData = `Memory block update #${this.writeCount} from ${this.appId} at ${new Date(timestamp).toISOString()}\n`;
        return Buffer.from(textData.repeat(Math.floor(this.dataSize / textData.length) || 1));

      default:
        return Buffer.from(`Default data ${this.writeCount}`);
    }
  }
}

class MemoryReader {
  constructor(appId, blockId = 'shared-data') {
    this.appId = appId;
    this.blockId = blockId;
    this.client = new LatZeroClient({ appId });
    this.readCount = 0;
    this.lastUpdate = 0;
  }

  async start() {
    console.log(`📖 Starting Memory Reader: ${this.appId} (block: ${this.blockId})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['memory-pool'],
        triggers: [], // Readers don't expose triggers
        metadata: { role: 'reader', blockId: this.blockId }
      });

      // Attach to memory block
      await this.client.attachMemoryBlock(this.blockId, 'read');
      console.log(`✅ Attached to memory block: ${this.blockId}`);

      // Read data periodically
      const readInterval = setInterval(async () => {
        try {
          const data = await this.client.readMemoryBlock(this.blockId, 0, null);
          this.readCount++;

          // Only log if data has changed
          if (data.length !== this.lastUpdate) {
            console.log(`📥 Read ${data.length} bytes from ${this.blockId} (total reads: ${this.readCount})`);
            this.displayData(data);
            this.lastUpdate = data.length;
          }
        } catch (error) {
          console.error(`❌ Read error:`, error.message);
          clearInterval(readInterval);
        }
      }, 1000); // Read every second

      // Also listen for update notifications
      // In a real implementation, this would be handled by the trigger system

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 25000));
      clearInterval(readInterval);

      console.log(`📖 Memory Reader ${this.appId} finished. Total reads: ${this.readCount}`);
    } catch (error) {
      console.error(`❌ Memory Reader ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  displayData(data) {
    try {
      // Try to parse as JSON first
      const text = data.toString();
      try {
        const jsonData = JSON.parse(text);
        console.log(`  📄 JSON Data:`, JSON.stringify(jsonData, null, 2));
      } catch {
        // Not JSON, show as text or binary
        if (text.length < 200) {
          console.log(`  📄 Text Data: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
        } else {
          console.log(`  📄 Binary Data: ${data.length} bytes`);
          console.log(`  📄 First 32 bytes: ${data.slice(0, 32).toString('hex')}`);
        }
      }
    } catch (error) {
      console.log(`  📄 Raw Data: ${data.length} bytes`);
    }
  }
}

class MemoryMonitor {
  constructor(appId, blockId = 'shared-data') {
    this.appId = appId;
    this.blockId = blockId;
    this.client = new LatZeroClient({ appId });
    this.stats = {
      reads: 0,
      writes: 0,
      errors: 0,
      startTime: Date.now()
    };
  }

  async start() {
    console.log(`📊 Starting Memory Monitor: ${this.appId} (block: ${this.blockId})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['memory-pool'],
        triggers: ['memory-updated'], // Listen for update notifications
        metadata: { role: 'monitor', blockId: this.blockId }
      });

      // Get initial block info
      try {
        const blockInfo = await this.client.getMemoryBlock(this.blockId);
        console.log(`📊 Monitoring block: ${this.blockId}`);
        console.log(`📊 Block size: ${blockInfo.size} bytes`);
        console.log(`📊 Block type: ${blockInfo.type}`);
        console.log(`📊 Created: ${new Date(blockInfo.created).toISOString()}`);
      } catch (error) {
        console.log(`⚠️  Block ${this.blockId} not found, will monitor when created`);
      }

      // Monitor statistics
      const statsInterval = setInterval(() => {
        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        console.log(`📊 Stats (${uptime}s): Reads: ${this.stats.reads}, Writes: ${this.stats.writes}, Errors: ${this.stats.errors}`);
      }, 5000);

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 30000));
      clearInterval(statsInterval);

      console.log(`📊 Memory Monitor ${this.appId} finished`);
      console.log(`📊 Final Stats:`, this.stats);
    } catch (error) {
      console.error(`❌ Memory Monitor ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }
}

class MemorySharingDemo {
  constructor() {
    this.writers = [];
    this.readers = [];
    this.monitors = [];
  }

  async run() {
    console.log(`🚀 Starting Memory Sharing Demo`);
    console.log(`================================`);

    const blockId = `demo-block-${Date.now()}`;

    try {
      // Start monitor first
      const monitor = new MemoryMonitor('monitor-1', blockId);
      this.monitors.push(monitor);
      const monitorPromise = monitor.start();

      // Small delay for monitor to initialize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Start writers
      const numWriters = 2;
      const writerPromises = [];
      for (let i = 0; i < numWriters; i++) {
        const writer = new MemoryWriter(`writer-${i + 1}`, blockId, 2048);
        this.writers.push(writer);
        writerPromises.push(writer.start());
      }

      // Start readers after writers have started
      await new Promise(resolve => setTimeout(resolve, 2000));

      const numReaders = 3;
      const readerPromises = [];
      for (let i = 0; i < numReaders; i++) {
        const reader = new MemoryReader(`reader-${i + 1}`, blockId);
        this.readers.push(reader);
        readerPromises.push(reader.start());
      }

      // Wait for all writers to complete
      await Promise.all(writerPromises);

      // Let readers finish
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Stop readers (in real implementation, they'd run indefinitely)
      // For demo, we just wait for them to finish

      // Wait for monitor to finish
      await monitorPromise;

      console.log(`✅ Memory Sharing Demo completed successfully`);
      console.log(`📊 Demo Summary:`);
      console.log(`   - Block ID: ${blockId}`);
      console.log(`   - Writers: ${numWriters}`);
      console.log(`   - Readers: ${numReaders}`);
      console.log(`   - Monitors: 1`);

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
    console.log('LatZero Memory Sharing Example');
    console.log('');
    console.log('Usage:');
    console.log('  node memory-sharing.js writer [block-id] [data-size]');
    console.log('  node memory-sharing.js reader [block-id]');
    console.log('  node memory-sharing.js monitor [block-id]');
    console.log('  node memory-sharing.js demo');
    console.log('');
    console.log('Examples:');
    console.log('  node memory-sharing.js writer shared-data 1024');
    console.log('  node memory-sharing.js reader shared-data');
    console.log('  node memory-sharing.js monitor shared-data');
    console.log('  node memory-sharing.js demo');
    return;
  }

  try {
    switch (command) {
      case 'writer':
        const blockId = args[1] || 'shared-data';
        const dataSize = parseInt(args[2]) || 1024;
        const writer = new MemoryWriter(`writer-${Date.now()}`, blockId, dataSize);
        await writer.start();
        break;

      case 'reader':
        const readBlockId = args[1] || 'shared-data';
        const reader = new MemoryReader(`reader-${Date.now()}`, readBlockId);
        await reader.start();
        break;

      case 'monitor':
        const monitorBlockId = args[1] || 'shared-data';
        const monitor = new MemoryMonitor(`monitor-${Date.now()}`, monitorBlockId);
        await monitor.start();
        break;

      case 'demo':
        const demo = new MemorySharingDemo();
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

module.exports = { MemoryWriter, MemoryReader, MemoryMonitor, MemorySharingDemo };