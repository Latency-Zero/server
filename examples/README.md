# LatZero Testing Solution

LatZero is a high-performance process orchestration fabric that enables distributed applications to communicate through triggers, shared memory blocks, and connection pools. This testing solution provides comprehensive tools for validating server functionality, client interactions, and system integration.

## Overview

LatZero operates as a central orchestration server that manages:

- **Application Registry**: Dynamic registration and discovery of distributed applications
- **Trigger System**: Asynchronous message passing between applications
- **Memory Management**: Shared memory blocks for high-performance data exchange
- **Connection Pools**: Load balancing and resource management across application instances
- **Persistence Layer**: SQLite-based storage for configuration and metadata

The testing solution includes:
- Server implementation with full feature set
- Test client for protocol validation
- CLI tools for manual testing
- Comprehensive examples and documentation

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Test Client   │◄──►│  LatZero Server  │◄──►│   Applications  │
│                 │    │                  │    │                 │
│ • Handshake     │    │ • Transport      │    │ • App Registry  │
│ • Triggers      │    │ • Pool Manager   │    │ • Triggers      │
│ • Memory Ops    │    │ • App Registry   │    │ • Memory Blocks │
│ • CLI Interface │    │ • Trigger Router │    │ • Connection    │
└─────────────────┘    │ • Memory Manager │    │   Management    │
                       │ • Persistence    │    └─────────────────┘
                       │ • Cluster Mgr    │
                       └──────────────────┘
```

### Core Components

- **Transport Layer**: TCP socket server with framed JSON protocol
- **Pool Manager**: Connection pooling and load balancing
- **App Registry**: Application registration and metadata management
- **Trigger Router**: Message routing and delivery
- **Memory Manager**: Shared memory block allocation and access control
- **Persistence Layer**: SQLite storage for durable data

## Installation and Setup

### Prerequisites

- Node.js 16+ with npm
- Basic understanding of TCP networking and JSON protocols

### Server Setup

1. **Install Dependencies**
   ```bash
   cd latzero/server
   npm install
   ```

2. **Start the Server**
   ```bash
   # Basic startup
   node index.js start

   # With custom options
   node index.js start --port 8080 --host 0.0.0.0 --data-dir /custom/path
   ```

3. **Verify Server Status**
   ```bash
   node index.js status
   ```

### Client Setup

1. **Navigate to Examples**
   ```bash
   cd latzero/examples
   ```

2. **Install Client Dependencies**
   ```bash
   npm install
   ```

## Quick Start Examples

### Basic Server Connection

```javascript
const { LatZeroClient } = require('./test-client');

// Connect and handshake
const client = new LatZeroClient({ appId: 'my-app' });
await client.connect();
await client.handshake({ triggers: ['echo', 'process'] });

console.log('Connected to LatZero server!');
```

### Trigger Operations

```javascript
// Register and call triggers
await client.registerTriggers(['echo', 'process']);

const result = await client.callTrigger('echo', {
  message: 'Hello LatZero!',
  timestamp: Date.now()
});

console.log('Trigger result:', result);
```

### Memory Block Operations

```javascript
// Create a shared memory block
const block = await client.createMemoryBlock('my-block', 1024, {
  type: 'binary',
  pool: 'shared'
});

// Write data
await client.writeMemoryBlock('my-block', 0, Buffer.from('Hello World!'));

// Read data
const data = await client.readMemoryBlock('my-block', 0, 12);
console.log('Read data:', data.toString());
```

### CLI Testing

```bash
# Test handshake
node test-client.js handshake my-app trigger1 trigger2

# Call a trigger
node test-client.js trigger my-app echo '{"message":"test"}'

# Memory operations
node test-client.js memory my-app create test-block 1024
node test-client.js memory my-app write test-block 0 "Hello World"
node test-client.js memory my-app read test-block 0 11

# Interactive mode
node test-client.js interactive
```

## Detailed Usage

### Server Configuration

The server supports extensive configuration options:

```javascript
const server = new LatZeroServer({
  port: 45227,           // Server port
  host: '127.0.0.1',     // Bind address
  dataDir: '~/.latzero', // Data directory
  logLevel: 'info',      // Logging level
  enableTLS: false,      // TLS support
  clusterMode: false,    // Cluster operation
  memoryMode: false,     // In-memory only
  walMode: true,         // Write-ahead logging
  cacheSize: 1000,       // SQLite cache size
  backupInterval: 86400000, // 24 hours
  maxBackups: 7          // Backup retention
});
```

### Client Protocol

The LatZero protocol uses framed JSON messages over TCP:

```
Frame Format:
┌─────────────┬─────────────────┐
│ Length (4B) │ JSON Payload    │
└─────────────┴─────────────────┘
```

#### Message Types

- **handshake**: Initial connection and app registration
- **handshake_ack**: Server acknowledgment
- **trigger**: Asynchronous message delivery
- **response**: Trigger execution result
- **memory**: Memory block operations
- **error**: Error responses

#### Handshake Protocol

```json
{
  "type": "handshake",
  "id": "uuid",
  "timestamp": 1234567890,
  "protocol_version": "0.1.0",
  "app_id": "my-application",
  "pools": ["default", "shared"],
  "triggers": ["echo", "process"],
  "metadata": {
    "version": "1.0.0",
    "capabilities": ["memory", "triggers"]
  }
}
```

### Memory Management

LatZero provides shared memory blocks with access control:

```javascript
// Create encrypted memory block
const block = await client.createMemoryBlock('secure-data', 4096, {
  type: 'json',
  pool: 'encrypted',
  permissions: {
    read: ['app1', 'app2'],
    write: ['app1']
  },
  encrypted: true,
  persistent: true
});
```

### Pool Management

Applications can join multiple pools for load balancing:

```javascript
await client.handshake({
  pools: ['web', 'worker', 'cache'],
  triggers: ['http-request', 'cache-invalidate']
});
```

### Trigger Routing

Triggers support complex routing patterns:

```javascript
// Call trigger with routing options
await client.callTrigger('process-data', payload, {
  destination: 'worker-pool',
  pool: 'processing',
  ttl: 30000  // 30 second timeout
});
```

## Persistence and Data Management

LatZero uses a dual-database approach:

- **Memory Database**: Fast, ephemeral data (trigger records)
- **Durable Database**: Persistent storage (app registry, pools, memory metadata)

### Backup and Recovery

```javascript
// Manual backup
await persistence.createBackup();

// Automatic backups every 24 hours
// Configurable via backupInterval option
```

### Data Migration

The persistence layer supports schema versioning and automatic migrations from previous versions.

## Monitoring and Debugging

### Server Statistics

```javascript
const stats = server.getStatus();
console.log('Active connections:', stats.stats.activeConnections);
console.log('Registered apps:', stats.stats.registeredApps);
```

### Client Debugging

```javascript
// Enable verbose logging
const client = new LatZeroClient({
  appId: 'debug-client',
  timeout: 60000  // Extended timeout for debugging
});
```

### Log Levels

Server supports multiple log levels:
- `error`: Critical errors only
- `warn`: Warnings and errors
- `info`: General information (default)
- `debug`: Detailed debugging information
- `trace`: Full trace logging

## Security Considerations

### Transport Security

- TLS support available via `enableTLS` option
- Certificate-based authentication (planned)
- Connection encryption for sensitive data

### Access Control

- Pool-based access control
- Memory block permissions
- Application authentication via app_id

### Data Protection

- Optional encryption for memory blocks
- Secure key management (planned)
- Audit logging for sensitive operations

## Performance Optimization

### Connection Pooling

```javascript
// Configure pool settings
const server = new LatZeroServer({
  poolConfig: {
    maxConnections: 1000,
    idleTimeout: 300000,  // 5 minutes
    acquireTimeout: 60000 // 1 minute
  }
});
```

### Memory Management

- Efficient memory block allocation
- Automatic cleanup of expired blocks
- Memory-mapped operations for large blocks

### Database Optimization

- Prepared statement caching
- WAL mode for concurrent access
- Automatic backup and compaction

## Contributing

### Development Setup

1. **Clone and Setup**
   ```bash
   git clone <repository>
   cd latzero
   npm install
   ```

2. **Run Tests**
   ```bash
   npm test
   ```

3. **Development Server**
   ```bash
   npm run dev
   ```

### Code Standards

- Use async/await for asynchronous operations
- Follow Node.js error handling patterns
- Include JSDoc comments for public APIs
- Write comprehensive unit tests

### Testing Guidelines

- Test both success and error paths
- Include integration tests for client-server communication
- Test memory operations thoroughly
- Validate protocol compliance

### Documentation

- Update README for new features
- Include code examples in documentation
- Document configuration options
- Provide troubleshooting guides

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For questions and support:
- Check the troubleshooting guide
- Review the examples directory
- File issues on the project repository