/**
 * LatZero Transport Layer - Socket Acceptor & Framing
 * 
 * This module handles the low-level network transport for the LatZero server.
 * It manages TCP socket connections, implements the framed JSON protocol,
 * and provides optional TLS encryption for secure communications.
 * 
 * Key Responsibilities:
 * - TCP server socket management and client connection handling
 * - Frame-based protocol implementation (4-byte length prefix + JSON payload)
 * - TLS/SSL encryption support for secure channels
 * - Connection lifecycle management and cleanup
 * - Binary frame support for memory operations
 * - Connection pooling and rate limiting
 * 
 * Protocol Format:
 * - Standard Frame: [4-byte length][JSON payload]
 * - Binary Frame: [4-byte length][binary_frame header][binary data]
 */

const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');
const chalk = require('chalk');
const { ProtocolParser } = require('./protocol');

class Transport extends EventEmitter {
  constructor(config, triggerRouter) {
    super();
    this.config = config;
    this.triggerRouter = triggerRouter;
    
    this.server = null;
    this.connections = new Map(); // connectionId -> Connection
    this.connectionCounter = 0;
    this.isRunning = false;
    
    // Protocol parser for message handling
    this.protocolParser = new ProtocolParser();
    
    // Protocol constants
    this.FRAME_HEADER_SIZE = 4; // 4-byte length prefix
    this.MAX_FRAME_SIZE = 16 * 1024 * 1024; // 16MB max frame size
  }

  /**
   * Initialize the transport layer
   */
  async initialize() {
    console.log(chalk.blue('🔌 Initializing Transport Layer...'));
    
    // TODO: Load TLS certificates if TLS is enabled
    if (this.config.enableTLS) {
      await this._loadTLSCertificates();
    }
    
    // Create server instance
    this.server = this.config.enableTLS 
      ? tls.createServer(this.tlsOptions, this._handleConnection.bind(this))
      : net.createServer(this._handleConnection.bind(this));
    
    // Server event handlers
    this.server.on('error', this._handleServerError.bind(this));
    this.server.on('close', this._handleServerClose.bind(this));
    
    console.log(chalk.green('✅ Transport Layer initialized'));
  }

  /**
   * Start accepting connections
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, (error) => {
        if (error) {
          reject(error);
          return;
        }
        
        this.isRunning = true;
        console.log(chalk.green(`🌐 Transport listening on ${this.config.host}:${this.config.port}`));
        console.log(chalk.cyan(`🔒 TLS: ${this.config.enableTLS ? 'enabled' : 'disabled'}`));
        resolve();
      });
    });
  }

  /**
   * Stop accepting connections and close existing ones
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }

    console.log(chalk.yellow('🔌 Shutting down Transport Layer...'));
    
    // Close all active connections
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    
    // Close server
    return new Promise((resolve) => {
      this.server.close(() => {
        this.isRunning = false;
        console.log(chalk.green('✅ Transport Layer shutdown complete'));
        resolve();
      });
    });
  }

  /**
   * Handle new client connections
   */
  _handleConnection(socket) {
    const connectionId = ++this.connectionCounter;
    const connection = new Connection(connectionId, socket, this);
    
    this.connections.set(connectionId, connection);
    
    console.log(chalk.cyan(`🔗 New connection: ${connectionId} from ${socket.remoteAddress}:${socket.remotePort}`));
    
    // Connection event handlers
    connection.on('message', (message) => {
      this._handleMessage(connection, message);
    });
    
    connection.on('close', () => {
      this.connections.delete(connectionId);
      console.log(chalk.yellow(`🔗 Connection closed: ${connectionId}`));
    });
    
    connection.on('error', (error) => {
      console.error(chalk.red(`🔗 Connection error ${connectionId}:`), error.message);
      this.connections.delete(connectionId);
    });
    
    // Start processing frames
    connection.start();
    
    this.emit('connection', connection);
  }

  /**
   * Handle incoming messages from connections
   */
  async _handleMessage(connection, message) {
    try {
      // Validate and parse message using protocol parser
      const parsedMessage = this.protocolParser.parseMessage(message);
      
      // Route message to trigger router for processing
      if (this.triggerRouter) {
        await this.triggerRouter.handleMessage(connection, parsedMessage);
      } else {
        console.warn(chalk.yellow('⚠️  No trigger router available to handle message'));
        
        // Send error response if no router available
        const errorResponse = this.protocolParser.createError(
          parsedMessage, 
          'No message router available', 
          'SERVICE_UNAVAILABLE'
        );
        connection.send(errorResponse);
      }
    } catch (error) {
      console.error(chalk.red('❌ Error handling message:'), error.message);
      
      // Send error response back to client using protocol parser
      let errorResponse;
      try {
        errorResponse = this.protocolParser.createError(
          message, 
          error, 
          'MESSAGE_PROCESSING_ERROR'
        );
      } catch (parseError) {
        // Fallback error response if message parsing failed
        errorResponse = {
          type: 'error',
          error: error.message,
          error_code: 'MESSAGE_PARSING_ERROR',
          timestamp: Date.now()
        };
      }
      
      connection.send(errorResponse);
    }
  }

  /**
   * Handle server errors
   */
  _handleServerError(error) {
    console.error(chalk.red('🔌 Transport server error:'), error.message);
    this.emit('error', error);
  }

  /**
   * Handle server close
   */
  _handleServerClose() {
    console.log(chalk.yellow('🔌 Transport server closed'));
    this.isRunning = false;
    this.emit('close');
  }

  /**
   * Load TLS certificates for secure connections
   */
  async _loadTLSCertificates() {
    // TODO: Implement TLS certificate loading
    // Load from config.dataDir or specified paths
    this.tlsOptions = {
      // key: fs.readFileSync('path/to/private-key.pem'),
      // cert: fs.readFileSync('path/to/certificate.pem'),
      // ca: fs.readFileSync('path/to/ca-certificate.pem'), // if using CA
      requestCert: false, // Set to true for mutual TLS
      rejectUnauthorized: false // Set to true in production
    };
  }

  /**
   * Get transport statistics
   */
  getStats() {
    return {
      activeConnections: this.connections.size,
      isRunning: this.isRunning,
      port: this.config.port,
      host: this.config.host,
      tlsEnabled: this.config.enableTLS
    };
  }
}

/**
 * Individual client connection handler
 */
class Connection extends EventEmitter {
  constructor(id, socket, transport) {
    super();
    this.id = id;
    this.socket = socket;
    this.transport = transport;
    
    this.buffer = Buffer.alloc(0);
    this.expectedFrameSize = null;
    this.appId = null; // Set during handshake
    this.pools = []; // Pools this connection has access to
    this.isActive = true;
  }

  /**
   * Start processing incoming data
   */
  start() {
    this.socket.on('data', this._handleData.bind(this));
    this.socket.on('close', this._handleClose.bind(this));
    this.socket.on('error', this._handleError.bind(this));
  }

  /**
   * Send a message to the client
   */
  send(message) {
    if (!this.isActive) {
      return false;
    }

    try {
      const payload = JSON.stringify(message);
      const payloadBuffer = Buffer.from(payload, 'utf8');
      const lengthBuffer = Buffer.allocUnsafe(4);
      
      lengthBuffer.writeUInt32BE(payloadBuffer.length, 0);
      
      const frame = Buffer.concat([lengthBuffer, payloadBuffer]);
      this.socket.write(frame);
      
      return true;
    } catch (error) {
      console.error(chalk.red(`❌ Error sending message to connection ${this.id}:`), error.message);
      return false;
    }
  }

  /**
   * Send binary data (for memory operations)
   */
  sendBinary(binaryData, metadata = {}) {
    if (!this.isActive) {
      return false;
    }

    try {
      // TODO: Implement binary frame format
      // Format: [4-byte length][binary_frame header JSON][binary data]
      const headerPayload = JSON.stringify({
        type: 'binary_frame',
        size: binaryData.length,
        ...metadata
      });
      
      const headerBuffer = Buffer.from(headerPayload, 'utf8');
      const headerLengthBuffer = Buffer.allocUnsafe(4);
      headerLengthBuffer.writeUInt32BE(headerBuffer.length, 0);
      
      const totalLength = 4 + headerBuffer.length + binaryData.length;
      const totalLengthBuffer = Buffer.allocUnsafe(4);
      totalLengthBuffer.writeUInt32BE(totalLength, 0);
      
      const frame = Buffer.concat([
        totalLengthBuffer,
        headerLengthBuffer,
        headerBuffer,
        binaryData
      ]);
      
      this.socket.write(frame);
      return true;
    } catch (error) {
      console.error(chalk.red(`❌ Error sending binary data to connection ${this.id}:`), error.message);
      return false;
    }
  }

  /**
   * Close the connection
   */
  close() {
    if (this.isActive) {
      this.isActive = false;
      this.socket.end();
    }
  }

  /**
   * Handle incoming data and frame parsing
   */
  _handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    
    while (this.buffer.length >= this.transport.FRAME_HEADER_SIZE) {
      // Read frame length if we don't have it yet
      if (this.expectedFrameSize === null) {
        this.expectedFrameSize = this.buffer.readUInt32BE(0);
        
        // Validate frame size
        if (this.expectedFrameSize > this.transport.MAX_FRAME_SIZE) {
          this.emit('error', new Error(`Frame size too large: ${this.expectedFrameSize}`));
          return;
        }
      }
      
      // Check if we have the complete frame
      const totalFrameSize = this.transport.FRAME_HEADER_SIZE + this.expectedFrameSize;
      if (this.buffer.length < totalFrameSize) {
        break; // Wait for more data
      }
      
      // Extract frame payload
      const framePayload = this.buffer.slice(
        this.transport.FRAME_HEADER_SIZE,
        totalFrameSize
      );
      
      // Remove processed frame from buffer
      this.buffer = this.buffer.slice(totalFrameSize);
      this.expectedFrameSize = null;
      
      // Parse and emit message
      try {
        const rawPayload = framePayload.toString('utf8');
        console.log('DEBUG: Received raw payload from client:', rawPayload);
        const message = JSON.parse(rawPayload);
        console.log('DEBUG: Successfully parsed message:', message);
        this.emit('message', message);
      } catch (error) {
        console.error('DEBUG: Failed to parse JSON frame:', error.message);
        console.error('DEBUG: Raw payload was:', framePayload.toString('utf8'));
        this.emit('error', new Error(`Invalid JSON frame: ${error.message}`));
        return;
      }
    }
  }

  /**
   * Handle connection close
   */
  _handleClose() {
    this.isActive = false;
    this.emit('close');
  }

  /**
   * Handle connection errors
   */
  _handleError(error) {
    this.isActive = false;
    this.emit('error', error);
  }
}

module.exports = Transport;