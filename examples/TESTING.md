# LatZero Testing Guide

This comprehensive guide provides detailed instructions for testing all LatZero server functionality using the provided test client and example scripts.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Basic Connection Testing](#basic-connection-testing)
- [Trigger Registration and Calling](#trigger-registration-and-calling)
- [Memory Block Operations](#memory-block-operations)
- [Error Handling Scenarios](#error-handling-scenarios)
- [Troubleshooting](#troubleshooting)
- [Performance Testing](#performance-testing)
- [Example Scripts](#example-scripts)

## Prerequisites

### Server Setup

1. **Node.js Installation**: Ensure Node.js 14+ is installed
   ```bash
   node --version  # Should show v14.0.0 or higher
   ```

2. **Start the LatZero Server**:
   ```bash
   cd latzero/server
   node index.js start
   ```

   The server will start on `localhost:45227` by default. You should see:
   ```
   🚀 Initializing LatZero Server...
   🌟 LatZero Server running on localhost:45227
   📁 Data directory: /home/user/.latzero
   ```

3. **Verify Server is Running**:
   ```bash
   # Check if port 45227 is listening
   netstat -tlnp | grep 45227
   # or
   lsof -i :45227
   ```

### Test Client Setup

The test client is located at `latzero/examples/test-client.js` and provides both CLI and programmatic interfaces.

## Quick Start

### Basic Connection Test

```bash
# Test basic handshake
node latzero/examples/test-client.js handshake my-test-app

# Expected output:
# 🔗 Connecting to localhost:45227 as my-test-app...
# ✅ Connected to server
# 🤝 Performing handshake as my-test-app...
# ✅ Handshake successful
```

### Interactive Testing

```bash
# Start interactive mode for manual testing
node latzero/examples/test-client.js interactive

# Interactive commands:
# > handshake  # (already done automatically)
# > trigger echo '{"message": "hello world"}'
# > memory create myblock 1024
# > memory write myblock 0 "Hello World"
# > memory read myblock 0 11
# > quit
```

## Basic Connection Testing

### Handshake Protocol

The handshake establishes the connection and registers the application:

```javascript
const { LatZeroClient } = require('./test-client');

const client = new LatZeroClient({
  appId: 'test-app-1',
  host: 'localhost',
  port: 45227
});

await client.connect();
const handshakeResult = await client.handshake({
  pools: ['default'],
  triggers: ['echo', 'process-data'],
  metadata: { version: '1.0.0' }
});
console.log('Handshake successful:', handshakeResult);
```

### Connection States

- **Connected**: Socket established
- **Registered**: Handshake completed, app registered
- **Disconnected**: Connection lost, may attempt rehydration

### Rehydration Testing

Test automatic reconnection with persisted state:

```bash
# First connection with triggers
node test-client.js handshake app1 trigger1 trigger2

# Disconnect (Ctrl+C), then reconnect with same app ID
node test-client.js handshake app1

# Server should recognize app1 and restore trigger registrations
```

## Trigger Registration and Calling

### Trigger Registration

Triggers are registered during handshake:

```javascript
// Register triggers during handshake
await client.handshake({
  triggers: ['echo', 'process-data', 'calculate-sum']
});
```

### Trigger Calling

Call triggers on other registered applications:

```javascript
// Call a trigger
const result = await client.callTrigger('echo', {
  message: 'Hello from test client',
  timestamp: Date.now()
});
console.log('Trigger result:', result);
```

### Trigger Routing

Triggers can be routed to specific destinations:

```javascript
// Call trigger with explicit destination
await client.callTrigger('process-data', payload, {
  destination: 'worker-app-1',
  pool: 'processing-pool',
  ttl: 60000  // 60 second timeout
});
```

### Trigger Patterns

#### Producer-Consumer Pattern

```javascript
// Producer app
const producer = new LatZeroClient({ appId: 'producer' });
await producer.connect();
await producer.handshake({ triggers: [] }); // No triggers, only calls

// Consumer app
const consumer = new LatZeroClient({ appId: 'consumer' });
await consumer.connect();
await consumer.handshake({ triggers: ['process-task'] });

// Producer calls consumer's trigger
await producer.callTrigger('process-task', { task: 'data-processing' });
```

#### Request-Response Pattern

```javascript
// Client makes request
const response = await client.callTrigger('calculate', {
  operation: 'add',
  numbers: [1, 2, 3, 4, 5]
});

// Response contains result
console.log('Sum:', response.result); // 15
```

## Memory Block Operations

### Creating Memory Blocks

```javascript
// Create a shared memory block
await client.createMemoryBlock('shared-data', 4096, {
  type: 'shared',
  pool: 'data-pool',
  permissions: {
    read: ['*'],  // Allow all apps to read
    write: ['admin-app']  // Only admin can write
  }
});
```

### Attaching to Memory Blocks

```javascript
// Attach to existing memory block
await client.attachMemoryBlock('shared-data', 'read');
```

### Reading and Writing Data

```javascript
// Write data to memory block
const data = Buffer.from('Hello, shared world!');
await client.writeMemoryBlock('shared-data', 0, data);

// Read data from memory block
const readData = await client.readMemoryBlock('shared-data', 0, data.length);
console.log('Read:', readData.toString()); // "Hello, shared world!"
```

### Memory Block Types

- **shared**: Traditional shared memory
- **binary**: Binary data storage
- **json**: JSON-serialized objects
- **stream**: Streaming data

### Memory Pool Management

```javascript
// Create memory pool
await client.createMemoryBlock('pool-data', 1024 * 1024, {
  pool: 'large-data-pool',
  persistent: true,  // Survive server restarts
  encrypted: false
});
```

## Error Handling Scenarios

### Connection Errors

```javascript
try {
  await client.connect();
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    console.log('Server not running on specified port');
  } else if (error.code === 'ENOTFOUND') {
    console.log('Host not found');
  }
}
```

### Handshake Failures

```javascript
try {
  await client.handshake({ appId: 'invalid app id' });
} catch (error) {
  console.log('Handshake failed:', error.message);
  // Common errors: invalid app_id format, duplicate registration
}
```

### Trigger Errors

```javascript
try {
  await client.callTrigger('nonexistent-trigger', payload);
} catch (error) {
  console.log('Trigger failed:', error.message);
  // Common errors: trigger not found, destination unavailable, timeout
}
```

### Memory Operation Errors

```javascript
try {
  await client.readMemoryBlock('nonexistent-block');
} catch (error) {
  console.log('Memory operation failed:', error.message);
  // Common errors: block not found, permission denied, out of bounds
}
```

### Timeout Handling

```javascript
// Set custom timeout
const client = new LatZeroClient({
  timeout: 10000  // 10 seconds
});

try {
  await client.callTrigger('slow-operation', payload);
} catch (error) {
  if (error.message.includes('timeout')) {
    console.log('Operation timed out');
  }
}
```

### Recovery Strategies

```javascript
class ResilientClient {
  async connectWithRetry(maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.client.connect();
        await this.client.handshake();
        return;
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
}
```

## Troubleshooting

### Common Issues

#### Server Won't Start

**Symptoms**: Server fails to start, port not listening

**Solutions**:
```bash
# Check Node.js version
node --version

# Check port availability
lsof -i :45227

# Check data directory permissions
ls -la ~/.latzero

# Check server logs for errors
node index.js start 2>&1 | tee server.log
```

#### Connection Refused

**Symptoms**: Client can't connect to server

**Solutions**:
```bash
# Verify server is running
ps aux | grep latzero

# Check firewall settings
sudo ufw status
sudo iptables -L

# Test basic connectivity
telnet localhost 45227

# Check server configuration
cat ~/.latzero/config.json
```

#### Handshake Failures

**Symptoms**: Handshake returns error

**Common Causes**:
- Invalid app_id format (must be alphanumeric, hyphens, underscores, dots)
- Duplicate app registration
- Server overload

**Debug**:
```javascript
// Enable detailed logging
const client = new LatZeroClient({
  appId: 'debug-app',
  timeout: 5000
});

try {
  await client.connect();
  const result = await client.handshake({
    triggers: ['debug-trigger']
  });
} catch (error) {
  console.error('Detailed error:', error);
  console.error('Error stack:', error.stack);
}
```

#### Trigger Not Found

**Symptoms**: Trigger calls fail with "not found" error

**Solutions**:
```javascript
// List registered triggers
const allApps = await client.getAllApps();
console.log('Registered apps and triggers:');
allApps.forEach(app => {
  console.log(`${app.appId}: ${app.triggers.join(', ')}`);
});

// Check trigger routing
const handlers = await client.getTriggerHandlers('my-trigger');
console.log('Trigger handlers:', handlers);
```

#### Memory Block Access Denied

**Symptoms**: Memory operations fail with permission errors

**Solutions**:
```javascript
// Check memory block permissions
const blockInfo = await client.getMemoryBlock('my-block');
console.log('Block permissions:', blockInfo.permissions);

// Verify app membership in required pools
const appInfo = await client.getApp(client.appId);
console.log('App pools:', appInfo.pools);
```

### Debug Logging

Enable detailed logging for troubleshooting:

```javascript
// Server-side logging
process.env.DEBUG = 'latzero:*';
node index.js start

// Client-side logging
const client = new LatZeroClient({
  appId: 'debug-client',
  debug: true
});
```

### Performance Issues

**Symptoms**: Slow response times, high latency

**Investigation**:
```javascript
// Measure connection latency
const start = Date.now();
await client.connect();
const connectTime = Date.now() - start;
console.log(`Connection time: ${connectTime}ms`);

// Measure trigger latency
const triggerStart = Date.now();
await client.callTrigger('test-trigger', {});
const triggerTime = Date.now() - triggerStart;
console.log(`Trigger time: ${triggerTime}ms`);
```

## Performance Testing

### Benchmarking Setup

```javascript
class PerformanceTester {
  async benchmarkTriggers(numCalls = 1000) {
    const results = [];
    const client = new LatZeroClient({ appId: 'benchmark' });

    await client.connect();
    await client.handshake({ triggers: ['benchmark-target'] });

    for (let i = 0; i < numCalls; i++) {
      const start = process.hrtime.bigint();
      await client.callTrigger('benchmark-target', { id: i });
      const end = process.hrtime.bigint();
      results.push(Number(end - start) / 1e6); // Convert to milliseconds
    }

    const avg = results.reduce((a, b) => a + b) / results.length;
    const min = Math.min(...results);
    const max = Math.max(...results);
    const p95 = results.sort((a, b) => a - b)[Math.floor(results.length * 0.95)];

    console.log(`Benchmark Results (${numCalls} calls):`);
    console.log(`Average: ${avg.toFixed(2)}ms`);
    console.log(`Min: ${min.toFixed(2)}ms`);
    console.log(`Max: ${max.toFixed(2)}ms`);
    console.log(`95th percentile: ${p95.toFixed(2)}ms`);
  }
}
```

### Memory Performance Testing

```javascript
async function testMemoryThroughput() {
  const client = new LatZeroClient({ appId: 'memory-test' });
  await client.connect();
  await client.handshake();

  // Create large memory block
  await client.createMemoryBlock('perf-test', 1024 * 1024); // 1MB

  const testData = Buffer.alloc(1024, 'x'); // 1KB test data
  const iterations = 1000;

  console.log(`Testing memory write/read throughput (${iterations} iterations)...`);

  const writeStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await client.writeMemoryBlock('perf-test', i * 1024, testData);
  }
  const writeTime = Date.now() - writeStart;

  const readStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await client.readMemoryBlock('perf-test', i * 1024, 1024);
  }
  const readTime = Date.now() - readStart;

  console.log(`Write throughput: ${(iterations * 1024 / 1024 / 1024 / (writeTime / 1000)).toFixed(2)} GB/s`);
  console.log(`Read throughput: ${(iterations * 1024 / 1024 / 1024 / (readTime / 1000)).toFixed(2)} GB/s`);
}
```

### Load Testing

```javascript
async function loadTest(numClients = 10, duration = 60000) {
  const clients = [];

  // Create multiple clients
  for (let i = 0; i < numClients; i++) {
    const client = new LatZeroClient({ appId: `load-test-${i}` });
    await client.connect();
    await client.handshake({ triggers: [`trigger-${i}`] });
    clients.push(client);
  }

  console.log(`Started ${numClients} clients for ${duration}ms load test`);

  const startTime = Date.now();
  let totalCalls = 0;

  // Run concurrent operations
  const promises = clients.map(async (client, index) => {
    let calls = 0;
    while (Date.now() - startTime < duration) {
      try {
        await client.callTrigger(`trigger-${(index + 1) % numClients}`, {
          data: `test-${calls}`
        });
        calls++;
      } catch (error) {
        // Ignore errors during load test
      }
    }
    return calls;
  });

  const results = await Promise.all(promises);
  totalCalls = results.reduce((a, b) => a + b, 0);

  console.log(`Load test completed:`);
  console.log(`Total calls: ${totalCalls}`);
  console.log(`Calls per second: ${(totalCalls / (duration / 1000)).toFixed(2)}`);

  // Cleanup
  await Promise.all(clients.map(client => client.disconnect()));
}
```

### Stress Testing

```javascript
async function stressTest() {
  const client = new LatZeroClient({
    appId: 'stress-test',
    timeout: 1000  // Short timeout
  });

  await client.connect();
  await client.handshake();

  // Test with invalid data sizes
  const largeData = Buffer.alloc(100 * 1024 * 1024); // 100MB
  try {
    await client.createMemoryBlock('stress-test', largeData.length);
    await client.writeMemoryBlock('stress-test', 0, largeData);
  } catch (error) {
    console.log('Stress test: Large data handling -', error.message);
  }

  // Test rapid connections/disconnections
  for (let i = 0; i < 100; i++) {
    const tempClient = new LatZeroClient({ appId: `temp-${i}` });
    try {
      await tempClient.connect();
      await tempClient.handshake();
      await tempClient.disconnect();
    } catch (error) {
      console.log(`Rapid connection ${i} failed:`, error.message);
    }
  }
}
```

## Example Scripts

See the following example scripts in the `latzero/examples/` directory:

- `producer-consumer.js` - Demonstrates producer-consumer pattern
- `memory-sharing.js` - Shows inter-process memory sharing
- `trigger-routing.js` - Illustrates explicit trigger routing
- `error-handling.js` - Comprehensive error handling examples
- `integration-test.js` - Automated testing of all functionality

Each script includes detailed comments and can be run independently:

```bash
# Run individual examples
node latzero/examples/producer-consumer.js

# Run integration test
node latzero/examples/integration-test.js
```

## Best Practices

### Client Configuration

```javascript
const client = new LatZeroClient({
  host: process.env.LATZERO_HOST || 'localhost',
  port: parseInt(process.env.LATZERO_PORT) || 45227,
  appId: process.env.APP_ID || `app-${process.pid}`,
  timeout: 30000,
  reconnect: true,
  reconnectInterval: 5000
});
```

### Error Recovery

```javascript
class RobustClient {
  async executeWithRetry(operation, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;

        // Exponential backoff
        await new Promise(resolve =>
          setTimeout(resolve, Math.pow(2, i) * 1000)
        );

        // Reconnect if needed
        if (error.message.includes('disconnected')) {
          await this.reconnect();
        }
      }
    }
  }
}
```

### Resource Management

```javascript
// Always cleanup resources
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await client.disconnect();
  process.exit(0);
});

// Use connection pooling for high-throughput applications
class ConnectionPool {
  constructor(size = 5) {
    this.pool = [];
    this.size = size;
  }

  async getConnection() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    const client = new LatZeroClient({ appId: `pool-${Date.now()}` });
    await client.connect();
    await client.handshake();
    return client;
  }

  releaseConnection(client) {
    if (this.pool.length < this.size) {
      this.pool.push(client);
    } else {
      client.disconnect();
    }
  }
}
```

This guide covers all major LatZero functionality. For additional examples and advanced usage patterns, refer to the example scripts and integration tests.