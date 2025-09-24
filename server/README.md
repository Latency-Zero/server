# LatZero Server

The LatZero Server is the core orchestration engine for the LatZero process fabric. It provides lightweight RPC, shared memory management, and process coordination capabilities.

## Overview

LatZero Server implements a branded transport `latzero://APP_ID` that connects processes to a local orchestrator server (default port **45227**). The server exposes *Pools* (namespaces) that contain:

- **Events** — triggerable handlers (RPC or fire-and-forget)
- **Memory Blocks** — mmap-backed shared memory blocks accessible by all processes in the pool

## Architecture

The server is built with a modular architecture consisting of these core components:

### Core Modules

- **[`index.js`](index.js)** - Server bootstrap, CLI, and component coordination
- **[`transport.js`](transport.js)** - TCP socket acceptor, framing, and TLS support
- **[`protocol.js`](protocol.js)** - Frame parsing/serialization and message validation
- **[`poolManager.js`](poolManager.js)** - Pool lifecycle management and access control
- **[`appRegistry.js`](appRegistry.js)** - AppID mapping and rehydration support
- **[`triggerRouter.js`](triggerRouter.js)** - Request routing, dispatch, and response tracking
- **[`memoryManager.js`](memoryManager.js)** - mmap operations and memory block metadata
- **[`security.js`](security.js)** - Triple-key encryption and access control
- **[`persistence.js`](persistence.js)** - SQLite storage layer for durability
- **[`clusterManager.js`](clusterManager.js)** - Global pool synchronization (future)

### Key Features

- **Fast RPC**: Low-latency trigger-based RPC with automatic response routing
- **Shared Memory**: mmap-backed memory blocks for zero-copy data sharing
- **Rehydration**: Automatic reconnection and state restoration using AppID
- **Security**: Triple-key encryption model for encrypted pools
- **Persistence**: SQLite-based storage for durability and recovery
- **Clustering**: Future support for global pools across multiple nodes

## Quick Start

### Installation

```bash
npm install
```

### Starting the Server

```bash
# Start with default configuration
npm start

# Or use the CLI directly
node index.js start

# Start with custom configuration
node index.js start --port 45227 --host 127.0.0.1 --data-dir ~/.latzero
```

### CLI Commands

```bash
# Start the server
node index.js start [options]

# Check server status
node index.js status

# Stop the server
node index.js stop
```

### CLI Options

- `-p, --port <port>` - Server port (default: 45227)
- `-h, --host <host>` - Server host (default: 127.0.0.1)
- `-d, --data-dir <dir>` - Data directory (default: ~/.latzero)
- `--cluster` - Enable cluster mode
- `--tls` - Enable TLS encryption
- `--log-level <level>` - Log level (default: info)

## Configuration

The server can be configured through:

1. **CLI arguments** (highest priority)
2. **Environment variables**
3. **Configuration files** in `config/`
4. **Default values** (lowest priority)

### Environment Variables

- `LATZERO_PORT` - Server port
- `LATZERO_HOST` - Server host
- `LATZERO_DATA_DIR` - Data directory
- `LATZERO_LOG_LEVEL` - Log level
- `LATZERO_ENABLE_TLS` - Enable TLS (true/false)
- `LATZERO_CLUSTER_MODE` - Enable cluster mode (true/false)

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run tests with coverage
npm run test -- --coverage
```

### Linting

```bash
# Check code style
npm run lint

# Fix code style issues
npm run lint:fix
```

### Development Mode

```bash
# Start server with auto-restart on changes
npm run dev
```

## Protocol

LatZero uses a framed JSON protocol over TCP:

### Frame Format
```
[4-byte length prefix][JSON payload]
```

### Message Types

- **Handshake**: Client registration and capability negotiation
- **Trigger**: RPC call requests with routing metadata
- **Response**: RPC call responses with correlation IDs
- **Emit**: Fire-and-forget event dispatch
- **Memory Operations**: Memory block create/attach/read/write

### Example Messages

**Handshake:**
```json
{
  "action": "handshake",
  "app_id": "myApp",
  "pools": ["alpha"],
  "triggers": ["foo", "bar"],
  "meta": { "version": "1.0.0" }
}
```

**Trigger:**
```json
{
  "action": "trigger",
  "id": "uuid-v4",
  "process": "foo",
  "data": { "x": 42 },
  "pool": "alpha",
  "origin": { "app_id": "clientApp" },
  "destination": "targetApp"
}
```

**Response:**
```json
{
  "action": "response",
  "in_reply_to": "uuid-v4",
  "status": "ok",
  "response": { "result": 84 }
}
```

## Security

### Triple-Key Model

LatZero implements a sophisticated security model using three keys:

- **SigilKey** (Access Key) - Authorizes joining encrypted pools
- **CipherShard** (Read Key) - Allows decrypting memory and reading events
- **OblivionSeal** (Write Key) - Allows writing/encrypting memory and privileged events

### Key Usage

The three keys are combined using HKDF to derive a symmetric pool key used with AES-GCM for encryption/decryption operations.

## Storage

### Data Directory Structure

```
~/.latzero/
├── data.db          # Main SQLite database
├── backups/         # Database backups
├── memory/          # Memory-mapped files
├── logs/            # Server logs
└── config/          # Configuration files
```

### Database Schema

- **app_registry** - Application registrations for rehydration
- **pool_metadata** - Pool configurations and metadata
- **memory_blocks** - Memory block metadata and permissions
- **server_config** - Server configuration and settings

## Monitoring

### Statistics

The server provides comprehensive statistics through:

- Component-level metrics (transport, pools, memory, etc.)
- Performance metrics (response times, throughput)
- Resource usage (memory, connections, pools)
- Error rates and health indicators

### Health Checks

- TCP socket health
- Database connectivity
- Memory block integrity
- Component status

## Troubleshooting

### Common Issues

1. **Port already in use**: Change the port using `--port` option
2. **Permission denied**: Ensure write access to data directory
3. **Database locked**: Check for other server instances
4. **Memory allocation failed**: Verify available system memory

### Debug Mode

```bash
# Start with debug logging
node index.js start --log-level debug
```

### Log Files

Logs are written to:
- Console (stdout/stderr)
- File: `~/.latzero/logs/server.log`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

### Code Style

- Use ESLint configuration provided
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Write comprehensive tests

## License

MIT License - see LICENSE file for details.

## Support

- GitHub Issues: Report bugs and feature requests
- Documentation: See `/docs` directory
- Examples: See `/examples` directory

---

**LatZero Server** - Fast, lightweight process orchestration fabric