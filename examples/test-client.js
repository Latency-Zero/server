/**
 * LatZero Test Client - Basic Client for Testing Server Functionality
 *
 * This module provides a basic Node.js client for testing the LatZero server.
 * It implements the framed JSON protocol with TCP socket connection and supports:
 * - Handshake protocol with AppID registration
 * - Trigger registration and calling
 * - Memory block operations (create/attach/read/write)
 * - CLI interface for testing operations
 *
 * Usage: node test-client.js [command] [options]
 */

const net = require('net');
const crypto = require('crypto');

// Protocol constants
const PROTOCOL_VERSION = '0.1.0';
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 45227;

// Message types
const MessageTypes = {
  HANDSHAKE: 'handshake',
  HANDSHAKE_ACK: 'handshake_ack',
  TRIGGER: 'trigger',
  RESPONSE: 'response',
  MEMORY: 'memory',
  ERROR: 'error'
};

// Memory operations
const MemoryOperations = {
  CREATE: 'create',
  ATTACH: 'attach',
  READ: 'read',
  WRITE: 'write',
  LOCK: 'lock',
  UNLOCK: 'unlock'
};

/**
 * LatZero Test Client
 */
class LatZeroClient {
  constructor(options = {}) {
    this.host = options.host || DEFAULT_HOST;
    this.port = options.port || DEFAULT_PORT;
    this.appId = options.appId || `test-client-${Date.now()}`;
    this.socket = null;
    this.connected = false;
    this.pendingRequests = new Map(); // id -> { resolve, reject, timeout }
    this.requestTimeout = options.timeout || 30000; // 30 seconds
    this.buffer = Buffer.alloc(0);
    this.triggerHandlers = {}; // Registry for trigger handlers
    this.expectedFrameSize = null;
  // Register echo handler
  this.triggerHandlers['echo'] = (payload) => payload;
  }

  /**
   * Connect to the LatZero server
   */
  async connect() {
    return new Promise((resolve, reject) => {
      console.log(`🔗 Connecting to ${this.host}:${this.port} as ${this.appId}...`);

      this.socket = net.createConnection({
        host: this.host,
        port: this.port
      }, () => {
        console.log('✅ Connected to server');
        this.connected = true;
        resolve();
      });

      this.socket.on('data', (data) => this._handleData(data));
      this.socket.on('close', () => {
        console.log('🔌 Connection closed');
        this.connected = false;
        this._cleanupPendingRequests();
      });
      this.socket.on('error', (error) => {
        console.error('❌ Socket error:', error.message);
        this.connected = false;
        reject(error);
      });
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket && this.connected) {
      this.socket.end();
      this.connected = false;
      this._cleanupPendingRequests();
    }
  }

  /**
   * Perform handshake with the server
   */
  async handshake(options = {}) {
    const message = {
      type: MessageTypes.HANDSHAKE,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      protocol_version: PROTOCOL_VERSION,
      app_id: this.appId,
      pools: options.pools || ['default'],
      triggers: options.triggers || [],
      metadata: options.metadata || {}
    };

    console.log(`🤝 Performing handshake as ${this.appId}...`);
    const response = await this._sendRequest(message);

    if (response.type === MessageTypes.HANDSHAKE_ACK) {
      console.log('✅ Handshake successful');
      return response;
    } else {
      throw new Error(`Handshake failed: ${response.error || 'Unknown error'}`);
    }
  }

  /**
   * Register triggers
   */
  async registerTriggers(triggers) {
    // For now, triggers are registered during handshake
    // This could be extended to support dynamic registration
    console.log(`📝 Triggers registered: ${triggers.join(', ')}`);
    return true;
  }

  /**
   * Call a trigger
   */
  async callTrigger(triggerName, payload = {}, options = {}) {
    const message = {
      type: MessageTypes.TRIGGER,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      protocol_version: PROTOCOL_VERSION,
      trigger: triggerName,
      payload: payload,
      origin: this.appId,
      destination: options.destination,
      pool: options.pool || 'default',
      ttl: options.ttl || 30000
    };

    console.log(`🚀 Calling trigger: ${triggerName}`);
    const response = await this._sendRequest(message);

    if (response.type === MessageTypes.RESPONSE) {
      console.log(`✅ Trigger response received`);
      return response.result;
    } else if (response.type === MessageTypes.ERROR) {
      // Handle specific error types
      if (response.error_code === 'SHORT_CIRCUIT_NOT_IMPLEMENTED') {
        console.warn(`⚠️  Trigger short-circuiting not implemented: ${response.error}`);
        throw new Error(`Trigger short-circuiting not supported: ${response.error}`);
      } else {
        throw new Error(`Trigger failed: ${response.error}`);
      }
    } else {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
  }

  /**
   * Create a memory block
   */
  async createMemoryBlock(blockId, size, options = {}) {
    const message = {
      type: MessageTypes.MEMORY,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      protocol_version: PROTOCOL_VERSION,
      operation: MemoryOperations.CREATE,
      block_id: blockId,
      size: size,
      type: options.type || 'shared',
      pool: options.pool || 'default',
      permissions: options.permissions || {}
    };

    console.log(`🧠 Creating memory block: ${blockId} (${size} bytes)`);
    const response = await this._sendRequest(message);

    if (response.type === MessageTypes.RESPONSE) {
      console.log(`✅ Memory block created: ${blockId}`);
      return response.result;
    } else {
      throw new Error(`Memory block creation failed: ${response.error || 'Unknown error'}`);
    }
  }

  /**
   * Attach to a memory block
   */
  async attachMemoryBlock(blockId, mode = 'read') {
    const message = {
      type: MessageTypes.MEMORY,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      protocol_version: PROTOCOL_VERSION,
      operation: MemoryOperations.ATTACH,
      block_id: blockId,
      mode: mode
    };

    console.log(`🧠 Attaching to memory block: ${blockId} (${mode})`);
    const response = await this._sendRequest(message);

    if (response.type === MessageTypes.RESPONSE) {
      console.log(`✅ Attached to memory block: ${blockId}`);
      return response.result;
    } else {
      throw new Error(`Memory block attach failed: ${response.error || 'Unknown error'}`);
    }
  }

  /**
   * Read from a memory block
   */
  async readMemoryBlock(blockId, offset = 0, length = null) {
    const message = {
      type: MessageTypes.MEMORY,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      protocol_version: PROTOCOL_VERSION,
      operation: MemoryOperations.READ,
      block_id: blockId,
      offset: offset,
      length: length
    };

    console.log(`📖 Reading from memory block: ${blockId} (offset: ${offset})`);
    const response = await this._sendRequest(message);

    if (response.type === MessageTypes.RESPONSE) {
      const data = Buffer.from(response.result.data || response.result, 'base64');
      console.log(`✅ Read ${data.length} bytes from memory block: ${blockId}`);
      return data;
    } else {
      throw new Error(`Memory block read failed: ${response.error || 'Unknown error'}`);
    }
  }

  /**
   * Write to a memory block
   */
  async writeMemoryBlock(blockId, offset, data) {
    const message = {
      type: MessageTypes.MEMORY,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      protocol_version: PROTOCOL_VERSION,
      operation: MemoryOperations.WRITE,
      block_id: blockId,
      offset: offset,
      data: data.toString('base64') // Send as base64
    };

    console.log(`✏️  Writing to memory block: ${blockId} (offset: ${offset}, size: ${data.length})`);
    const response = await this._sendRequest(message);

    if (response.type === MessageTypes.RESPONSE) {
      console.log(`✅ Wrote ${data.length} bytes to memory block: ${blockId}`);
      return response.result;
    } else {
      throw new Error(`Memory block write failed: ${response.error || 'Unknown error'}`);
    }
  }

  /**
   * Send a request and wait for response
   */
  _sendRequest(message) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected to server'));
        return;
      }

      const messageId = message.id;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`Request timeout: ${messageId}`));
      }, this.requestTimeout);

      this.pendingRequests.set(messageId, { resolve, reject, timeout });

      // Send the message
      this._sendMessage(message);
    });
  }

  /**
   * Send a message to the server
   */
  _sendMessage(message) {
    const payload = JSON.stringify(message);
    console.log('DEBUG: Sending message to server:', payload);
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const lengthBuffer = Buffer.allocUnsafe(4);

    lengthBuffer.writeUInt32BE(payloadBuffer.length, 0);

    const frame = Buffer.concat([lengthBuffer, payloadBuffer]);
    this.socket.write(frame);
  }

  /**
   * Handle incoming data and frame parsing
   */
  async _handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 4) { // 4-byte header
      // Read frame length if we don't have it yet
      if (this.expectedFrameSize === null) {
        this.expectedFrameSize = this.buffer.readUInt32BE(0);

        // Validate frame size (max 16MB)
        if (this.expectedFrameSize > 16 * 1024 * 1024) {
          console.error(`❌ Frame size too large: ${this.expectedFrameSize}`);
          this.socket.destroy();
          return;
        }
      }

      // Check if we have the complete frame
      const totalFrameSize = 4 + this.expectedFrameSize;
      if (this.buffer.length < totalFrameSize) {
        break; // Wait for more data
      }

      // Extract frame payload
      const framePayload = this.buffer.slice(4, totalFrameSize);

      // Remove processed frame from buffer
      this.buffer = this.buffer.slice(totalFrameSize);
      this.expectedFrameSize = null;

      // Parse and handle message
      try {
        const message = JSON.parse(framePayload.toString('utf8'));
        await this._handleMessage(message);
      } catch (error) {
        console.error('❌ Invalid JSON frame:', error.message);
      }
    }
  }

  /**
   * Handle incoming message
   */
  async _handleMessage(message) {
    // Check if this is a response to a pending request
    const pendingRequest = this.pendingRequests.get(message.id) || this.pendingRequests.get(message.correlation_id) || this.pendingRequests.get(message.in_reply_to);

    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      this.pendingRequests.delete(message.id || message.correlation_id);

      if (message.type === MessageTypes.ERROR) {
        pendingRequest.reject(new Error(message.error || 'Server error'));
      } else {
        pendingRequest.resolve(message);
      }
    } else if (message.type === MessageTypes.TRIGGER) {
      // Handle incoming trigger
      const handler = this.triggerHandlers[message.trigger];
      if (handler) {
        try {
          const result = await handler(message.payload);
          const response = {
            type: MessageTypes.RESPONSE,
            id: crypto.randomUUID(),
            in_reply_to: message.id,
            status: 'success',
            response: result
          };
          this._sendMessage(response);
        } catch (error) {
          console.error(`❌ Error handling trigger ${message.trigger}:`, error.message);
          const response = {
            type: MessageTypes.RESPONSE,
            id: crypto.randomUUID(),
            in_reply_to: message.id,
            status: 'error',
            error: error.message
          };
          this._sendMessage(response);
        }
      } else {
        console.warn(`⚠️ No handler for trigger: ${message.trigger}`);
        const response = {
          type: MessageTypes.RESPONSE,
          id: crypto.randomUUID(),
          in_reply_to: message.id,
          status: 'error',
          error: `No handler for trigger: ${message.trigger}`
        };
        this._sendMessage(response);
      }
    } else {
      // Handle other unsolicited messages
      console.log(`📨 Received unsolicited message: ${message.type}`);
    }
  }

  /**
   * Cleanup pending requests on disconnect
   */
  _cleanupPendingRequests() {
    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }
}

/**
 * CLI Interface for testing
 */
class TestCLI {
  constructor() {
    this.client = null;
  }

  async run() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
      this.showHelp();
      return;
    }

    try {
      switch (command) {
        case 'handshake':
          await this.testHandshake(args.slice(1));
          break;
        case 'trigger':
          await this.testTrigger(args.slice(1));
          break;
        case 'memory':
          await this.testMemory(args.slice(1));
          break;
        case 'interactive':
          await this.interactiveMode();
          break;
        case 'inter-app-test':
          await this.interAppTest();
          break;
        default:
          console.log(`❌ Unknown command: ${command}`);
          this.showHelp();
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    } finally {
      if (this.client) {
        this.client.disconnect();
      }
    }
  }

  async testHandshake(args) {
    const appId = args[0] || `test-client-${Date.now()}`;
    const triggers = args.slice(1);

    this.client = new LatZeroClient({ appId });

    await this.client.connect();
    const result = await this.client.handshake({ triggers });

    console.log('Handshake result:', JSON.stringify(result, null, 2));
  }

  async testTrigger(args) {
    const [appId, triggerName, ...payloadArgs] = args;

    if (!appId || !triggerName) {
      console.log('Usage: node test-client.js trigger <appId> <triggerName> [payload...]');
      return;
    }

    this.client = new LatZeroClient({ appId });

    await this.client.connect();
    await this.client.handshake();

    let payload = {"message": "Hello Server!"};

    console.log('DEBUG: Calling trigger with payload:', payload);
    const result = await this.client.callTrigger(triggerName, payload);

    console.log('Trigger result:', JSON.stringify(result, null, 2));
  }

  async testMemory(args) {
    const [appId, operation, blockId, ...opArgs] = args;

    if (!appId || !operation || !blockId) {
      console.log('Usage:');
      console.log('  Create: node test-client.js memory <appId> create <blockId> <size>');
      console.log('  Attach: node test-client.js memory <appId> attach <blockId>');
      console.log('  Read:   node test-client.js memory <appId> read <blockId> [offset] [length]');
      console.log('  Write:  node test-client.js memory <appId> write <blockId> <offset> <data>');
      return;
    }

    this.client = new LatZeroClient({ appId });

    await this.client.connect();
    await this.client.handshake();

    switch (operation) {
      case 'create':
        const size = parseInt(opArgs[0]);
        if (isNaN(size)) {
          throw new Error('Invalid size');
        }
        await this.client.createMemoryBlock(blockId, size);
        break;

      case 'attach':
        await this.client.attachMemoryBlock(blockId);
        break;

      case 'read':
        const offset = parseInt(opArgs[0]) || 0;
        const length = opArgs[1] ? parseInt(opArgs[1]) : null;
        const data = await this.client.readMemoryBlock(blockId, offset, length);
        console.log('Read data:', data.toString());
        break;

      case 'write':
        const writeOffset = parseInt(opArgs[0]);
        const writeData = Buffer.from(opArgs.slice(1).join(' '));
        await this.client.writeMemoryBlock(blockId, writeOffset, writeData);
        break;

      default:
        throw new Error(`Unknown memory operation: ${operation}`);
    }
  }

  async interactiveMode() {
    console.log('🚀 LatZero Test Client - Interactive Mode');
    console.log('Commands: handshake, trigger <name> [payload], memory <op> <args>, quit');
    console.log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const appId = `interactive-${Date.now()}`;
    this.client = new LatZeroClient({ appId });

    try {
      await this.client.connect();
      await this.client.handshake();
      console.log(`✅ Connected as ${appId}`);
      console.log('');

      const askCommand = () => {
        rl.question('> ', async (input) => {
          const args = input.trim().split(/\s+/);
          const command = args[0];

          try {
            switch (command) {
              case 'handshake':
                console.log('Already connected');
                break;

              case 'trigger':
                const triggerName = args[1];
                const payload = args.slice(2).join(' ');
                if (!triggerName) {
                  console.log('Usage: trigger <name> [payload]');
                } else {
                  const result = await this.client.callTrigger(triggerName, payload ? JSON.parse(payload) : {});
                  console.log('Result:', result);
                }
                break;

              case 'memory':
                const op = args[1];
                const blockId = args[2];
                if (!op || !blockId) {
                  console.log('Usage: memory <create|attach|read|write> <blockId> [args...]');
                } else {
                  switch (op) {
                    case 'create':
                      const size = parseInt(args[3]);
                      await this.client.createMemoryBlock(blockId, size);
                      break;
                    case 'attach':
                      await this.client.attachMemoryBlock(blockId);
                      break;
                    case 'read':
                      const data = await this.client.readMemoryBlock(blockId, parseInt(args[3]) || 0);
                      console.log('Data:', data.toString());
                      break;
                    case 'write':
                      const offset = parseInt(args[3]);
                      const writeData = Buffer.from(args.slice(4).join(' '));
                      await this.client.writeMemoryBlock(blockId, offset, writeData);
                      break;
                  }
                }
                break;

              case 'quit':
              case 'exit':
                rl.close();
                return;

              default:
                if (command) {
                  console.log(`Unknown command: ${command}`);
                }
            }
          } catch (error) {
            console.error('Error:', error.message);
          }

          askCommand();
        });
      };

      askCommand();

      return new Promise((resolve) => {
        rl.on('close', resolve);
      });

    } catch (error) {
      console.error('Failed to start interactive mode:', error.message);
      rl.close();
    }
  }

  async interAppTest() {
    console.log('🚀 Starting inter-app trigger validation test...');
    const app1 = new LatZeroClient({ appId: 'app1-test' });
    const app2 = new LatZeroClient({ appId: 'app2-test' });
    try {
      console.log('🔗 Connecting app1...');
      await app1.connect();
      console.log('🔗 Connecting app2...');
      await app2.connect();
      console.log('🤝 Handshaking app1 with echo trigger...');
      await app1.handshake({ triggers: ['echo'] });
      console.log('🤝 Handshaking app2 with echo trigger...');
      await app2.handshake({ triggers: ['echo'] });
      const testPayload = { message: 'Hello from app1 to app2' };
      console.log('🚀 App1 calling echo trigger to app2...');
      const result = await app1.callTrigger('echo', testPayload, { destination: app2.appId });
      console.log('📨 Received response:', result);
      if (result && result.message === testPayload.message) {
        console.log('✅ Inter-app communication successful: Response matches payload');
      } else {
        throw new Error('Response validation failed: Expected message not found in response');
      }
    } catch (error) {
      console.error('❌ Inter-app test failed:', error.message);
      throw error;
    } finally {
      console.log('🔌 Disconnecting clients...');
      app1.disconnect();
      app2.disconnect();
    }
  }

  showHelp() {
    console.log('LatZero Test Client');
    console.log('');
    console.log('Usage: node test-client.js <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  handshake [appId] [triggers...]    Test handshake protocol');
    console.log('  trigger <appId> <triggerName> [payload]  Test trigger calling');
    console.log('  memory <appId> <operation> <args...>    Test memory operations');
    console.log('  interactive                              Start interactive mode');
    console.log('  inter-app-test                          Test inter-app trigger communication');
    console.log('');
    console.log('Memory Operations:');
    console.log('  create <blockId> <size>                 Create memory block');
    console.log('  attach <blockId>                        Attach to memory block');
    console.log('  read <blockId> [offset] [length]        Read from memory block');
    console.log('  write <blockId> <offset> <data>         Write to memory block');
    console.log('');
    console.log('Examples:');
    console.log('  node test-client.js handshake myapp trigger1 trigger2');
    console.log('  node test-client.js trigger myapp echo \'{"message": "hello"}\'');
    console.log('  node test-client.js memory myapp create myblock 1024');
    console.log('  node test-client.js memory myapp write myblock 0 "Hello World"');
    console.log('  node test-client.js memory myapp read myblock 0 11');
    console.log('  node test-client.js interactive');
    console.log('  node test-client.js inter-app-test');
  }
}

// Run CLI if called directly
if (require.main === module) {
  const cli = new TestCLI();
  cli.run().catch(console.error);
}

module.exports = { LatZeroClient, TestCLI };