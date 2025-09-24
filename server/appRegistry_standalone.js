/**
 * LatZero App Registry - Standalone Version for Testing
 * 
 * This is a standalone version that doesn't require external dependencies
 * for testing purposes.
 */

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

// Simple chalk replacement
const chalk = {
  blue: (text) => `[BLUE] ${text}`,
  green: (text) => `[GREEN] ${text}`,
  yellow: (text) => `[YELLOW] ${text}`,
  red: (text) => `[RED] ${text}`,
  cyan: (text) => `[CYAN] ${text}`
};

// Simple protocol parser mock
class ProtocolParser {
  validateMessage(message) {
    if (!message || typeof message !== 'object') {
      throw new Error('Message must be an object');
    }
    if (!message.type) {
      throw new Error('Message must have a type field');
    }
    return true;
  }

  createHandshakeAck(originalMessage, assignedData = {}) {
    return {
      type: 'handshake_ack',
      id: randomUUID(),
      timestamp: Date.now(),
      correlation_id: originalMessage.id,
      status: 'success',
      assigned: assignedData
    };
  }

  createError(originalMessage, error, errorCode = 'INTERNAL_ERROR') {
    return {
      type: 'error',
      id: randomUUID(),
      timestamp: Date.now(),
      correlation_id: originalMessage ? originalMessage.id : null,
      status: 'error',
      error: error.message || error,
      error_code: errorCode
    };
  }
}

class AppRegistry extends EventEmitter {
  constructor(config, persistence) {
    super();
    this.config = config;
    this.persistence = persistence;
    this.protocol = new ProtocolParser();
    
    // Active applications
    this.apps = new Map(); // appId -> AppRegistration
    this.connections = new Map(); // connectionId -> appId
    this.triggerMappings = new Map(); // triggerName -> Set of appIds
    
    // Rehydration cache
    this.rehydrationCache = new Map(); // appId -> cached registration data
    this.lastSeenApps = new Map(); // appId -> timestamp
    
    // Configuration
    this.registryCleanupInterval = config.registry?.cleanupInterval || 3600000; // 1 hour
    this.rehydrationCacheMaxAge = config.registry?.rehydrationCacheMaxAge || 86400000; // 24 hours
    
    // Cleanup timer
    this.cleanupTimer = null;
  }

  /**
   * Initialize the app registry
   */
  async initialize() {
    console.log(chalk.blue('📋 Initializing App Registry...'));
    
    // Load persisted app registrations for rehydration
    await this._loadPersistedRegistrations();
    
    // Setup cleanup intervals for stale registrations
    this._setupCleanupIntervals();
    
    console.log(chalk.green('✅ App Registry initialized'));
  }

  /**
   * Shutdown the app registry
   */
  async shutdown() {
    console.log(chalk.yellow('📋 Shutting down App Registry...'));
    
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // Persist current registrations for future rehydration
    await this._persistRegistrations();
    
    // Clear all registrations
    this.apps.clear();
    this.connections.clear();
    this.triggerMappings.clear();
    this.rehydrationCache.clear();
    this.lastSeenApps.clear();
    
    console.log(chalk.green('✅ App Registry shutdown complete'));
  }

  /**
   * Process handshake message from connection
   */
  async processHandshake(message, connection) {
    try {
      // Validate message structure
      this.protocol.validateMessage(message);
      
      const appId = message.app_id;
      const pools = message.pools || ['default'];
      const triggers = message.triggers || [];
      const metadata = message.metadata || {};
      
      console.log(chalk.cyan(`📋 Processing handshake from app: ${appId}`));
      
      // Validate app_id format
      if (!this._validateAppId(appId)) {
        throw new Error('Invalid app_id format');
      }
      
      // Validate pools
      if (!this._validatePools(pools)) {
        throw new Error('Invalid pools specification');
      }
      
      // Validate triggers
      if (!this._validateTriggers(triggers)) {
        throw new Error('Invalid triggers specification');
      }
      
      // Check if this is a rehydration request (minimal handshake)
      const isRehydration = triggers.length === 0 && await this._hasRehydrationData(appId);
      
      let registration;
      if (isRehydration) {
        // Attempt rehydration from persisted data
        registration = await this.rehydrateApp(appId, connection);
        console.log(chalk.green(`🔄 Rehydrated app: ${appId}`));
        this.emit('app_rehydrated', appId, registration);
      } else {
        // Full registration
        registration = await this.registerApp(appId, triggers, pools, metadata, connection);
        console.log(chalk.green(`📝 Registered app: ${appId}`));
        this.emit('app_registered', appId, registration);
      }
      
      // Send handshake acknowledgment
      const ackMessage = this.protocol.createHandshakeAck(message, {
        app_id: appId,
        pools: registration.pools,
        triggers: registration.triggers,
        rehydrated: isRehydration
      });
      
      connection.send(ackMessage);
      
      // Update last seen timestamp
      this.lastSeenApps.set(appId, Date.now());
      
      return registration;
      
    } catch (error) {
      console.error(chalk.red(`❌ Handshake error for ${message.app_id}:`), error.message);
      
      const errorResponse = this.protocol.createError(message, error, 'HANDSHAKE_ERROR');
      connection.send(errorResponse);
      
      throw error;
    }
  }

  /**
   * Register a new application
   */
  async registerApp(app_id, triggers = [], pools = [], metadata = {}, connection = null) {
    try {
      // Validate inputs
      if (!this._validateAppId(app_id)) {
        throw new Error('Invalid app_id format');
      }
      
      if (!this._validateTriggers(triggers)) {
        throw new Error('Invalid triggers specification');
      }
      
      if (!this._validatePools(pools)) {
        throw new Error('Invalid pools specification');
      }
      
      // Check for duplicate registration
      if (this.apps.has(app_id)) {
        console.log(chalk.yellow(`⚠️  App ${app_id} already registered, updating...`));
        return await this.updateApp(app_id, { triggers, pools, metadata });
      }
      
      // Create registration
      const registration = new AppRegistration(app_id, connection, {
        pools: pools,
        triggers: triggers,
        meta: metadata,
        protocolVersion: metadata.protocolVersion || '0.1.0',
        registered: Date.now()
      });
      
      // Store registration
      this.apps.set(app_id, registration);
      if (connection) {
        this.connections.set(connection.id, app_id);
      }
      
      // Update trigger mappings
      for (const triggerName of triggers) {
        this._addTriggerMapping(triggerName, app_id);
      }
      
      // Cache for future rehydration
      this.rehydrationCache.set(app_id, {
        pools: pools,
        triggers: triggers,
        meta: metadata,
        lastRegistered: Date.now()
      });
      
      // Persist to storage for durability
      await this._persistAppRegistration(registration);
      
      console.log(chalk.green(`✅ Registered app: ${app_id} with ${triggers.length} triggers`));
      
      return registration;
      
    } catch (error) {
      console.error(chalk.red(`❌ Error registering app ${app_id}:`), error.message);
      throw error;
    }
  }

  /**
   * Rehydrate an application from persisted data
   */
  async rehydrateApp(app_id, connection) {
    try {
      // Try to load from persistence first
      let appData = await this.persistence.getApp(app_id);
      
      // Fallback to cache if not in persistence
      if (!appData && this.rehydrationCache.has(app_id)) {
        const cachedData = this.rehydrationCache.get(app_id);
        appData = {
          appId: app_id,
          pools: cachedData.pools,
          triggers: cachedData.triggers,
          meta: cachedData.meta,
          protocolVersion: cachedData.meta?.protocolVersion || '0.1.0'
        };
      }
      
      if (!appData) {
        throw new Error(`No rehydration data available for app: ${app_id}`);
      }
      
      // Validate that stored triggers are still valid
      if (!this._validateTriggers(appData.triggers)) {
        console.warn(chalk.yellow(`⚠️  Invalid triggers found for app ${app_id}, clearing...`));
        appData.triggers = [];
      }
      
      // Create registration from persisted data
      const registration = new AppRegistration(app_id, connection, {
        pools: appData.pools,
        triggers: appData.triggers,
        meta: appData.meta,
        protocolVersion: appData.protocolVersion,
        registered: Date.now(),
        rehydrated: true,
        originalRegistration: appData.registered
      });
      
      // Store registration
      this.apps.set(app_id, registration);
      if (connection) {
        this.connections.set(connection.id, app_id);
      }
      
      // Restore trigger mappings
      for (const triggerName of appData.triggers) {
        this._addTriggerMapping(triggerName, app_id);
      }
      
      // Update cache
      this.rehydrationCache.set(app_id, {
        pools: appData.pools,
        triggers: appData.triggers,
        meta: appData.meta,
        lastRegistered: Date.now()
      });
      
      console.log(chalk.green(`✅ Rehydrated app: ${app_id} with ${appData.triggers.length} triggers`));
      
      return registration;
      
    } catch (error) {
      console.error(chalk.red(`❌ Error rehydrating app ${app_id}:`), error.message);
      throw error;
    }
  }

  /**
   * Update application registration
   */
  async updateApp(app_id, updates) {
    try {
      const registration = this.apps.get(app_id);
      if (!registration) {
        throw new Error(`App ${app_id} not found`);
      }
      
      const oldTriggers = [...registration.triggers];
      
      // Update registration properties
      if (updates.pools !== undefined) {
        if (!this._validatePools(updates.pools)) {
          throw new Error('Invalid pools specification');
        }
        registration.pools = updates.pools;
      }
      
      if (updates.triggers !== undefined) {
        if (!this._validateTriggers(updates.triggers)) {
          throw new Error('Invalid triggers specification');
        }
        
        // Remove old trigger mappings
        for (const triggerName of oldTriggers) {
          this._removeTriggerMapping(triggerName, app_id);
        }
        
        // Add new trigger mappings
        registration.triggers = updates.triggers;
        for (const triggerName of updates.triggers) {
          this._addTriggerMapping(triggerName, app_id);
        }
      }
      
      if (updates.metadata !== undefined) {
        registration.meta = { ...registration.meta, ...updates.metadata };
      }
      
      // Update cache
      this.rehydrationCache.set(app_id, {
        pools: registration.pools,
        triggers: registration.triggers,
        meta: registration.meta,
        lastRegistered: registration.registered
      });
      
      // Persist changes
      await this._persistAppRegistration(registration);
      
      console.log(chalk.green(`✅ Updated app: ${app_id}`));
      this.emit('app_updated', app_id, registration);
      
      return registration;
      
    } catch (error) {
      console.error(chalk.red(`❌ Error updating app ${app_id}:`), error.message);
      throw error;
    }
  }

  /**
   * Remove application registration
   */
  async removeApp(app_id) {
    try {
      const registration = this.apps.get(app_id);
      if (!registration) {
        return false;
      }
      
      // Remove trigger mappings
      for (const triggerName of registration.triggers) {
        this._removeTriggerMapping(triggerName, app_id);
      }
      
      // Remove from active registrations
      this.apps.delete(app_id);
      
      // Remove connection mapping
      if (registration.connection) {
        this.connections.delete(registration.connection.id);
      }
      
      // Remove from cache
      this.rehydrationCache.delete(app_id);
      this.lastSeenApps.delete(app_id);
      
      // Remove from persistence
      await this.persistence.removeApp(app_id);
      
      console.log(chalk.green(`✅ Removed app: ${app_id}`));
      this.emit('app_removed', app_id);
      
      return true;
      
    } catch (error) {
      console.error(chalk.red(`❌ Error removing app ${app_id}:`), error.message);
      throw error;
    }
  }

  /**
   * Get all registered applications
   */
  async getAllApps() {
    try {
      return Array.from(this.apps.values()).map(registration => ({
        appId: registration.appId,
        pools: registration.pools,
        triggers: registration.triggers,
        registered: registration.registered,
        lastSeen: this.lastSeenApps.get(registration.appId),
        isActive: registration.isActive(),
        meta: registration.meta,
        rehydrated: registration.rehydrated || false
      }));
    } catch (error) {
      console.error(chalk.red('❌ Error getting all apps:'), error.message);
      throw error;
    }
  }

  /**
   * Get applications by pool name
   */
  async getAppsByPool(pool_name) {
    try {
      if (!pool_name || typeof pool_name !== 'string') {
        throw new Error('pool_name is required and must be a string');
      }
      
      return Array.from(this.apps.values())
        .filter(registration => registration.pools.includes(pool_name))
        .map(registration => ({
          appId: registration.appId,
          pools: registration.pools,
          triggers: registration.triggers,
          registered: registration.registered,
          lastSeen: this.lastSeenApps.get(registration.appId),
          isActive: registration.isActive(),
          meta: registration.meta,
          rehydrated: registration.rehydrated || false
        }));
    } catch (error) {
      console.error(chalk.red(`❌ Error getting apps by pool ${pool_name}:`), error.message);
      throw error;
    }
  }

  /**
   * Get triggers for a specific app
   */
  getAppTriggers(app_id) {
    const registration = this.apps.get(app_id);
    return registration ? registration.triggers : [];
  }

  /**
   * Validate trigger definitions
   */
  validateTriggers(triggers) {
    return this._validateTriggers(triggers);
  }

  /**
   * Update app triggers
   */
  async updateAppTriggers(app_id, triggers) {
    return await this.updateApp(app_id, { triggers });
  }

  /**
   * Handle application disconnection
   */
  async handleDisconnection(connection) {
    const appId = this.connections.get(connection.id);
    if (!appId) {
      return; // Connection not registered
    }
    
    console.log(chalk.yellow(`📋 App disconnected: ${appId}`));
    
    const registration = this.apps.get(appId);
    if (registration) {
      // Remove trigger mappings
      for (const triggerName of registration.triggers) {
        this._removeTriggerMapping(triggerName, appId);
      }
      
      // Keep registration in cache for rehydration
      this.rehydrationCache.set(appId, {
        pools: registration.pools,
        triggers: registration.triggers,
        meta: registration.meta,
        lastRegistered: registration.registered
      });
      
      this.emit('app_disconnected', appId, registration);
    }
    
    // Remove from active registrations
    this.apps.delete(appId);
    this.connections.delete(connection.id);
  }

  /**
   * Get application registration
   */
  getApp(appId) {
    return this.apps.get(appId);
  }

  /**
   * Get application by connection
   */
  getAppByConnection(connectionId) {
    const appId = this.connections.get(connectionId);
    return appId ? this.apps.get(appId) : null;
  }

  /**
   * Check if application is registered
   */
  hasApp(appId) {
    return this.apps.has(appId);
  }

  /**
   * Get applications that handle a specific trigger
   */
  getTriggersHandlers(triggerName) {
    const appIds = this.triggerMappings.get(triggerName);
    if (!appIds) {
      return [];
    }
    
    return Array.from(appIds)
      .map(appId => this.apps.get(appId))
      .filter(app => app && app.isActive());
  }

  /**
   * Add trigger mapping
   */
  _addTriggerMapping(triggerName, appId) {
    if (!this.triggerMappings.has(triggerName)) {
      this.triggerMappings.set(triggerName, new Set());
    }
    this.triggerMappings.get(triggerName).add(appId);
  }

  /**
   * Remove trigger mapping
   */
  _removeTriggerMapping(triggerName, appId) {
    const appIds = this.triggerMappings.get(triggerName);
    if (appIds) {
      appIds.delete(appId);
      if (appIds.size === 0) {
        this.triggerMappings.delete(triggerName);
      }
    }
  }

  /**
   * Validate app_id format
   */
  _validateAppId(app_id) {
    if (!app_id || typeof app_id !== 'string') {
      return false;
    }
    
    // Check length constraints
    if (app_id.length === 0 || app_id.length > 128) {
      return false;
    }
    
    // Check for valid characters (alphanumeric, hyphens, underscores, dots)
    const validAppIdRegex = /^[a-zA-Z0-9._-]+$/;
    return validAppIdRegex.test(app_id);
  }

  /**
   * Validate pools array
   */
  _validatePools(pools) {
    if (!Array.isArray(pools)) {
      return false;
    }
    
    for (const pool of pools) {
      if (!pool || typeof pool !== 'string' || pool.length === 0 || pool.length > 64) {
        return false;
      }
      
      // Check for valid pool name characters
      const validPoolRegex = /^[a-zA-Z0-9._-]+$/;
      if (!validPoolRegex.test(pool)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Validate triggers array
   */
  _validateTriggers(triggers) {
    if (!Array.isArray(triggers)) {
      return false;
    }
    
    for (const trigger of triggers) {
      if (!this._validateTriggerName(trigger)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Validate individual trigger name
   */
  _validateTriggerName(triggerName) {
    if (!triggerName || typeof triggerName !== 'string') {
      return false;
    }
    
    // Check length constraints
    if (triggerName.length === 0 || triggerName.length > 128) {
      return false;
    }
    
    // Check for valid characters (alphanumeric, hyphens, underscores, dots, colons)
    const validTriggerRegex = /^[a-zA-Z0-9._:-]+$/;
    return validTriggerRegex.test(triggerName);
  }

  /**
   * Check if rehydration data exists for app
   */
  async _hasRehydrationData(app_id) {
    try {
      // Check cache first
      if (this.rehydrationCache.has(app_id)) {
        return true;
      }
      
      // Check persistence
      const appData = await this.persistence.getApp(app_id);
      return appData !== null;
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Error checking rehydration data for ${app_id}:`), error.message);
      return false;
    }
  }

  /**
   * Load persisted registrations for rehydration
   */
  async _loadPersistedRegistrations() {
    console.log(chalk.blue('📖 Loading persisted app registrations...'));
    
    try {
      const persistedApps = await this.persistence.loadAppRegistrations();
      
      for (const appData of persistedApps) {
        this.rehydrationCache.set(appData.appId, {
          pools: appData.pools,
          triggers: appData.triggers,
          meta: appData.meta,
          lastRegistered: appData.registered
        });
        
        // Update last seen timestamp
        if (appData.lastSeen) {
          this.lastSeenApps.set(appData.appId, appData.lastSeen);
        }
      }
      
      console.log(chalk.green(`✅ Loaded ${persistedApps.length} app registrations from persistence`));
    } catch (error) {
      console.warn(chalk.yellow('⚠️  Could not load persisted registrations:'), error.message);
    }
  }

  /**
   * Persist current registrations
   */
  async _persistRegistrations() {
    console.log(chalk.blue('💾 Persisting app registrations...'));
    
    try {
      // Save active registrations
      for (const [appId, registration] of this.apps.entries()) {
        await this.persistence.registerApp(
          appId,
          registration.triggers,
          registration.pools,
          {
            ...registration.meta,
            protocolVersion: registration.protocolVersion,
            rehydrated: registration.rehydrated
          }
        );
      }
      
      console.log(chalk.green(`✅ Persisted ${this.apps.size} app registrations`));
    } catch (error) {
      console.error(chalk.red('❌ Failed to persist registrations:'), error.message);
    }
  }

  /**
   * Persist individual app registration
   */
  async _persistAppRegistration(registration) {
    try {
      await this.persistence.registerApp(
        registration.appId,
        registration.triggers,
        registration.pools,
        {
          ...registration.meta,
          protocolVersion: registration.protocolVersion,
          rehydrated: registration.rehydrated
        }
      );
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Could not persist app registration for ${registration.appId}:`), error.message);
    }
  }

  /**
   * Setup cleanup intervals for stale registrations
   */
  _setupCleanupIntervals() {
    console.log(chalk.blue(`🧹 Setting up cleanup interval: ${this.registryCleanupInterval}ms`));
    
    this.cleanupTimer = setInterval(() => {
      this._cleanupStaleRegistrations();
    }, this.registryCleanupInterval);
  }

  /**
   * Cleanup stale registrations from cache
   */
  _cleanupStaleRegistrations() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [appId, timestamp] of this.lastSeenApps.entries()) {
      if (now - timestamp > this.rehydrationCacheMaxAge) {
        this.rehydrationCache.delete(appId);
        this.lastSeenApps.delete(appId);
        cleanedCount++;
        console.log(chalk.yellow(`🧹 Cleaned up stale registration cache for app: ${appId}`));
      }
    }
    
    if (cleanedCount > 0) {
      console.log(chalk.blue(`🧹 Cleanup completed: removed ${cleanedCount} stale registrations`));
    }
  }

  /**
   * Get registry statistics
   */
  getStats() {
    return {
      activeApps: this.apps.size,
      cachedApps: this.rehydrationCache.size,
      totalTriggers: this.triggerMappings.size,
      activeConnections: this.connections.size,
      lastSeenApps: this.lastSeenApps.size,
      cleanupInterval: this.registryCleanupInterval,
      cacheMaxAge: this.rehydrationCacheMaxAge
    };
  }
}

/**
 * Individual application registration
 */
class AppRegistration {
  constructor(appId, connection, options = {}) {
    this.appId = appId;
    this.connection = connection;
    this.pools = options.pools || [];
    this.triggers = options.triggers || [];
    this.meta = options.meta || {};
    this.protocolVersion = options.protocolVersion;
    this.registered = options.registered || Date.now();
    this.rehydrated = options.rehydrated || false;
    this.originalRegistration = options.originalRegistration;
    
    this.triggerMetadata = new Map(); // triggerName -> metadata
  }

  /**
   * Check if the application is currently active
   */
  isActive() {
    return this.connection && this.connection.isActive;
  }

  /**
   * Add a trigger to this application
   */
  addTrigger(triggerName, metadata = {}) {
    if (!this.triggers.includes(triggerName)) {
      this.triggers.push(triggerName);
    }
    this.triggerMetadata.set(triggerName, metadata);
  }

  /**
   * Remove a trigger from this application
   */
  removeTrigger(triggerName) {
    const index = this.triggers.indexOf(triggerName);
    if (index > -1) {
      this.triggers.splice(index, 1);
    }
    this.triggerMetadata.delete(triggerName);
  }

  /**
   * Get trigger metadata
   */
  getTriggerMetadata(triggerName) {
    return this.triggerMetadata.get(triggerName);
  }

  /**
   * Send a message to this application
   */
  send(message) {
    if (this.isActive()) {
      return this.connection.send(message);
    }
    return false;
  }

  /**
   * Convert to JSON for persistence
   */
  toJSON() {
    return {
      appId: this.appId,
      pools: this.pools,
      triggers: this.triggers,
      meta: this.meta,
      protocolVersion: this.protocolVersion,
      registered: this.registered,
      rehydrated: this.rehydrated,
      originalRegistration: this.originalRegistration
    };
  }
}

module.exports = { AppRegistry, AppRegistration };