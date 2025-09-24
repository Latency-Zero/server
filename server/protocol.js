/**
 * LatZero Protocol - Frame Parsing & Serialization
 * 
 * This module defines the LatZero protocol specification and provides utilities
 * for parsing, validating, and serializing protocol messages. It handles the
 * framed JSON protocol with support for binary frames for memory operations.
 * 
 * Key Responsibilities:
 * - Protocol message validation and schema enforcement
 * - Frame serialization and deserialization utilities
 * - Message type definitions and constants
 * - Binary frame handling for memory operations
 * - Protocol version negotiation and compatibility
 * - Message routing metadata extraction
 * 
 * Protocol Messages:
 * - handshake: Client registration and capability negotiation
 * - trigger: RPC call requests with routing metadata
 * - response: RPC call responses with correlation IDs
 * - memory_*: Memory block operations (create, attach, read, write)
 * - admin: Administrative and monitoring commands
 */

const { v4: uuidv4 } = require('uuid');
const chalk = require('chalk');

// Try to load msgpack, fallback to JSON for binary serialization
let msgpack = null;
try {
  msgpack = require('msgpack');
} catch (error) {
  console.warn(chalk.yellow('⚠️  msgpack not available, using JSON fallback for binary frames'));
}

// Protocol version and constants
const PROTOCOL_VERSION = '0.1.0';
const MAX_APP_ID_LENGTH = 128;
const MAX_POOL_NAME_LENGTH = 64;
const MAX_TRIGGER_NAME_LENGTH = 128;
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16MB

// Message action types
const MessageTypes = {
  // Core protocol messages
  HANDSHAKE: 'handshake',
  HANDSHAKE_ACK: 'handshake_ack',
  TRIGGER: 'trigger',
  RESPONSE: 'response',
  EMIT: 'emit',
  ERROR: 'error',
  
  // Memory operations
  MEMORY: 'memory',
  MEMORY_CREATE: 'memory_create',
  MEMORY_ATTACH: 'memory_attach',
  MEMORY_READ: 'memory_read',
  MEMORY_WRITE: 'memory_write',
  MEMORY_LOCK: 'memory_lock',
  MEMORY_UNLOCK: 'memory_unlock',
  MEMORY_SUBSCRIBE: 'memory_subscribe',
  MEMORY_NOTIFY: 'memory_notify',
  
  // Administrative commands
  ADMIN: 'admin',
  LIST_POOLS: 'list_pools',
  LIST_APPS: 'list_apps',
  INSPECT_BLOCK: 'inspect_block',
  SERVER_STATUS: 'server_status',
  
  // Binary frame wrapper
  BINARY_FRAME: 'binary_frame'
};

// Memory operation types
const MemoryOperations = {
  CREATE: 'create',
  ATTACH: 'attach',
  READ: 'read',
  WRITE: 'write',
  LOCK: 'lock',
  UNLOCK: 'unlock',
  SUBSCRIBE: 'subscribe',
  NOTIFY: 'notify'
};

// Admin operation types
const AdminOperations = {
  LIST_POOLS: 'list_pools',
  LIST_APPS: 'list_apps',
  INSPECT_BLOCK: 'inspect_block',
  SERVER_STATUS: 'server_status',
  SHUTDOWN: 'shutdown'
};

// Message schemas for validation
const MessageSchemas = {
  [MessageTypes.HANDSHAKE]: {
    required: ['type', 'app_id'],
    optional: ['pools', 'triggers', 'metadata', 'protocol_version'],
    validate: (msg) => {
      if (!msg.app_id || typeof msg.app_id !== 'string' || msg.app_id.length > MAX_APP_ID_LENGTH) {
        throw new Error('Invalid app_id: must be a string with max length ' + MAX_APP_ID_LENGTH);
      }
      if (msg.pools && !Array.isArray(msg.pools)) {
        throw new Error('pools must be an array');
      }
      if (msg.triggers && !Array.isArray(msg.triggers)) {
        throw new Error('triggers must be an array');
      }
      if (msg.pools) {
        for (const pool of msg.pools) {
          if (typeof pool !== 'string' || pool.length > MAX_POOL_NAME_LENGTH) {
            throw new Error('Invalid pool name: must be a string with max length ' + MAX_POOL_NAME_LENGTH);
          }
        }
      }
      if (msg.triggers) {
        for (const trigger of msg.triggers) {
          if (typeof trigger !== 'string' || trigger.length > MAX_TRIGGER_NAME_LENGTH) {
            throw new Error('Invalid trigger name: must be a string with max length ' + MAX_TRIGGER_NAME_LENGTH);
          }
        }
      }
    }
  },
  
  [MessageTypes.TRIGGER]: {
    required: ['type', 'id', 'origin', 'trigger', 'payload'],
    optional: ['pool', 'timestamp', 'ttl', 'flags', 'correlation_id', 'destination'],
    validate: (msg) => {
      if (!msg.trigger || typeof msg.trigger !== 'string' || msg.trigger.length > MAX_TRIGGER_NAME_LENGTH) {
        throw new Error('Invalid trigger name: must be a string with max length ' + MAX_TRIGGER_NAME_LENGTH);
      }
      if (!msg.origin || typeof msg.origin !== 'string') {
        throw new Error('Invalid origin: must be a string');
      }
      if (msg.destination && typeof msg.destination !== 'string') {
        throw new Error('Invalid destination: must be a string');
      }
      if (!_isValidUUID(msg.id)) {
        throw new Error('Invalid message ID: must be a valid UUID');
      }
      if (msg.pool && (typeof msg.pool !== 'string' || msg.pool.length > MAX_POOL_NAME_LENGTH)) {
        throw new Error('Invalid pool name: must be a string with max length ' + MAX_POOL_NAME_LENGTH);
      }
    }
  },
  
  [MessageTypes.RESPONSE]: {
    required: ['type', 'id', 'status'],
    optional: ['result', 'error', 'timestamp', 'correlation_id'],
    validate: (msg) => {
      if (!['success', 'error'].includes(msg.status)) {
        throw new Error('Invalid response status: must be "success" or "error"');
      }
      if (!_isValidUUID(msg.id)) {
        throw new Error('Invalid message ID: must be a valid UUID');
      }
      if (msg.status === 'error' && !msg.error) {
        throw new Error('Error responses must include an error field');
      }
    }
  },
  
  [MessageTypes.MEMORY]: {
    required: ['type', 'operation', 'block_id'],
    optional: ['data', 'offset', 'length', 'metadata', 'lock_id'],
    validate: (msg) => {
      if (!Object.values(MemoryOperations).includes(msg.operation)) {
        throw new Error('Invalid memory operation: ' + msg.operation);
      }
      if (!msg.block_id || typeof msg.block_id !== 'string') {
        throw new Error('Invalid block_id: must be a string');
      }
      if (msg.operation === MemoryOperations.WRITE && !msg.data) {
        throw new Error('Write operations must include data');
      }
      if (msg.offset !== undefined && (typeof msg.offset !== 'number' || msg.offset < 0)) {
        throw new Error('Invalid offset: must be a non-negative number');
      }
      if (msg.length !== undefined && (typeof msg.length !== 'number' || msg.length < 0)) {
        throw new Error('Invalid length: must be a non-negative number');
      }
    }
  },
  
  [MessageTypes.ADMIN]: {
    required: ['type', 'operation'],
    optional: ['target', 'params', 'metadata'],
    validate: (msg) => {
      if (!Object.values(AdminOperations).includes(msg.operation)) {
        throw new Error('Invalid admin operation: ' + msg.operation);
      }
    }
  }
};

/**
 * Enhanced Protocol Parser for LatZero server
 */
class ProtocolParser {
  constructor() {
    this.version = PROTOCOL_VERSION;
    this.supportsBinary = !!msgpack;
  }

  /**
   * Parse and validate an incoming message from transport layer
   */
  parseMessage(rawData, isBinary = false) {
    let message;
    
    try {
      if (isBinary && this.supportsBinary) {
        // Handle binary frame with msgpack
        message = this._parseBinaryFrame(rawData);
      } else if (Buffer.isBuffer(rawData)) {
        message = JSON.parse(rawData.toString('utf8'));
      } else if (typeof rawData === 'string') {
        message = JSON.parse(rawData);
      } else {
        message = rawData;
      }
    } catch (error) {
      throw new Error(`Invalid message format: ${error.message}`);
    }

    // Validate message structure
    this.validateMessage(message);
    
    return message;
  }

  /**
   * Serialize a message for transmission
   */
  serializeMessage(message, useBinary = false) {
    this.validateMessage(message);
    
    if (useBinary && this.supportsBinary) {
      return this._serializeBinaryFrame(message);
    } else {
      return JSON.stringify(message);
    }
  }

  /**
   * Validate a protocol message
   */
  validateMessage(message) {
    // Basic structure validation
    if (!message || typeof message !== 'object') {
      throw new Error('Message must be an object');
    }

    if (!message.type) {
      throw new Error('Message must have a type field');
    }

    // Check message size
    const messageSize = JSON.stringify(message).length;
    if (messageSize > MAX_MESSAGE_SIZE) {
      throw new Error(`Message size ${messageSize} exceeds maximum ${MAX_MESSAGE_SIZE}`);
    }

    // Schema-specific validation
    const schema = MessageSchemas[message.type];
    if (schema) {
      // Check required fields
      for (const field of schema.required) {
        if (!(field in message)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Run custom validation
      if (schema.validate) {
        schema.validate(message);
      }
    }

    return true;
  }

  /**
   * Extract routing metadata from a message
   */
  extractRoutingMetadata(message) {
    return {
      messageId: message.id,
      type: message.type,
      origin: message.origin,
      destination: message.destination,
      pool: message.pool,
      trigger: message.trigger,
      correlationId: message.correlation_id,
      timestamp: message.timestamp,
      ttl: message.ttl,
      flags: message.flags || []
    };
  }

  /**
   * Create a handshake message
   */
  createHandshake(appId, options = {}) {
    return this._createMessage(MessageTypes.HANDSHAKE, {
      app_id: appId,
      pools: options.pools || [],
      triggers: options.triggers || [],
      metadata: options.metadata || {},
      protocol_version: this.version
    });
  }

  /**
   * Create a handshake acknowledgment
   */
  createHandshakeAck(originalMessage, assignedData = {}) {
    return this._createMessage(MessageTypes.HANDSHAKE_ACK, {
      correlation_id: originalMessage.id,
      status: 'success',
      assigned: assignedData,
      server_version: this.version
    });
  }

  /**
   * Create a trigger request message
   */
  createTrigger(trigger, payload, options = {}) {
    return this._createMessage(MessageTypes.TRIGGER, {
      trigger: trigger,
      payload: payload,
      origin: options.origin,
      destination: options.destination,
      pool: options.pool,
      ttl: options.ttl || 30000, // 30 seconds default
      flags: options.flags || []
    });
  }

  /**
   * Create a response message
   */
  createResponse(originalMessage, result, status = 'success') {
    return this._createMessage(MessageTypes.RESPONSE, {
      correlation_id: originalMessage.id,
      status: status,
      result: result
    });
  }

  /**
   * Create an error response message
   */
  createError(originalMessage, error, errorCode = 'INTERNAL_ERROR') {
    return this._createMessage(MessageTypes.ERROR, {
      correlation_id: originalMessage ? originalMessage.id : null,
      status: 'error',
      error: error.message || error,
      error_code: errorCode,
      timestamp: Date.now()
    });
  }

  /**
   * Create a memory operation message
   */
  createMemoryOperation(operation, blockId, options = {}) {
    return this._createMessage(MessageTypes.MEMORY, {
      operation: operation,
      block_id: blockId,
      data: options.data,
      offset: options.offset,
      length: options.length,
      metadata: options.metadata,
      lock_id: options.lock_id
    });
  }

  /**
   * Create an admin operation message
   */
  createAdminOperation(operation, options = {}) {
    return this._createMessage(MessageTypes.ADMIN, {
      operation: operation,
      target: options.target,
      params: options.params || {},
      metadata: options.metadata || {}
    });
  }

  /**
   * Check if message requires a response
   */
  requiresResponse(message) {
    const noResponseTypes = [
      MessageTypes.EMIT,
      MessageTypes.RESPONSE,
      MessageTypes.ERROR,
      MessageTypes.MEMORY_NOTIFY,
      MessageTypes.HANDSHAKE_ACK
    ];
    
    return !noResponseTypes.includes(message.type);
  }

  /**
   * Get message priority (for routing decisions)
   */
  getMessagePriority(message) {
    const priorities = {
      [MessageTypes.HANDSHAKE]: 10,
      [MessageTypes.HANDSHAKE_ACK]: 10,
      [MessageTypes.ERROR]: 9,
      [MessageTypes.RESPONSE]: 8,
      [MessageTypes.TRIGGER]: 5,
      [MessageTypes.EMIT]: 3,
      [MessageTypes.MEMORY_READ]: 7,
      [MessageTypes.MEMORY_WRITE]: 6,
      [MessageTypes.MEMORY_CREATE]: 4,
      [MessageTypes.MEMORY_ATTACH]: 4,
      [MessageTypes.ADMIN]: 2
    };
    
    return priorities[message.type] || 1;
  }

  /**
   * Create standard error responses
   */
  createTimeoutError(originalMessage) {
    return this.createError(originalMessage, 'Request timeout', 'TIMEOUT');
  }

  createNotFoundError(originalMessage, resource) {
    return this.createError(
      originalMessage, 
      `Resource '${resource}' not found`, 
      'NOT_FOUND'
    );
  }

  createAuthError(originalMessage, reason = 'Access denied') {
    return this.createError(originalMessage, reason, 'ACCESS_DENIED');
  }

  createValidationError(originalMessage, details) {
    return this.createError(originalMessage, `Validation error: ${details}`, 'VALIDATION_ERROR');
  }

  /**
   * Create a binary frame wrapper for memory operations
   */
  createBinaryFrame(binaryData, metadata = {}) {
    if (!this.supportsBinary) {
      throw new Error('Binary frames not supported without msgpack');
    }

    return {
      type: MessageTypes.BINARY_FRAME,
      id: uuidv4(),
      timestamp: Date.now(),
      binary_size: binaryData.length,
      metadata: metadata
    };
  }

  /**
   * Get protocol statistics
   */
  getStats() {
    return {
      version: this.version,
      supportedTypes: Object.keys(MessageTypes),
      supportsBinary: this.supportsBinary,
      maxMessageSize: MAX_MESSAGE_SIZE,
      maxAppIdLength: MAX_APP_ID_LENGTH,
      maxPoolNameLength: MAX_POOL_NAME_LENGTH,
      maxTriggerNameLength: MAX_TRIGGER_NAME_LENGTH
    };
  }

  /**
   * Create a new message with standard metadata
   */
  _createMessage(type, data = {}) {
    const message = {
      type,
      id: uuidv4(),
      timestamp: Date.now(),
      protocol_version: this.version,
      ...data
    };

    return message;
  }

  /**
   * Parse binary frame using msgpack
   */
  _parseBinaryFrame(rawData) {
    if (!this.supportsBinary) {
      throw new Error('Binary frames not supported without msgpack');
    }

    try {
      return msgpack.decode(rawData);
    } catch (error) {
      throw new Error(`Invalid binary frame: ${error.message}`);
    }
  }

  /**
   * Serialize message as binary frame using msgpack
   */
  _serializeBinaryFrame(message) {
    if (!this.supportsBinary) {
      throw new Error('Binary frames not supported without msgpack');
    }

    try {
      return msgpack.encode(message);
    } catch (error) {
      throw new Error(`Binary serialization failed: ${error.message}`);
    }
  }
}

/**
 * Legacy Protocol class for backward compatibility
 */
class Protocol extends ProtocolParser {
  constructor() {
    super();
    console.warn(chalk.yellow('⚠️  Protocol class is deprecated, use ProtocolParser instead'));
  }

  // Legacy method mappings
  createMessage(action, data = {}) {
    return this._createMessage(action, data);
  }

  parseMessage(rawData) {
    return super.parseMessage(rawData);
  }

  serializeMessage(message) {
    return super.serializeMessage(message);
  }

  extractRouting(message) {
    return this.extractRoutingMetadata(message);
  }
}

/**
 * Utility functions
 */
function _isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// Export message types and protocol classes
module.exports = {
  ProtocolParser,
  Protocol, // Legacy compatibility
  MessageTypes,
  MemoryOperations,
  AdminOperations,
  PROTOCOL_VERSION,
  MAX_APP_ID_LENGTH,
  MAX_POOL_NAME_LENGTH,
  MAX_TRIGGER_NAME_LENGTH,
  MAX_MESSAGE_SIZE
};