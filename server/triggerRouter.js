/**
 * LatZero Trigger Router - Request Routing & Dispatch
 *
 * This module handles the routing and dispatch of trigger requests within the
 * LatZero system. It manages trigger records for response routing, implements
 * timeout handling, and coordinates message delivery between applications.
 *
 * Key Responsibilities:
 * - Trigger request routing and target resolution
 * - Trigger record lifecycle management for response tracking
 * - Message dispatch to target applications
 * - Response routing back to originators
 * - Timeout handling and cleanup
 * - Load balancing for multiple trigger handlers
 * - Short-circuiting for intra-process calls
 *
 * Routing Logic:
 * 1. Parse incoming trigger request
 * 2. Resolve target handler(s) in specified pool
 * 3. Create trigger record for response tracking
 * 4. Dispatch to target application(s)
 * 5. Handle response and route back to originator
 * 6. Cleanup trigger record on completion/timeout
 */

const { EventEmitter } = require('events');
const chalk = require('chalk');
const { v4: uuidv4 } = require('uuid');
const { ProtocolParser, MessageTypes } = require('./protocol');

// Routing strategies
const RoutingStrategies = {
  ROUND_ROBIN: 'round_robin',
  RANDOM: 'random',
  FIRST_AVAILABLE: 'first_available',
  LOAD_BALANCED: 'load_balanced'
};

class TriggerRouter extends EventEmitter {
  constructor(config, appRegistry, poolManager, transport, persistence) {
    super();
    console.log(chalk.blue('🎯 TriggerRouter constructor called with:'));
    console.log(chalk.cyan(`   - config: ${typeof config}`));
    console.log(chalk.cyan(`   - appRegistry: ${typeof appRegistry}`));
    console.log(chalk.cyan(`   - poolManager: ${typeof poolManager}`));
    console.log(chalk.cyan(`   - transport: ${typeof transport}`));
    console.log(chalk.cyan(`   - persistence: ${typeof persistence}`));

    this.config = config;
    this.appRegistry = appRegistry;
    this.poolManager = poolManager;
    this.transport = transport;
    this.persistence = persistence;
    this.protocol = new ProtocolParser();
    
    // Active trigger records for response routing
    this.triggerRecords = new Map(); // triggerId -> TriggerRecord
    
    // Routing statistics
    this.stats = {
      totalTriggers: 0,
      successfulTriggers: 0,
      failedTriggers: 0,
      timeoutTriggers: 0,
      averageResponseTime: 0,
      shortCircuitedCalls: 0
    };
    
    // Routing configuration
    this.defaultTTL = config.triggers?.defaultTTL || 30000; // 30 seconds
    this.maxConcurrentTriggers = config.triggers?.maxConcurrentTriggers || 10000;
    this.cleanupInterval = config.triggers?.cleanupInterval || 60000; // 1 minute
    this.defaultRoutingStrategy = RoutingStrategies.ROUND_ROBIN;
    
    // Round-robin counters for load balancing
    this.roundRobinCounters = new Map(); // triggerName -> counter
    
    // Cleanup interval for expired trigger records
    this.cleanupTimer = null;
    
    // Initialization state
    this.isInitialized = false;
  }

  /**
   * Initialize the trigger router
   */
  async initialize() {
    console.log(chalk.blue('🎯 Initializing Trigger Router...'));
    
    if (this.isInitialized) {
      console.log(chalk.yellow('⚠️  Trigger Router already initialized'));
      return;
    }
    
    // Validate dependencies
    console.log(chalk.blue('🎯 Validating TriggerRouter dependencies:'));
    console.log(chalk.cyan(`   - appRegistry: ${this.appRegistry ? 'PRESENT' : 'MISSING'}`));
    console.log(chalk.cyan(`   - poolManager: ${this.poolManager ? 'PRESENT' : 'MISSING'}`));
    console.log(chalk.cyan(`   - transport: ${this.transport ? 'PRESENT' : 'MISSING'}`));
    console.log(chalk.cyan(`   - persistence: ${this.persistence ? 'PRESENT' : 'MISSING'}`));

    if (!this.appRegistry) {
      throw new Error('AppRegistry is required for TriggerRouter');
    }
    if (!this.poolManager) {
      throw new Error('PoolManager is required for TriggerRouter');
    }
    if (!this.persistence) {
      throw new Error('Persistence is required for TriggerRouter');
    }

    // Transport is optional during initialization - can be set later
    if (!this.transport) {
      console.log(chalk.yellow('⚠️  Transport not available during initialization - will be set later'));
    }
    
    // Setup cleanup interval for expired trigger records
    this._setupCleanupInterval();
    
    // Setup event listeners for app registry events
    this._setupEventListeners();
    
    this.isInitialized = true;
    console.log(chalk.green('✅ Trigger Router initialized'));
    console.log(chalk.cyan(`🎯 Default TTL: ${this.defaultTTL}ms`));
    console.log(chalk.cyan(`🎯 Max concurrent triggers: ${this.maxConcurrentTriggers}`));
    console.log(chalk.cyan(`🎯 Cleanup interval: ${this.cleanupInterval}ms`));
  }

  /**
   * Set transport reference after initialization
   */
  setTransport(transport) {
    console.log(chalk.blue('🎯 Setting transport reference on TriggerRouter'));
    this.transport = transport;
  }

  /**
   * Shutdown the trigger router
   */
  async shutdown() {
    console.log(chalk.yellow('🎯 Shutting down Trigger Router...'));
    
    if (!this.isInitialized) {
      console.log(chalk.yellow('⚠️  Trigger Router not initialized'));
      return;
    }
    
    // Clear cleanup interval
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Cleanup all pending trigger records
    const pendingRecords = Array.from(this.triggerRecords.values());
    console.log(chalk.yellow(`🎯 Cleaning up ${pendingRecords.length} pending trigger records...`));
    
    for (const record of pendingRecords) {
      await this._timeoutTriggerRecord(record);
    }
    
    this.triggerRecords.clear();
    this.roundRobinCounters.clear();
    
    this.isInitialized = false;
    console.log(chalk.green('✅ Trigger Router shutdown complete'));
  }

  /**
   * Handle incoming messages from transport layer
   */
  async handleMessage(connection, message) {
    if (!this.isInitialized) {
      throw new Error('TriggerRouter not initialized');
    }

    if (!this.transport) {
      console.warn(chalk.yellow('⚠️  TriggerRouter received message but transport is not available'));
      throw new Error('Transport not available for message handling');
    }

    try {
      // Validate message structure
      this.protocol.validateMessage(message);
      
      // Extract routing metadata
      const routing = this.protocol.extractRoutingMetadata(message);
      
      // Route based on message type
      console.log(chalk.cyan(`📨 DEBUG: Received message type '${message.type}' from connection ${connection.id}, message id: ${message.id}`));
      switch (message.type) {
        case MessageTypes.HANDSHAKE:
          return await this._handleHandshake(connection, message);

        case MessageTypes.TRIGGER:
          return await this.handleTriggerRequest(message, connection);

        case MessageTypes.RESPONSE:
          return await this.handleTriggerResponse(message, connection);

        case MessageTypes.EMIT:
          return await this._handleEmit(connection, message);

        case MessageTypes.ERROR:
          return await this._handleError(connection, message);

        default:
          console.warn(chalk.yellow(`⚠️  Unhandled message type: ${message.type}`));
          
          // Send error response for unknown message types
          const errorResponse = this.protocol.createError(
            message,
            `Unknown message type: ${message.type}`,
            'UNKNOWN_MESSAGE_TYPE'
          );
          connection.send(errorResponse);
          break;
      }
    } catch (error) {
      console.error(chalk.red('❌ Error handling message:'), error.message);
      
      // Emit routing error event
      this.emit('routing_error', {
        error: error.message,
        message: message,
        connection: connection.id
      });
      
      // Send error response if possible
      if (this.protocol.requiresResponse(message)) {
        const errorResponse = this.protocol.createError(message, error, 'MESSAGE_PROCESSING_ERROR');
        connection.send(errorResponse);
      }
      
      this.stats.failedTriggers++;
      throw error;
    }
  }

  /**
   * Route trigger message to appropriate destination
   */
   async routeTrigger(triggerMessage) {
     if (!triggerMessage || !triggerMessage.trigger) {
       throw new Error('Invalid trigger message: missing trigger name');
     }

     const triggerName = triggerMessage.trigger;
     const poolName = triggerMessage.pool || 'default';

     console.log(chalk.cyan(`🎯 Routing trigger: ${triggerName} in pool: ${poolName}`));

     // Check for explicit destination
     if (triggerMessage.destination) {
       console.log(chalk.cyan(`🎯 Explicit destination specified: ${triggerMessage.destination}`));

       // Get destination app
       const destinationApp = this.appRegistry.getApp(triggerMessage.destination);
       if (!destinationApp) {
         throw new Error(`Destination app '${triggerMessage.destination}' not found`);
       }

       // Validate destination can handle the trigger
       const destinationTriggers = this.appRegistry.getAppTriggers(triggerMessage.destination);
       if (!destinationTriggers.includes(triggerName)) {
         throw new Error(`Destination app '${triggerMessage.destination}' cannot handle trigger '${triggerName}'`);
       }

       // Validate pool membership
       if (!this.poolManager.validatePoolMembership(triggerMessage.destination, poolName)) {
         throw new Error(`Destination app '${triggerMessage.destination}' is not a member of pool '${poolName}'`);
       }

       // Check if active
       if (!destinationApp.isActive()) {
         throw new Error(`Destination app '${triggerMessage.destination}' is not active`);
       }

       // Validate routing permissions
       await this.validateRouting(triggerMessage.origin, triggerMessage.destination, triggerName);

       // Check for local optimization
       const optimized = await this.optimizeLocalRouting(triggerMessage.origin, triggerMessage.destination);

       if (optimized) {
         this.stats.shortCircuitedCalls++;
         console.log(chalk.blue(`🔄 Short-circuited local call for trigger: ${triggerName}`));
       }

       return {
         destination: destinationApp,
         handlers: [destinationApp],
         optimized: optimized
       };
     }

     // Find handlers for the trigger
     const handlers = await this.findTriggerHandlers(triggerName, poolName);

     if (handlers.length === 0) {
       throw new Error(`No handlers found for trigger: ${triggerName} in pool: ${poolName}`);
     }

     // Select destination using routing strategy
     const destination = await this.selectDestination(handlers, this.defaultRoutingStrategy);

     if (!destination) {
       throw new Error(`No available destination for trigger: ${triggerName}`);
     }

     // Validate routing permissions
     await this.validateRouting(triggerMessage.origin, destination.appId, triggerName);

     // Check for local optimization
     const optimized = await this.optimizeLocalRouting(triggerMessage.origin, destination.appId);

     if (optimized) {
       this.stats.shortCircuitedCalls++;
       console.log(chalk.blue(`🔄 Short-circuited local call for trigger: ${triggerName}`));
     }

     return {
       destination: destination,
       handlers: handlers,
       optimized: optimized
     };
   }

  /**
   * Route response back to origin
   */
  async routeResponse(responseMessage) {
    if (!responseMessage || !responseMessage.id) {
      throw new Error('Invalid response message: missing correlation ID');
    }

    const triggerId = responseMessage.id;
    
    // Find return path for the response
    const returnPath = await this.traceReturnPath(triggerId);
    
    if (!returnPath) {
      throw new Error(`No return path found for trigger: ${triggerId}`);
    }

    console.log(chalk.green(`🎯 Routing response for trigger: ${triggerId} back to: ${returnPath.origin}`));

    // Send response back to origin
    await this.sendResponse(triggerId, responseMessage.result, responseMessage.error);

    return returnPath;
  }

  /**
   * Handle trigger requests
   */
  async handleTriggerRequest(message, connection) {
    const startTime = Date.now();
    this.stats.totalTriggers++;
    
    try {
      // Check concurrent trigger limit
      if (this.triggerRecords.size >= this.maxConcurrentTriggers) {
        throw new Error(`Maximum concurrent triggers exceeded: ${this.maxConcurrentTriggers}`);
      }

      const triggerName = message.trigger || message.process; // Support both formats
      const triggerId = message.id;
      
      console.log(chalk.cyan(`🎯 Handling trigger request: ${triggerName} (${triggerId})`));
      
      // Get origin app from connection
      const originApp = this.appRegistry.getAppByConnection(connection.id);
      if (!originApp) {
        throw new Error('Origin application not registered');
      }

      // Determine target pool
      const poolName = message.pool || 'default';
      const pool = await this.poolManager.getPool(poolName);
      
      if (!pool) {
        throw new Error(`Pool '${poolName}' not found`);
      }

      // Validate pool membership
      console.log(chalk.cyan(`🔍 TriggerRouter checking pool membership for app ${originApp.appId} in pool ${poolName}`));
      const isPoolMember = this.poolManager.validatePoolMembership(originApp.appId, poolName);
      console.log(chalk.cyan(`🔍 TriggerRouter pool membership result: ${isPoolMember} for app ${originApp.appId} in pool ${poolName}`));
      if (!isPoolMember) {
        throw new Error(`App '${originApp.appId}' is not a member of pool '${poolName}'`);
      }

      // Set origin in message for routing
      message.origin = originApp.appId;

      // Route to selected handler
      const routingResult = await this.routeTrigger(message);

      // Create trigger record for response tracking
      const triggerRecord = await this.createTriggerRecord(
        triggerId,
        originApp.appId,
        message.destination,
        {
          pool: poolName,
          trigger: triggerName,
          handlers: routingResult.handlers.map(h => h.appId),
          created: startTime,
          ttl: message.ttl || this.defaultTTL,
          originalMessage: message,
          originConnection: connection
        }
      );
      
      // Dispatch to target handler
      await this._dispatchTrigger(triggerRecord, [routingResult.destination]);
      
      // Set timeout for cleanup
      this._setTriggerTimeout(triggerRecord);
      
      // Emit routing event
      this.emit('trigger_routed', {
        triggerId: triggerId,
        trigger: triggerName,
        origin: originApp.appId,
        destination: routingResult.destination.appId,
        pool: poolName,
        optimized: routingResult.optimized
      });
      
    } catch (error) {
      console.error(chalk.red(`❌ Error handling trigger request ${message.id}:`), error.message);
      
      const errorResponse = this.protocol.createError(message, error, 'TRIGGER_ROUTING_ERROR');
      connection.send(errorResponse);
      
      this.stats.failedTriggers++;
      this.emit('routing_error', {
        error: error.message,
        trigger: message.trigger || message.process,
        origin: message.origin,
        triggerId: message.id
      });
    }
  }

  /**
   * Handle trigger responses
   */
  async handleTriggerResponse(message, connection) {
    const triggerId = message.in_reply_to || message.correlation_id;
    
    if (!triggerId) {
      console.warn(chalk.yellow('⚠️  Response message missing correlation ID'));
      return;
    }

    const triggerRecord = this.triggerRecords.get(triggerId);
    
    if (!triggerRecord) {
      console.warn(chalk.yellow(`⚠️  No trigger record found for response: ${triggerId}`));
      return;
    }
    
    console.log(chalk.green(`🎯 Handling trigger response for: ${triggerId}`));
    
    try {
      // Route response back to originator
      await this._routeResponse(triggerRecord, message);
      
      // Update statistics
      const responseTime = Date.now() - triggerRecord.created;
      this._updateResponseTimeStats(responseTime);
      this.stats.successfulTriggers++;
      
      // Emit response routed event
      this.emit('response_routed', {
        triggerId: triggerId,
        origin: triggerRecord.originAppId,
        responseTime: responseTime,
        status: message.status
      });
      
      // Cleanup trigger record
      this._cleanupTriggerRecord(triggerId);
      
    } catch (error) {
      console.error(chalk.red(`❌ Error handling trigger response for ${triggerId}:`), error.message);
      this.stats.failedTriggers++;
      
      this.emit('routing_error', {
        error: error.message,
        triggerId: triggerId,
        type: 'response_routing'
      });
    }
  }

  /**
   * Handle handshake messages
   */
  async _handleHandshake(connection, message) {
    return await this.appRegistry.processHandshake(message, connection);
  }

  /**
   * Handle trigger requests
   */
  async _handleTrigger(connection, message) {
    const startTime = Date.now();
    this.stats.totalTriggers++;
    
    try {
      console.log(chalk.cyan(`🎯 Routing trigger: ${message.process} (${message.id})`));
      
      // Validate trigger message
      this.protocol.validateMessage(message);
      
      // Determine target pool
      const poolName = message.pool || 'default';
      const pool = this.poolManager.getPool(poolName);
      
      if (!pool) {
        throw new Error(`Pool '${poolName}' not found`);
      }
      
      // Find handlers for the trigger
      const handlers = this.appRegistry.getTriggersHandlers(message.process);
      
      if (handlers.length === 0) {
        const errorResponse = this.protocol.createNotFoundError(message, message.process);
        connection.send(errorResponse);
        this.stats.failedTriggers++;
        return;
      }
      
      // Create trigger record for response tracking
      const triggerRecord = new TriggerRecord(message, connection, {
        pool: poolName,
        handlers: handlers.map(h => h.appId),
        created: startTime,
        ttl: message.ttl || this.config.defaultTriggerTTL || 30000
      });
      
      this.triggerRecords.set(message.id, triggerRecord);
      
      // Route to handler(s)
      await this._dispatchTrigger(triggerRecord, handlers);
      
      // Set timeout for cleanup
      this._setTriggerTimeout(triggerRecord);
      
    } catch (error) {
      console.error(chalk.red(`❌ Error routing trigger ${message.id}:`), error.message);
      
      const errorResponse = this.protocol.createError(message, error);
      connection.send(errorResponse);
      
      this.stats.failedTriggers++;
    }
  }

  /**
   * Handle response messages
   */
  async _handleResponse(connection, message) {
    const triggerRecord = this.triggerRecords.get(message.in_reply_to);
    
    if (!triggerRecord) {
      console.warn(chalk.yellow(`⚠️  No trigger record found for response: ${message.in_reply_to}`));
      return;
    }
    
    console.log(chalk.green(`🎯 Received response for trigger: ${message.in_reply_to}`));
    
    try {
      // Route response back to originator or specified destination
      await this._routeResponse(triggerRecord, message);
      
      // Update statistics
      const responseTime = Date.now() - triggerRecord.created;
      this._updateResponseTimeStats(responseTime);
      this.stats.successfulTriggers++;
      
      // Cleanup trigger record
      this._cleanupTriggerRecord(triggerRecord.id);
      
    } catch (error) {
      console.error(chalk.red(`❌ Error routing response for ${message.in_reply_to}:`), error.message);
      this.stats.failedTriggers++;
    }
  }

  /**
   * Handle emit messages (fire-and-forget)
   */
  async _handleEmit(connection, message) {
    console.log(chalk.cyan(`🎯 Routing emit: ${message.process}`));
    
    try {
      // Similar to trigger but no response expected
      const poolName = message.pool || 'default';
      const handlers = this.appRegistry.getTriggersHandlers(message.process);
      
      if (handlers.length === 0) {
        console.warn(chalk.yellow(`⚠️  No handlers found for emit: ${message.process}`));
        return;
      }
      
      // Dispatch to all handlers (no response tracking)
      for (const handler of handlers) {
        if (handler.isActive()) {
          handler.send(message);
        }
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ Error routing emit ${message.process}:`), error.message);
    }
  }

  /**
   * Handle error messages
   */
  async _handleError(connection, message) {
    if (message.in_reply_to) {
      const triggerRecord = this.triggerRecords.get(message.in_reply_to);
      if (triggerRecord) {
        // Route error back to originator
        await this._routeResponse(triggerRecord, message);
        this._cleanupTriggerRecord(triggerRecord.id);
        this.stats.failedTriggers++;
      }
    }
  }

  /**
   * Dispatch trigger to target handlers
   */
  async _dispatchTrigger(triggerRecord, handlers) {
    const message = triggerRecord.originalMessage;
    
    // TODO: Implement load balancing strategy
    const targetHandler = this._selectHandler(handlers, message);
    
    if (!targetHandler || !targetHandler.isActive()) {
      throw new Error(`No active handler available for trigger: ${message.process}`);
    }
    
    // Check for short-circuiting (intra-process call)
    const originApp = this.appRegistry.getAppByConnection(triggerRecord.originConnection.id);
    console.log(chalk.cyan(`🔍 DEBUG: Dispatch check - originApp: ${originApp?.appId}, targetHandler: ${targetHandler.appId}, same? ${originApp?.appId === targetHandler.appId}`));
    if (originApp && originApp.appId === targetHandler.appId) {
      console.log(chalk.blue(`🔄 Short-circuiting intra-process call detected: ${message.process} (origin: ${originApp.appId}, target: ${targetHandler.appId})`));

      // For now, prevent the problematic dispatch and send a proper error response
      // TODO: Implement full short-circuit logic to call local handlers directly
      console.log(chalk.yellow(`⚠️  Intra-process short-circuiting not yet implemented - sending error response`));

      const errorResponse = this.protocol.createError(message, 'Intra-process trigger calls not yet supported', 'SHORT_CIRCUIT_NOT_IMPLEMENTED');
      if (triggerRecord.originConnection && triggerRecord.originConnection.isActive) {
        triggerRecord.originConnection.send(errorResponse);
      }

      // Update statistics and cleanup
      this.stats.failedTriggers++;
      this._cleanupTriggerRecord(triggerRecord.id);

      // Emit routing error event
      this.emit('routing_error', {
        error: 'Intra-process short-circuiting not implemented',
        trigger: message.process,
        origin: originApp.appId,
        triggerId: message.id
      });

      return; // Don't continue with dispatch
    }
    
    // Dispatch message to target handler
    console.log(chalk.cyan(`📤 DEBUG: About to send message type '${message.type}' from ${originApp?.appId} to ${targetHandler.appId}`));
    const success = targetHandler.send(message);

    if (!success) {
      throw new Error(`Failed to dispatch trigger to handler: ${targetHandler.appId}`);
    }

    triggerRecord.dispatchedTo = targetHandler.appId;
    triggerRecord.dispatched = Date.now();

    console.log(chalk.green(`🎯 Dispatched trigger ${message.id} to ${targetHandler.appId}`));
  }

  /**
   * Route response back to originator or destination
   */
  async _routeResponse(triggerRecord, responseMessage) {
    const originalMessage = triggerRecord.originalMessage;
    
    // Determine response destination
    let targetConnection;
    
    if (originalMessage.destination) {
      // Explicit destination specified
      const targetApp = this.appRegistry.getApp(originalMessage.destination);
      if (targetApp && targetApp.isActive()) {
        targetConnection = targetApp.connection;
      } else {
        throw new Error(`Destination app '${originalMessage.destination}' not found or inactive`);
      }
    } else {
      // Route back to originator
      targetConnection = triggerRecord.originConnection;
    }
    
    if (!targetConnection || !targetConnection.isActive) {
      throw new Error('Target connection for response is not active');
    }
    
    // Send response
    const success = targetConnection.send(responseMessage);
    
    if (!success) {
      throw new Error('Failed to send response to target connection');
    }
    
    console.log(chalk.green(`🎯 Routed response for trigger ${triggerRecord.id}`));
  }

  /**
   * Select handler using load balancing strategy
   */
  _selectHandler(handlers, message) {
    if (handlers.length === 0) {
      return null;
    }
    
    if (handlers.length === 1) {
      return handlers[0];
    }
    
    // TODO: Implement sophisticated load balancing
    // For now, use round-robin or random selection
    const activeHandlers = handlers.filter(h => h.isActive());
    
    if (activeHandlers.length === 0) {
      return null;
    }
    
    // Simple random selection
    const randomIndex = Math.floor(Math.random() * activeHandlers.length);
    return activeHandlers[randomIndex];
  }

  /**
   * Set timeout for trigger record cleanup
   */
  _setTriggerTimeout(triggerRecord) {
    const timeoutId = setTimeout(() => {
      this._timeoutTriggerRecord(triggerRecord);
    }, triggerRecord.ttl);
    
    triggerRecord.timeoutId = timeoutId;
  }

  /**
   * Handle trigger record timeout
   */
  async _timeoutTriggerRecord(triggerRecord) {
    console.warn(chalk.yellow(`⏰ Trigger timeout: ${triggerRecord.id}`));
    
    // Send timeout error to originator
    const timeoutError = this.protocol.createTimeoutError(triggerRecord.originalMessage);
    
    if (triggerRecord.originConnection && triggerRecord.originConnection.isActive) {
      triggerRecord.originConnection.send(timeoutError);
    }
    
    // Update statistics
    this.stats.timeoutTriggers++;
    
    // Cleanup
    this._cleanupTriggerRecord(triggerRecord.id);
  }

  /**
   * Cleanup trigger record
   */
  _cleanupTriggerRecord(triggerId) {
    const record = this.triggerRecords.get(triggerId);
    if (record) {
      if (record.timeoutId) {
        clearTimeout(record.timeoutId);
      }
      this.triggerRecords.delete(triggerId);
    }
  }

  /**
   * Setup cleanup interval for expired records
   */
  _setupCleanupInterval() {
    const interval = this.config.triggerCleanupInterval || 60000; // 1 minute
    
    this.cleanupInterval = setInterval(() => {
      this._cleanupExpiredRecords();
    }, interval);
  }

  /**
   * Cleanup expired trigger records
   */
  _cleanupExpiredRecords() {
    const now = Date.now();
    const expiredRecords = [];
    
    for (const record of this.triggerRecords.values()) {
      if (now - record.created > record.ttl) {
        expiredRecords.push(record);
      }
    }
    
    for (const record of expiredRecords) {
      this._timeoutTriggerRecord(record);
    }
    
    if (expiredRecords.length > 0) {
      console.log(chalk.yellow(`🧹 Cleaned up ${expiredRecords.length} expired trigger records`));
    }
  }

  /**
   * Update response time statistics
   */
  _updateResponseTimeStats(responseTime) {
    // Simple moving average calculation
    const alpha = 0.1; // Smoothing factor
    this.stats.averageResponseTime = 
      (alpha * responseTime) + ((1 - alpha) * this.stats.averageResponseTime);
  }

  /**
   * Get router statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeTriggerRecords: this.triggerRecords.size,
      successRate: this.stats.totalTriggers > 0 
        ? (this.stats.successfulTriggers / this.stats.totalTriggers) * 100 
        : 0
    };
  }

  /**
   * List active trigger records (for debugging)
   */
  listActiveTriggers() {
    return Array.from(this.triggerRecords.values()).map(record => ({
      id: record.id,
      process: record.originalMessage.process,
      pool: record.pool,
      created: record.created,
      ttl: record.ttl,
      dispatchedTo: record.dispatchedTo,
      age: Date.now() - record.created
    }));
  }

  // ==========================================
  // Trigger Record Management
  // ==========================================

  /**
   * Create a new trigger record
   */
  async createTriggerRecord(id, origin, destination, metadata = {}) {
    if (!id || !origin) {
      throw new Error('Trigger record requires id and origin');
    }

    if (this.triggerRecords.has(id)) {
      throw new Error(`Trigger record with id '${id}' already exists`);
    }

    const record = new TriggerRecord(metadata.originalMessage, metadata.originConnection, {
      ...metadata,
      id: id,
      origin: origin,
      destination: destination,
      created: metadata.created || Date.now(),
      ttl: metadata.ttl || this.defaultTTL
    });

    // Store in memory
    this.triggerRecords.set(id, record);

    // Store in persistence for recovery
    if (this.persistence) {
      try {
        await this.persistence.createTriggerRecord({
          id: id,
          originAppId: origin,
          originConnectionId: metadata.originConnection?.id,
          destination: destination,
          pool: metadata.pool || 'default',
          process: metadata.trigger,
          created: record.created,
          ttl: record.ttl,
          dispatchedTo: null,
          completed: false
        });
      } catch (error) {
        console.warn(chalk.yellow(`⚠️  Failed to persist trigger record ${id}:`), error.message);
      }
    }

    // Emit record created event
    this.emit('record_created', {
      id: id,
      origin: origin,
      destination: destination,
      pool: metadata.pool,
      trigger: metadata.trigger
    });

    console.log(chalk.blue(`📝 Created trigger record: ${id}`));
    return record;
  }

  /**
   * Get trigger record by ID
   */
  getTriggerRecord(id) {
    return this.triggerRecords.get(id);
  }

  /**
   * Update trigger record
   */
  async updateTriggerRecord(id, updates) {
    const record = this.triggerRecords.get(id);
    if (!record) {
      throw new Error(`Trigger record '${id}' not found`);
    }

    // Update record properties
    Object.assign(record, updates);

    // Update in persistence
    if (this.persistence) {
      try {
        await this.persistence.updateTriggerRecord(id, {
          dispatchedTo: record.dispatchedTo,
          completed: record.completed
        });
      } catch (error) {
        console.warn(chalk.yellow(`⚠️  Failed to update trigger record ${id}:`), error.message);
      }
    }

    return record;
  }

  /**
   * Remove trigger record
   */
  async removeTriggerRecord(id) {
    const record = this.triggerRecords.get(id);
    if (!record) {
      return false;
    }

    // Clear timeout if set
    if (record.timeoutId) {
      clearTimeout(record.timeoutId);
    }

    // Remove from memory
    this.triggerRecords.delete(id);

    // Remove from persistence
    if (this.persistence) {
      try {
        await this.persistence.deleteTriggerRecord(id);
      } catch (error) {
        console.warn(chalk.yellow(`⚠️  Failed to delete trigger record ${id}:`), error.message);
      }
    }

    console.log(chalk.blue(`🗑️  Removed trigger record: ${id}`));
    return true;
  }

  /**
   * Cleanup expired trigger records
   */
  async cleanupExpiredRecords() {
    const now = Date.now();
    const expiredRecords = [];

    for (const record of this.triggerRecords.values()) {
      if (record.isExpired()) {
        expiredRecords.push(record);
      }
    }

    for (const record of expiredRecords) {
      await this._timeoutTriggerRecord(record);
      this.emit('record_expired', {
        id: record.id,
        age: record.getAge(),
        ttl: record.ttl
      });
    }

    // Also cleanup from persistence
    if (this.persistence) {
      try {
        const cleanedCount = await this.persistence.cleanupExpiredTriggerRecords();
        if (cleanedCount > 0) {
          console.log(chalk.yellow(`🧹 Cleaned up ${cleanedCount} expired records from persistence`));
        }
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Failed to cleanup expired records from persistence:'), error.message);
      }
    }

    return expiredRecords.length;
  }

  // ==========================================
  // Routing Logic
  // ==========================================

  /**
   * Find applications that can handle a specific trigger
   */
  async findTriggerHandlers(triggerName, poolName = 'default') {
    if (!triggerName) {
      throw new Error('Trigger name is required');
    }

    console.log(chalk.cyan(`🔍 Finding handlers for trigger: ${triggerName} in pool: ${poolName}`));

    // Get handlers from app registry
    const handlers = this.appRegistry.getTriggersHandlers(triggerName);
    
    // Filter by pool membership
    const poolHandlers = [];
    for (const handler of handlers) {
      if (this.poolManager.validatePoolMembership(handler.appId, poolName)) {
        poolHandlers.push(handler);
      }
    }

    console.log(chalk.cyan(`🔍 Found ${poolHandlers.length} handlers for ${triggerName} in pool ${poolName}`));
    return poolHandlers;
  }

  /**
   * Select destination from available handlers using routing strategy
   */
  async selectDestination(handlers, routingStrategy = RoutingStrategies.ROUND_ROBIN) {
    if (!handlers || handlers.length === 0) {
      return null;
    }

    // Filter active handlers
    const activeHandlers = handlers.filter(h => h.isActive());
    if (activeHandlers.length === 0) {
      return null;
    }

    if (activeHandlers.length === 1) {
      return activeHandlers[0];
    }

    let selectedHandler;

    switch (routingStrategy) {
      case RoutingStrategies.ROUND_ROBIN:
        selectedHandler = this._selectRoundRobin(activeHandlers);
        break;
        
      case RoutingStrategies.RANDOM:
        selectedHandler = this._selectRandom(activeHandlers);
        break;
        
      case RoutingStrategies.FIRST_AVAILABLE:
        selectedHandler = activeHandlers[0];
        break;
        
      case RoutingStrategies.LOAD_BALANCED:
        selectedHandler = this._selectLoadBalanced(activeHandlers);
        break;
        
      default:
        selectedHandler = this._selectRandom(activeHandlers);
    }

    console.log(chalk.green(`🎯 Selected handler: ${selectedHandler.appId} using ${routingStrategy} strategy`));
    return selectedHandler;
  }

  /**
   * Validate routing permissions
   */
  async validateRouting(origin, destination, triggerName) {
    if (!origin || !destination || !triggerName) {
      throw new Error('Origin, destination, and trigger name are required for routing validation');
    }

    // Get origin app
    const originApp = this.appRegistry.getApp(origin);
    if (!originApp) {
      throw new Error(`Origin app '${origin}' not found`);
    }

    // Get destination app
    const destinationApp = this.appRegistry.getApp(destination);
    if (!destinationApp) {
      throw new Error(`Destination app '${destination}' not found`);
    }

    // Check if destination app can handle the trigger
    const destinationTriggers = this.appRegistry.getAppTriggers(destination);
    if (!destinationTriggers.includes(triggerName)) {
      throw new Error(`Destination app '${destination}' cannot handle trigger '${triggerName}'`);
    }

    // Check pool membership compatibility
    const originPools = this.poolManager.getAppPools(origin);
    const destinationPools = this.poolManager.getAppPools(destination);
    
    const commonPools = originPools.filter(pool => destinationPools.includes(pool));
    if (commonPools.length === 0) {
      throw new Error(`No common pools between origin '${origin}' and destination '${destination}'`);
    }

    console.log(chalk.green(`✅ Routing validation passed: ${origin} -> ${destination} for ${triggerName}`));
    return true;
  }

  /**
   * Optimize local routing for intra-process calls
   */
  async optimizeLocalRouting(origin, destination) {
    if (!origin || !destination) {
      return false;
    }

    // Check if both apps are in the same process (same connection)
    const originApp = this.appRegistry.getApp(origin);
    const destinationApp = this.appRegistry.getApp(destination);

    if (!originApp || !destinationApp) {
      return false;
    }

    // Simple optimization: same connection ID indicates same process
    const sameProcess = originApp.connection?.id === destinationApp.connection?.id;
    
    if (sameProcess) {
      console.log(chalk.blue(`🔄 Local routing optimization available: ${origin} -> ${destination}`));
      return true;
    }

    return false;
  }

  // ==========================================
  // Response Handling
  // ==========================================

  /**
   * Trace return path for response routing
   */
  async traceReturnPath(triggerId) {
    const record = this.triggerRecords.get(triggerId);
    if (!record) {
      return null;
    }

    return {
      triggerId: triggerId,
      origin: record.originAppId || record.origin,
      connection: record.originConnection,
      created: record.created,
      ttl: record.ttl
    };
  }

  /**
   * Send response back to origin
   */
  async sendResponse(triggerId, result, error = null) {
    const record = this.triggerRecords.get(triggerId);
    if (!record) {
      throw new Error(`No trigger record found for response: ${triggerId}`);
    }

    const responseMessage = this.protocol.createResponse(
      record.originalMessage,
      result,
      error ? 'error' : 'success'
    );

    if (error) {
      responseMessage.error = error;
    }

    // Route response back to originator
    await this._routeResponse(record, responseMessage);

    console.log(chalk.green(`📤 Sent response for trigger: ${triggerId}`));
    return true;
  }

  /**
   * Handle request timeout
   */
  async handleTimeout(triggerId) {
    const record = this.triggerRecords.get(triggerId);
    if (!record) {
      return;
    }

    console.warn(chalk.yellow(`⏰ Handling timeout for trigger: ${triggerId}`));

    // Send timeout error response
    const timeoutError = this.protocol.createTimeoutError(record.originalMessage);
    
    if (record.originConnection && record.originConnection.isActive) {
      record.originConnection.send(timeoutError);
    }

    // Update statistics
    this.stats.timeoutTriggers++;

    // Emit timeout event
    this.emit('trigger_timeout', {
      triggerId: triggerId,
      age: record.getAge(),
      ttl: record.ttl
    });

    // Cleanup record
    await this.removeTriggerRecord(triggerId);
  }

  /**
   * Generate error response for failed routing
   */
  generateErrorResponse(triggerId, error) {
    const record = this.triggerRecords.get(triggerId);
    if (!record) {
      return null;
    }

    return this.protocol.createError(
      record.originalMessage,
      error,
      'ROUTING_ERROR'
    );
  }

  // ==========================================
  // Load Balancing Strategies
  // ==========================================

  /**
   * Round-robin selection
   */
  _selectRoundRobin(handlers) {
    const triggerName = handlers[0]?.triggers?.[0] || 'default';
    
    if (!this.roundRobinCounters.has(triggerName)) {
      this.roundRobinCounters.set(triggerName, 0);
    }

    const counter = this.roundRobinCounters.get(triggerName);
    const selectedHandler = handlers[counter % handlers.length];
    
    this.roundRobinCounters.set(triggerName, counter + 1);
    return selectedHandler;
  }

  /**
   * Random selection
   */
  _selectRandom(handlers) {
    const randomIndex = Math.floor(Math.random() * handlers.length);
    return handlers[randomIndex];
  }

  /**
   * Load-balanced selection (simple implementation)
   */
  _selectLoadBalanced(handlers) {
    // For now, use round-robin as load balancing
    // In the future, this could consider actual load metrics
    return this._selectRoundRobin(handlers);
  }

  // ==========================================
  // Event System Setup
  // ==========================================

  /**
   * Setup event listeners for integration
   */
  _setupEventListeners() {
    // Listen to app registry events
    if (this.appRegistry) {
      this.appRegistry.on('app_disconnected', (appId) => {
        this._handleAppDisconnection(appId);
      });

      this.appRegistry.on('app_removed', (appId) => {
        this._handleAppRemoval(appId);
      });
    }

    // Listen to pool manager events
    if (this.poolManager) {
      this.poolManager.on('app_left_pool', (appId, poolName) => {
        this._handlePoolMembershipChange(appId, poolName, 'left');
      });
    }
  }

  /**
   * Handle application disconnection
   */
  _handleAppDisconnection(appId) {
    console.log(chalk.yellow(`🔌 Handling disconnection of app: ${appId}`));
    
    // Find and timeout any pending triggers from this app
    const pendingTriggers = Array.from(this.triggerRecords.values())
      .filter(record => record.originAppId === appId || record.origin === appId);

    for (const record of pendingTriggers) {
      this._timeoutTriggerRecord(record);
    }
  }

  /**
   * Handle application removal
   */
  _handleAppRemoval(appId) {
    console.log(chalk.yellow(`🗑️  Handling removal of app: ${appId}`));
    this._handleAppDisconnection(appId); // Same cleanup logic
  }

  /**
   * Handle pool membership changes
   */
  _handlePoolMembershipChange(appId, poolName, action) {
    console.log(chalk.cyan(`🏊 App ${appId} ${action} pool ${poolName}`));
    
    if (action === 'left') {
      // Check if any pending triggers are affected
      const affectedTriggers = Array.from(this.triggerRecords.values())
        .filter(record => record.pool === poolName &&
                (record.originAppId === appId || record.dispatchedTo === appId));

      for (const record of affectedTriggers) {
        console.warn(chalk.yellow(`⚠️  Trigger ${record.id} affected by pool membership change`));
      }
    }
  }
}

/**
 * Trigger record for tracking in-flight requests
 */
class TriggerRecord {
  constructor(originalMessage, originConnection, options = {}) {
    this.id = originalMessage.id;
    this.originalMessage = originalMessage;
    this.originConnection = originConnection;
    this.pool = options.pool;
    this.handlers = options.handlers || [];
    this.created = options.created || Date.now();
    this.ttl = options.ttl || 30000;
    
    this.dispatched = null;
    this.dispatchedTo = null;
    this.timeoutId = null;
    this.completed = false;
  }

  /**
   * Mark record as completed
   */
  complete() {
    this.completed = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Check if record is expired
   */
  isExpired() {
    return Date.now() - this.created > this.ttl;
  }

  /**
   * Get record age in milliseconds
   */
  getAge() {
    return Date.now() - this.created;
  }
}

module.exports = { TriggerRouter, TriggerRecord };