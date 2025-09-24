# LatZero Server Architecture

## Overview

The LatZero Server implements a modular, event-driven architecture designed for high-performance process orchestration and shared memory management. The server acts as a central coordinator for distributed applications using a lightweight RPC protocol and mmap-backed shared memory.

## Core Architecture Principles

1. **Modular Design**: Each component has a single responsibility and well-defined interfaces
2. **Event-Driven**: Components communicate through events and message passing
3. **Asynchronous**: All I/O operations are non-blocking and promise-based
4. **Fault Tolerant**: Graceful error handling and recovery mechanisms
5. **Scalable**: Designed to handle thousands of concurrent connections

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        LatZero Server                       │
├─────────────────────────────────────────────────────────────┤
│  index.js (Bootstrap & CLI)                                 │
├─────────────────────────────────────────────────────────────┤
│  transport.js          │  protocol.js                       │
│  (Socket & Framing)    │  (Message Parsing)                 │
├────────────────────────┼─────────────────────────────────────┤
│  triggerRouter.js      │  appRegistry.js                    │
│  (Request Routing)     │  (AppID Mapping)                   │
├────────────────────────┼─────────────────────────────────────┤
│  poolManager.js        │  memoryManager.js                  │
│  (Pool Lifecycle)      │  (mmap Operations)                 │
├────────────────────────┼─────────────────────────────────────┤
│  security.js           │  persistence.js                    │
│  (Triple-Key Crypto)   │  (SQLite Storage)                  │
├─────────────────────────────────────────────────────────────┤
│  clusterManager.js (Global Pool Sync - Future)             │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Connection Establishment
```
Client → Transport → Protocol → AppRegistry → PoolManager
```

### 2. Trigger Request Processing
```
Client → Transport → Protocol → TriggerRouter → AppRegistry → Target App
```

### 3. Memory Block Operations
```
Client → Transport → Protocol → MemoryManager → mmap → Shared Memory
```

### 4. Response Routing
```
Handler App → Transport → TriggerRouter → Origin App
```

## Component Details

### Transport Layer (`transport.js`)
- **Purpose**: Low-level network communication
- **Responsibilities**:
  - TCP socket management
  - Frame-based protocol implementation
  - TLS encryption support
  - Connection lifecycle management
- **Key Features**:
  - 4-byte length prefix framing
  - Binary frame support for memory operations
  - Connection pooling and rate limiting

### Protocol Layer (`protocol.js`)
- **Purpose**: Message parsing and validation
- **Responsibilities**:
  - JSON message serialization/deserialization
  - Message schema validation
  - Protocol version negotiation
  - Routing metadata extraction
- **Message Types**:
  - Handshake, Trigger, Response, Emit
  - Memory operations (create, attach, read, write)
  - Administrative commands

### Application Registry (`appRegistry.js`)
- **Purpose**: Application lifecycle and rehydration
- **Responsibilities**:
  - AppID to trigger mapping
  - Connection state tracking
  - Automatic rehydration on reconnect
  - Trigger registration/deregistration
- **Key Features**:
  - Persistent app state for reconnection
  - Trigger capability advertisement
  - Connection health monitoring

### Trigger Router (`triggerRouter.js`)
- **Purpose**: Request routing and dispatch
- **Responsibilities**:
  - Trigger request routing
  - Response correlation and delivery
  - Timeout handling and cleanup
  - Load balancing across handlers
- **Key Features**:
  - Trigger record lifecycle management
  - Automatic response routing
  - Short-circuiting for intra-process calls

### Pool Manager (`poolManager.js`)
- **Purpose**: Pool lifecycle and access control
- **Responsibilities**:
  - Pool creation and destruction
  - Access control and permissions
  - Pool membership management
  - Resource cleanup
- **Pool Types**:
  - Local: Single orchestrator instance
  - Global: Multi-orchestrator (future)
  - Encrypted: Triple-key encryption required

### Memory Manager (`memoryManager.js`)
- **Purpose**: Shared memory operations
- **Responsibilities**:
  - Memory block creation and attachment
  - mmap-backed shared memory
  - Cross-platform compatibility
  - Memory block metadata management
- **Key Features**:
  - Zero-copy memory access
  - Advisory locking mechanisms
  - Change notification subscriptions

### Security Module (`security.js`)
- **Purpose**: Encryption and access control
- **Responsibilities**:
  - Triple-key encryption implementation
  - Key derivation and management
  - Pool access authorization
  - Key rotation and lifecycle
- **Trinity Keys**:
  - SigilKey: Pool access authorization
  - CipherShard: Read permission
  - OblivionSeal: Write permission

### Persistence Layer (`persistence.js`)
- **Purpose**: Data durability and recovery
- **Responsibilities**:
  - SQLite database management
  - App registry persistence
  - Pool metadata storage
  - Backup and recovery
- **Storage Strategy**:
  - Ephemeral: SQLite :memory: for performance
  - Durable: SQLite file for persistence
  - Automatic backup and cleanup

### Cluster Manager (`clusterManager.js`)
- **Purpose**: Global pool synchronization (future)
- **Responsibilities**:
  - Node discovery and membership
  - Distributed consensus
  - State synchronization
  - Leader election and failover
- **Implementation**:
  - Gossip protocol for discovery
  - Raft consensus for operations
  - Merkle trees for state sync

## Message Flow Patterns

### 1. Application Registration
```
1. Client connects to transport layer
2. Transport creates connection and forwards to protocol
3. Protocol validates handshake message
4. AppRegistry processes registration and stores mapping
5. PoolManager adds app to requested pools
6. Handshake acknowledgment sent back to client
```

### 2. Trigger Execution
```
1. Client sends trigger request
2. TriggerRouter creates trigger record
3. Router resolves target handler from AppRegistry
4. Message dispatched to target application
5. Handler processes request and sends response
6. Router correlates response and forwards to origin
7. Trigger record cleaned up
```

### 3. Memory Block Access
```
1. Client requests memory block creation/attachment
2. MemoryManager validates permissions
3. mmap-backed memory block created/attached
4. Block metadata stored in persistence layer
5. Block handle returned to client
6. Client performs direct memory operations
```

## Error Handling Strategy

### 1. Connection Errors
- Automatic reconnection with exponential backoff
- Graceful connection cleanup
- Error propagation to affected components

### 2. Message Errors
- Schema validation with detailed error messages
- Malformed message rejection
- Error responses with correlation IDs

### 3. Component Errors
- Isolated error handling per component
- Graceful degradation of functionality
- Comprehensive error logging and metrics

### 4. Resource Errors
- Memory allocation failure handling
- Database connection recovery
- File system error management

## Performance Considerations

### 1. Memory Management
- Object pooling for frequently created objects
- Efficient buffer management for network I/O
- mmap for zero-copy memory access

### 2. Network Optimization
- Frame-based protocol to minimize parsing overhead
- Connection pooling and reuse
- Binary frames for large data transfers

### 3. Database Performance
- Prepared statement caching
- WAL mode for better concurrency
- Separate in-memory DB for ephemeral data

### 4. Concurrency
- Event-driven architecture for high concurrency
- Non-blocking I/O throughout the stack
- Efficient timer management for timeouts

## Security Architecture

### 1. Transport Security
- Optional TLS encryption for network traffic
- Certificate-based authentication
- Secure key exchange protocols

### 2. Pool Security
- Triple-key encryption model
- Granular access control per pool
- Key rotation and lifecycle management

### 3. Memory Security
- Encrypted memory blocks for sensitive data
- Access control lists for memory operations
- Secure key derivation using HKDF

## Monitoring and Observability

### 1. Metrics Collection
- Component-level performance metrics
- Resource usage monitoring
- Error rate tracking

### 2. Health Checks
- Component health status
- Database connectivity checks
- Memory block integrity validation

### 3. Logging
- Structured logging with correlation IDs
- Configurable log levels
- Log rotation and archival

## Future Enhancements

### 1. Clustering Support
- Multi-node deployment
- Global pool synchronization
- Distributed consensus mechanisms

### 2. Advanced Security
- Hardware security module integration
- Advanced key management
- Audit logging and compliance

### 3. Performance Optimizations
- Native addon for critical paths
- Advanced memory management
- Protocol optimizations

---

This architecture provides a solid foundation for the LatZero process orchestration fabric while maintaining flexibility for future enhancements and scaling requirements.