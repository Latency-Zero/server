# LatZero Persistence Layer API Documentation

## Overview

The LatZero Persistence Layer provides a comprehensive SQLite-based storage solution for the LatZero server, implementing complete CRUD operations for AppRegistry, Pool metadata, and Memory Block management with support for both ephemeral and durable storage.

## Features

- **SQLite Database Setup**: Uses better-sqlite3 for high-performance database operations
- **Dual Storage Modes**: Supports both `:memory:` mode for ephemeral data and disk mode for durable storage
- **Complete CRUD Operations**: Full Create, Read, Update, Delete operations for all entities
- **Transaction Support**: Atomic operations with rollback capabilities
- **Backup & Restore**: Automated backup creation and manual restore functionality
- **Schema Migration**: Automatic database schema versioning and migration
- **Event Emission**: Real-time notifications for all persistence operations
- **Error Handling**: Comprehensive error handling with detailed logging
- **Performance Optimization**: Prepared statement caching and WAL mode support

## Class: PersistenceManager

### Constructor

```javascript
const persistence = new PersistenceManager(config)
```

**Configuration Options:**
- `dataDir` (string): Data directory path (default: `~/.latzero`)
- `memoryMode` (boolean): Use memory-only mode (default: `false`)
- `walMode` (boolean): Enable WAL mode for better concurrency (default: `true`)
- `cacheSize` (number): SQLite cache size (default: `1000`)
- `backupInterval` (number): Automatic backup interval in ms (default: `86400000` - 24 hours)
- `maxBackups` (number): Maximum number of backups to keep (default: `7`)

### Core Methods

#### `initialize()`
Initializes the persistence layer, creates databases, and sets up schema.

```javascript
await persistence.initialize();
```

#### `shutdown()`
Gracefully shuts down the persistence layer and closes all connections.

```javascript
await persistence.shutdown();
```

#### `transaction(callback, useDurable = true)`
Executes operations within a database transaction.

```javascript
await persistence.transaction(async () => {
  await persistence.registerApp('app1', ['trigger1'], ['pool1']);
  await persistence.createPool('pool1', 'local');
});
```

## AppRegistry CRUD Operations

### `registerApp(app_id, triggers = [], pools = [], metadata = {})`
Registers a new application with the persistence layer.

```javascript
const result = await persistence.registerApp('my-app', 
  ['trigger1', 'trigger2'], 
  ['pool1', 'pool2'], 
  { version: '1.0.0', description: 'My application' }
);
```

**Returns:** `{ app_id, triggers, pools, metadata, registered }`

### `getApp(app_id)`
Retrieves application registration by app_id.

```javascript
const app = await persistence.getApp('my-app');
// Returns: { appId, pools, triggers, meta, protocolVersion, registered, lastSeen, rehydrated }
```

### `updateApp(app_id, updates)`
Updates application registration with new data.

```javascript
const updatedApp = await persistence.updateApp('my-app', {
  triggers: ['trigger1', 'trigger2', 'trigger3'],
  meta: { version: '1.1.0' }
});
```

### `removeApp(app_id)`
Removes application registration.

```javascript
const removed = await persistence.removeApp('my-app');
// Returns: boolean indicating success
```

### `getAllApps()`
Retrieves all registered applications.

```javascript
const apps = await persistence.getAllApps();
// Returns: Array of app objects
```

### `getAppsByPool(pool_name)`
Retrieves applications that belong to a specific pool.

```javascript
const apps = await persistence.getAppsByPool('my-pool');
```

## Pool CRUD Operations

### `createPool(name, type = 'local', encrypted = false, properties = {})`
Creates a new pool with specified configuration.

```javascript
const pool = await persistence.createPool('my-pool', 'local', false, {
  description: 'Development pool',
  owners: ['app1'],
  policies: { read: ['*'], write: ['app1'] }
});
```

**Pool Types:** `'local'`, `'global'`, `'encrypted'`

### `getPool(name)`
Retrieves pool metadata by name.

```javascript
const pool = await persistence.getPool('my-pool');
// Returns: { name, type, encrypted, owners, policies, description, created, updated, ...config }
```

### `updatePool(name, updates)`
Updates pool properties.

```javascript
const updatedPool = await persistence.updatePool('my-pool', {
  description: 'Updated pool description',
  encrypted: true
});
```

### `removePool(name)`
Removes a pool.

```javascript
const removed = await persistence.removePool('my-pool');
```

### `getAllPools()`
Retrieves all pools.

```javascript
const pools = await persistence.getAllPools();
```

### `getPoolsByType(type)`
Retrieves pools by type.

```javascript
const localPools = await persistence.getPoolsByType('local');
```

## Memory Block CRUD Operations

### `createMemoryBlock(block_id, size, type = 'binary', permissions = {})`
Creates memory block metadata.

```javascript
const block = await persistence.createMemoryBlock('block-1', 1024, 'json', {
  name: 'JSON Data Block',
  pool: 'my-pool',
  persistent: true,
  permissions: { read: ['app1'], write: ['app1'] }
});
```

**Block Types:** `'binary'`, `'json'`, `'stream'`

### `getMemoryBlock(block_id)`
Retrieves memory block metadata.

```javascript
const block = await persistence.getMemoryBlock('block-1');
// Returns: { id, name, pool, size, type, permissions, version, created, updated, persistent, encrypted, ...config }
```

### `updateMemoryBlock(block_id, updates)`
Updates memory block metadata.

```javascript
const updatedBlock = await persistence.updateMemoryBlock('block-1', {
  name: 'Updated Block Name',
  encrypted: true
});
```

### `removeMemoryBlock(block_id)`
Removes memory block metadata.

```javascript
const removed = await persistence.removeMemoryBlock('block-1');
```

### `getAllMemoryBlocks()`
Retrieves all memory blocks.

```javascript
const blocks = await persistence.getAllMemoryBlocks();
```

### `getMemoryBlocksByPool(pool_name)`
Retrieves memory blocks by pool.

```javascript
const blocks = await persistence.getMemoryBlocksByPool('my-pool');
```

## Utility Methods

### `createBackup()`
Creates a database backup.

```javascript
const backupPath = await persistence.createBackup();
console.log('Backup created at:', backupPath);
```

### `getStats()`
Retrieves persistence layer statistics.

```javascript
const stats = persistence.getStats();
// Returns: { schemaVersion, dataDirectory, durableDatabase, memoryDatabase, activeTransactions, preparedStatements }
```

### `saveServerConfig(key, value)` / `loadServerConfig(key)`
Server configuration persistence.

```javascript
await persistence.saveServerConfig('feature_flags', { newFeature: true });
const config = await persistence.loadServerConfig('feature_flags');
```

## Events

The PersistenceManager emits events for all major operations:

```javascript
persistence.on('appRegistered', (appId) => console.log('App registered:', appId));
persistence.on('appUpdated', (appId, updates) => console.log('App updated:', appId));
persistence.on('appRemoved', (appId) => console.log('App removed:', appId));

persistence.on('poolCreated', (name, config) => console.log('Pool created:', name));
persistence.on('poolUpdated', (name, updates) => console.log('Pool updated:', name));
persistence.on('poolRemoved', (name) => console.log('Pool removed:', name));

persistence.on('memoryBlockCreated', (blockId, config) => console.log('Block created:', blockId));
persistence.on('memoryBlockUpdated', (blockId, updates) => console.log('Block updated:', blockId));
persistence.on('memoryBlockRemoved', (blockId) => console.log('Block removed:', blockId));

persistence.on('backupCreated', (path) => console.log('Backup created:', path));
```

## Error Handling

All methods include comprehensive error handling:

```javascript
try {
  await persistence.registerApp('invalid-app', [], [], {});
} catch (error) {
  console.error('Registration failed:', error.message);
  // Error types: validation errors, constraint violations, database errors
}
```

## Database Schema

### Tables

1. **app_registry**: Application registrations
   - `app_id` (TEXT PRIMARY KEY)
   - `pools` (TEXT) - JSON array
   - `triggers` (TEXT) - JSON array
   - `meta` (TEXT) - JSON object
   - `protocol_version` (TEXT)
   - `registered` (INTEGER) - timestamp
   - `last_seen` (INTEGER) - timestamp
   - `rehydrated` (INTEGER) - boolean flag

2. **pool_metadata**: Pool configurations
   - `name` (TEXT PRIMARY KEY)
   - `type` (TEXT) - 'local', 'global', 'encrypted'
   - `encrypted` (INTEGER) - boolean flag
   - `owners` (TEXT) - JSON array
   - `policies` (TEXT) - JSON object
   - `description` (TEXT)
   - `created` (INTEGER) - timestamp
   - `updated` (INTEGER) - timestamp
   - `config` (TEXT) - JSON object

3. **memory_blocks**: Memory block metadata
   - `block_id` (TEXT PRIMARY KEY)
   - `name` (TEXT)
   - `pool` (TEXT)
   - `size` (INTEGER)
   - `type` (TEXT) - 'binary', 'json', 'stream'
   - `permissions` (TEXT) - JSON object
   - `version` (INTEGER)
   - `created` (INTEGER) - timestamp
   - `updated` (INTEGER) - timestamp
   - `persistent` (INTEGER) - boolean flag
   - `encrypted` (INTEGER) - boolean flag
   - `config` (TEXT) - JSON object

4. **server_config**: Server configuration
   - `key` (TEXT PRIMARY KEY)
   - `value` (TEXT) - JSON value
   - `updated` (INTEGER) - timestamp

5. **trigger_records** (in-memory): Ephemeral trigger tracking
   - `id` (TEXT PRIMARY KEY)
   - `origin_app_id` (TEXT)
   - `origin_connection_id` (INTEGER)
   - `destination` (TEXT)
   - `pool` (TEXT)
   - `process` (TEXT)
   - `created` (INTEGER) - timestamp
   - `ttl` (INTEGER)
   - `dispatched_to` (TEXT)
   - `completed` (INTEGER) - boolean flag
   - `updated` (INTEGER) - timestamp

## Usage Example

```javascript
const { PersistenceManager } = require('./persistence');

async function example() {
  // Initialize persistence
  const persistence = new PersistenceManager({
    dataDir: './data',
    memoryMode: false,
    backupInterval: 3600000 // 1 hour
  });

  await persistence.initialize();

  // Register an application
  await persistence.registerApp('my-app', ['process-data'], ['data-pool'], {
    version: '1.0.0',
    description: 'Data processing application'
  });

  // Create a pool
  await persistence.createPool('data-pool', 'local', false, {
    description: 'Pool for data processing',
    owners: ['my-app']
  });

  // Create a memory block
  await persistence.createMemoryBlock('data-block-1', 4096, 'json', {
    name: 'Processing Buffer',
    pool: 'data-pool',
    persistent: true
  });

  // Use transactions for atomic operations
  await persistence.transaction(async () => {
    await persistence.updateApp('my-app', {
      triggers: ['process-data', 'validate-data']
    });
    await persistence.updatePool('data-pool', {
      description: 'Updated pool for data processing and validation'
    });
  });

  // Create backup
  await persistence.createBackup();

  // Cleanup
  await persistence.shutdown();
}

example().catch(console.error);
```

## Integration with LatZero Components

The persistence layer integrates seamlessly with other LatZero components:

- **AppRegistry**: Uses `registerApp()`, `getApp()`, `updateApp()` for application lifecycle
- **PoolManager**: Uses pool CRUD operations for pool management
- **MemoryManager**: Uses memory block operations for metadata persistence
- **TriggerRouter**: Uses ephemeral trigger records for routing state

This comprehensive persistence layer provides the foundation for reliable, scalable data management in the LatZero orchestration fabric.