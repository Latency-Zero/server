/**
 * LatZero Pool Manager - Pool Lifecycle Management
 * 
 * This module manages the lifecycle of LatZero pools, which are logical namespaces
 * that contain events (triggers) and memory blocks. It handles pool creation,
 * destruction, access control, and coordination between local, global, and
 * encrypted pool types.
 * 
 * Key Responsibilities:
 * - Pool creation, configuration, and destruction
 * - Pool type management (local, global, encrypted)
 * - Access control and permission enforcement
 * - Pool membership management for applications
 * - Pool metadata persistence and recovery
 * - Resource cleanup and garbage collection
 * 
 * Pool Types:
 * - Local: Single orchestrator instance, low-latency
 * - Global: Multi-orchestrator synchronization (future)
 * - Encrypted: Triple-key encryption required for access
 */

const { EventEmitter } = require('events');
const chalk = require('chalk');

// Pool type constants
const PoolTypes = {
  LOCAL: 'local',
  GLOBAL: 'global',
  ENCRYPTED: 'encrypted'
};

// Pool access policies
const AccessPolicies = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute',
  ADMIN: 'admin'
};

class PoolManager extends EventEmitter {
  constructor(config, persistence, security, memoryManager) {
    super();
    this.config = config;
    this.persistence = persistence;
    this.security = security;
    this.memoryManager = memoryManager;
    
    this.pools = new Map(); // poolName -> Pool instance
    this.poolMetadata = new Map(); // poolName -> metadata
    this.appPoolMembership = new Map(); // appId -> Set of poolNames
    this.poolMembership = new Map(); // poolName -> Set of appIds
    
    // Default pools
    this.defaultPools = ['default', 'system'];
    
    // Pool type validation
    this.validPoolTypes = Object.values(PoolTypes);
    
    // Initialization state
    this.isInitialized = false;
  }

  /**
   * Initialize the pool manager
   */
  async initialize() {
    console.log(chalk.blue('🏊 Initializing Pool Manager...'));
    
    if (this.isInitialized) {
      console.log(chalk.yellow('⚠️  Pool Manager already initialized'));
      return;
    }
    
    // Load pool metadata from persistence layer
    await this._loadPoolMetadata();
    
    // Create default pools if they don't exist
    for (const poolName of this.defaultPools) {
      if (!this.pools.has(poolName)) {
        console.log(chalk.blue(`🏊 Creating default pool: ${poolName} with type: ${PoolTypes.LOCAL}`));
        await this.createPool(poolName, PoolTypes.LOCAL, false, {
          autoCreate: true,
          description: `Default ${poolName} pool`
        });
      }
    }
    
    this.isInitialized = true;
    console.log(chalk.green('✅ Pool Manager initialized'));
    this.emit('initialized');
  }

  /**
   * Shutdown the pool manager
   */
  async shutdown() {
    console.log(chalk.yellow('🏊 Shutting down Pool Manager...'));
    
    if (!this.isInitialized) {
      console.log(chalk.yellow('⚠️  Pool Manager not initialized'));
      return;
    }
    
    // Cleanup all pools and save metadata
    for (const pool of this.pools.values()) {
      await pool.cleanup();
    }
    
    await this._savePoolMetadata();
    
    this.pools.clear();
    this.poolMetadata.clear();
    this.appPoolMembership.clear();
    this.poolMembership.clear();
    
    this.isInitialized = false;
    console.log(chalk.green('✅ Pool Manager shutdown complete'));
    this.emit('shutdown');
  }

  /**
   * Create a new pool
   */
  async createPool(name, type = PoolTypes.LOCAL, encrypted = false, properties = {}, metadata = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Pool name is required and must be a string');
    }

    if (this.pools.has(name)) {
      throw new Error(`Pool '${name}' already exists`);
    }

    // Validate pool type
    if (!this.validatePoolType(type)) {
      throw new Error(`Invalid pool type: ${type}. Must be one of: ${this.validPoolTypes.join(', ')}`);
    }

    // Validate encrypted pool requirements
    if (type === PoolTypes.ENCRYPTED && !encrypted) {
      encrypted = true; // Force encryption for encrypted pool type
    }

    const poolConfig = {
      name,
      type,
      encrypted,
      owners: properties.owners || [],
      policies: properties.policies || this._getDefaultPolicies(),
      description: properties.description || metadata.description || '',
      created: Date.now(),
      updated: Date.now(),
      autoCreate: properties.autoCreate || false,
      maxMemoryBlocks: properties.maxMemoryBlocks || 1000,
      maxTriggers: properties.maxTriggers || 10000,
      ...properties,
      ...metadata
    };

    // Validate pool configuration
    this._validatePoolConfig(poolConfig);

    // Prepare encrypted pool security if needed
    if (encrypted) {
      poolConfig = await this._prepareEncryptedPool(name, poolConfig);
    }

    // Create pool in persistence layer
    await this.persistence.createPool(name, type, encrypted, poolConfig);

    // Create pool instance
    const pool = new Pool(poolConfig, this.security, this.memoryManager);
    await pool.initialize();

    // Store pool
    this.pools.set(name, pool);
    this.poolMetadata.set(name, poolConfig);
    this.poolMembership.set(name, new Set());

    console.log(chalk.green(`🏊 Created pool: ${name} (${type}${encrypted ? ', encrypted' : ''})`));
    
    this.emit('pool_created', name, poolConfig);
    return poolConfig;
  }

  /**
   * Get pool metadata by name
   */
  async getPool(name) {
    if (!name) {
      throw new Error('Pool name is required');
    }

    const poolInstance = this.pools.get(name);
    if (poolInstance) {
      return this.poolMetadata.get(name);
    }

    // Try to load from persistence if not in memory
    const persistedPool = await this.persistence.getPool(name);
    if (persistedPool) {
      // Load pool into memory
      const pool = new Pool(persistedPool, this.security, this.memoryManager);
      await pool.initialize();
      
      this.pools.set(name, pool);
      this.poolMetadata.set(name, persistedPool);
      this.poolMembership.set(name, new Set());
      
      return persistedPool;
    }

    return null;
  }

  /**
   * Update pool properties
   */
  async updatePool(name, updates) {
    if (!name) {
      throw new Error('Pool name is required');
    }

    const pool = this.pools.get(name);
    if (!pool) {
      throw new Error(`Pool '${name}' not found`);
    }

    const currentMetadata = this.poolMetadata.get(name);
    const updatedMetadata = { ...currentMetadata, ...updates, updated: Date.now() };

    // Validate updates
    this._validatePoolConfig(updatedMetadata);

    // Update in persistence
    await this.persistence.updatePool(name, updates);

    // Update in memory
    this.poolMetadata.set(name, updatedMetadata);
    pool.config = updatedMetadata;

    console.log(chalk.green(`🏊 Updated pool: ${name}`));
    this.emit('pool_updated', name, updates);

    return updatedMetadata;
  }

  /**
   * Remove a pool
   */
  async removePool(name) {
    if (!name) {
      throw new Error('Pool name is required');
    }

    const pool = this.pools.get(name);
    if (!pool) {
      return false;
    }

    // Check if pool can be deleted
    if (this.defaultPools.includes(name)) {
      throw new Error(`Cannot delete default pool '${name}'`);
    }

    // Check for active members
    const members = this.poolMembership.get(name);
    if (members && members.size > 0) {
      throw new Error(`Pool '${name}' has active members. Remove all members first.`);
    }

    // Cleanup pool resources
    await pool.cleanup();

    // Remove from persistence
    await this.persistence.removePool(name);

    // Remove from memory
    this.pools.delete(name);
    this.poolMetadata.delete(name);
    this.poolMembership.delete(name);

    // Remove from app memberships
    for (const [appId, poolSet] of this.appPoolMembership.entries()) {
      poolSet.delete(name);
      if (poolSet.size === 0) {
        this.appPoolMembership.delete(appId);
      }
    }

    console.log(chalk.yellow(`🏊 Removed pool: ${name}`));
    this.emit('pool_removed', name);

    return true;
  }

  /**
   * Get all pools
   */
  async getAllPools() {
    // Load all pools from persistence to ensure completeness
    const persistedPools = await this.persistence.getAllPools();
    
    const allPools = [];
    for (const poolData of persistedPools) {
      // Ensure pool is loaded in memory
      if (!this.pools.has(poolData.name)) {
        const pool = new Pool(poolData, this.security, this.memoryManager);
        await pool.initialize();
        
        this.pools.set(poolData.name, pool);
        this.poolMetadata.set(poolData.name, poolData);
        if (!this.poolMembership.has(poolData.name)) {
          this.poolMembership.set(poolData.name, new Set());
        }
      }
      
      allPools.push(poolData);
    }
    
    return allPools;
  }

  /**
   * Get pools by type
   */
  async getPoolsByType(type) {
    if (!type) {
      throw new Error('Pool type is required');
    }

    if (!this.validatePoolType(type)) {
      throw new Error(`Invalid pool type: ${type}`);
    }

    return await this.persistence.getPoolsByType(type);
  }

  /**
   * Check if a pool exists
   */
  async hasPool(poolName) {
    if (this.pools.has(poolName)) {
      return true;
    }
    
    // Check persistence
    const persistedPool = await this.persistence.getPool(poolName);
    return persistedPool !== null;
  }


  /**
   * Add an application to a pool
   */
  async addAppToPool(app_id, pool_name) {
    if (!app_id || typeof app_id !== 'string') {
      throw new Error('app_id is required and must be a string');
    }

    if (!pool_name || typeof pool_name !== 'string') {
      throw new Error('pool_name is required and must be a string');
    }

    // Ensure pool exists
    const poolExists = await this.hasPool(pool_name);
    if (!poolExists) {
      throw new Error(`Pool '${pool_name}' not found`);
    }

    // Load pool if not in memory
    const poolMetadata = await this.getPool(pool_name);
    if (!poolMetadata) {
      throw new Error(`Pool '${pool_name}' could not be loaded`);
    }

    // Check access permissions
    await this._checkPoolAccess(app_id, pool_name, AccessPolicies.READ);

    // Add to pool membership tracking
    if (!this.appPoolMembership.has(app_id)) {
      this.appPoolMembership.set(app_id, new Set());
    }
    this.appPoolMembership.get(app_id).add(pool_name);

    if (!this.poolMembership.has(pool_name)) {
      this.poolMembership.set(pool_name, new Set());
    }
    this.poolMembership.get(pool_name).add(app_id);

    // Add to pool instance
    const poolInstance = this.pools.get(pool_name);
    if (poolInstance) {
      await poolInstance.addMember(app_id);
    }

    console.log(chalk.cyan(`🏊 Added app ${app_id} to pool ${pool_name}`));
    this.emit('app_joined_pool', app_id, pool_name);

    return true;
  }

  /**
   * Remove an application from a pool
   */
  async removeAppFromPool(app_id, pool_name) {
    if (!app_id || typeof app_id !== 'string') {
      throw new Error('app_id is required and must be a string');
    }

    if (!pool_name || typeof pool_name !== 'string') {
      throw new Error('pool_name is required and must be a string');
    }

    // Remove from app pool membership tracking
    const poolSet = this.appPoolMembership.get(app_id);
    if (poolSet) {
      poolSet.delete(pool_name);
      if (poolSet.size === 0) {
        this.appPoolMembership.delete(app_id);
      }
    }

    // Remove from pool membership tracking
    const memberSet = this.poolMembership.get(pool_name);
    if (memberSet) {
      memberSet.delete(app_id);
    }

    // Remove from pool instance
    const pool = this.pools.get(pool_name);
    if (pool) {
      await pool.removeMember(app_id);
    }

    console.log(chalk.cyan(`🏊 Removed app ${app_id} from pool ${pool_name}`));
    this.emit('app_left_pool', app_id, pool_name);

    return true;
  }

  /**
   * Get all apps in a pool
   */
  getPoolMembers(pool_name) {
    if (!pool_name) {
      throw new Error('pool_name is required');
    }

    const members = this.poolMembership.get(pool_name);
    return members ? Array.from(members) : [];
  }

  /**
   * Get all pools for a specific app
   */
  getAppPools(app_id) {
    if (!app_id) {
      throw new Error('app_id is required');
    }

    const pools = this.appPoolMembership.get(app_id);
    return pools ? Array.from(pools) : [];
  }

  /**
   * Validate pool membership
   */
  validatePoolMembership(app_id, pool_name) {
    if (!app_id || !pool_name) {
      console.log(chalk.yellow(`🔍 PoolManager validatePoolMembership - invalid params: app_id=${app_id}, pool_name=${pool_name}`));
      return false;
    }

    const appPools = this.appPoolMembership.get(app_id);
    const isMember = appPools ? appPools.has(pool_name) : false;
    console.log(chalk.cyan(`🔍 PoolManager validatePoolMembership - app ${app_id} in pool ${pool_name}: ${isMember} (appPools: ${appPools ? JSON.stringify(Array.from(appPools)) : 'null'})`));
    return isMember;
  }

  /**
   * List all pools
   */
  listPools() {
    return Array.from(this.pools.keys()).map(poolName => {
      const pool = this.pools.get(poolName);
      const metadata = this.poolMetadata.get(poolName);
      
      return {
        name: poolName,
        type: metadata.type,
        encrypted: metadata.encrypted,
        memberCount: pool.getMemberCount(),
        triggerCount: pool.getTriggerCount(),
        memoryBlockCount: pool.getMemoryBlockCount(),
        created: metadata.created,
        description: metadata.description
      };
    });
  }

  /**
   * Get pool namespace structure
   */
  getPoolNamespace(pool_name) {
    if (!pool_name) {
      throw new Error('pool_name is required');
    }

    const pool = this.pools.get(pool_name);
    if (!pool) {
      throw new Error(`Pool '${pool_name}' not found`);
    }

    return {
      name: pool_name,
      events: Array.from(pool.triggers.keys()),
      memory: Array.from(pool.memoryBlocks.keys()),
      members: Array.from(pool.members.keys()),
      structure: {
        'events/': Array.from(pool.triggers.keys()).map(trigger => `${trigger}/`),
        'memory/': Array.from(pool.memoryBlocks.keys()).map(block => `${block}.mmap`)
      }
    };
  }

  /**
   * Create pool namespace structure
   */
  async createPoolNamespace(pool_name, structure) {
    if (!pool_name) {
      throw new Error('pool_name is required');
    }

    const pool = this.pools.get(pool_name);
    if (!pool) {
      throw new Error(`Pool '${pool_name}' not found`);
    }

    // Validate and create namespace structure
    if (structure.events) {
      for (const eventName of structure.events) {
        pool.registerTrigger(eventName, 'system', { namespace: true });
      }
    }

    if (structure.memory) {
      for (const memoryBlock of structure.memory) {
        pool.addMemoryBlock(memoryBlock.id, {
          ...memoryBlock,
          namespace: true
        });
      }
    }

    console.log(chalk.green(`🏊 Created namespace structure for pool: ${pool_name}`));
    this.emit('namespace_created', pool_name, structure);

    return this.getPoolNamespace(pool_name);
  }

  /**
   * Validate pool type
   */
  validatePoolType(type) {
    return this.validPoolTypes.includes(type);
  }

  /**
   * Get all local pools
   */
  async getLocalPools() {
    return await this.getPoolsByType(PoolTypes.LOCAL);
  }

  /**
   * Get all global pools
   */
  async getGlobalPools() {
    return await this.getPoolsByType(PoolTypes.GLOBAL);
  }

  /**
   * Get all encrypted pools
   */
  async getEncryptedPools() {
    return await this.getPoolsByType(PoolTypes.ENCRYPTED);
  }

  /**
   * Set pool property
   */
  async setPoolProperty(pool_name, key, value) {
    if (!pool_name || !key) {
      throw new Error('pool_name and key are required');
    }

    const metadata = this.poolMetadata.get(pool_name);
    if (!metadata) {
      throw new Error(`Pool '${pool_name}' not found`);
    }

    // Validate property key
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('Property key must be a non-empty string');
    }

    // Update metadata
    if (!metadata.properties) {
      metadata.properties = {};
    }
    metadata.properties[key] = value;
    metadata.updated = Date.now();

    // Update in persistence
    await this.persistence.updatePool(pool_name, { properties: metadata.properties });

    // Update in memory
    this.poolMetadata.set(pool_name, metadata);

    console.log(chalk.cyan(`🏊 Set property '${key}' for pool ${pool_name}`));
    this.emit('property_set', pool_name, key, value);

    return value;
  }

  /**
   * Get pool property
   */
  getPoolProperty(pool_name, key) {
    if (!pool_name || !key) {
      throw new Error('pool_name and key are required');
    }

    const metadata = this.poolMetadata.get(pool_name);
    if (!metadata) {
      throw new Error(`Pool '${pool_name}' not found`);
    }

    return metadata.properties ? metadata.properties[key] : undefined;
  }

  /**
   * Remove pool property
   */
  async removePoolProperty(pool_name, key) {
    if (!pool_name || !key) {
      throw new Error('pool_name and key are required');
    }

    const metadata = this.poolMetadata.get(pool_name);
    if (!metadata) {
      throw new Error(`Pool '${pool_name}' not found`);
    }

    if (metadata.properties && metadata.properties.hasOwnProperty(key)) {
      delete metadata.properties[key];
      metadata.updated = Date.now();

      // Update in persistence
      await this.persistence.updatePool(pool_name, { properties: metadata.properties });

      // Update in memory
      this.poolMetadata.set(pool_name, metadata);

      console.log(chalk.cyan(`🏊 Removed property '${key}' from pool ${pool_name}`));
      this.emit('property_removed', pool_name, key);

      return true;
    }

    return false;
  }

  /**
   * Get complete pool metadata
   */
  getPoolMetadata(pool_name) {
    if (!pool_name) {
      throw new Error('pool_name is required');
    }

    const metadata = this.poolMetadata.get(pool_name);
    if (!metadata) {
      throw new Error(`Pool '${pool_name}' not found`);
    }

    return { ...metadata };
  }

  /**
   * Get pool statistics
   */
  getPoolStats(poolName) {
    const pool = this.pools.get(poolName);
    if (!pool) {
      throw new Error(`Pool '${poolName}' not found`);
    }

    return pool.getStats();
  }

  /**
   * Validate pool configuration
   */
  _validatePoolConfig(config) {
    if (!config.name || typeof config.name !== 'string') {
      throw new Error('Pool name is required and must be a string');
    }

    // Validate pool name format
    const validNameRegex = /^[a-zA-Z0-9._-]+$/;
    if (!validNameRegex.test(config.name)) {
      throw new Error('Pool name contains invalid characters. Only alphanumeric, dots, underscores, and hyphens are allowed');
    }

    if (config.name.length > 64) {
      throw new Error('Pool name cannot exceed 64 characters');
    }

    if (!Object.values(PoolTypes).includes(config.type)) {
      throw new Error(`Invalid pool type: ${config.type}`);
    }

    if (config.type === PoolTypes.ENCRYPTED && !config.encrypted) {
      throw new Error('Encrypted pool type requires encrypted flag to be true');
    }

    // Validate owners array
    if (config.owners && !Array.isArray(config.owners)) {
      throw new Error('Pool owners must be an array');
    }

    // Validate policies object
    if (config.policies && typeof config.policies !== 'object') {
      throw new Error('Pool policies must be an object');
    }

    // Validate numeric limits
    if (config.maxMemoryBlocks && (typeof config.maxMemoryBlocks !== 'number' || config.maxMemoryBlocks < 1)) {
      throw new Error('maxMemoryBlocks must be a positive number');
    }

    if (config.maxTriggers && (typeof config.maxTriggers !== 'number' || config.maxTriggers < 1)) {
      throw new Error('maxTriggers must be a positive number');
    }
  }

  /**
   * Get default access policies
   */
  _getDefaultPolicies() {
    return {
      [AccessPolicies.READ]: ['*'], // Allow all by default
      [AccessPolicies.WRITE]: ['*'],
      [AccessPolicies.EXECUTE]: ['*'],
      [AccessPolicies.ADMIN]: [] // No admin access by default
    };
  }

  /**
   * Check if an app has access to a pool
   */
  async _checkPoolAccess(appId, poolName, requiredPermission) {
    const metadata = this.poolMetadata.get(poolName);
    if (!metadata) {
      throw new Error(`Pool '${poolName}' not found`);
    }

    // Check if pool is encrypted and app has required keys
    if (metadata.encrypted) {
      try {
        // Integration point for security module - triple-key validation
        if (this.security && typeof this.security.checkPoolAccess === 'function') {
          const hasAccess = await this.security.checkPoolAccess(appId, poolName, requiredPermission);
          if (!hasAccess) {
            throw new Error(`Access denied to encrypted pool '${poolName}': insufficient encryption keys`);
          }
        } else {
          // Fallback: require explicit permission for encrypted pools
          console.warn(chalk.yellow(`⚠️  Security module not available, using fallback access control for encrypted pool '${poolName}'`));
          const policies = metadata.policies || this._getDefaultPolicies();
          const allowedApps = policies[AccessPolicies.ADMIN] || [];
          if (!allowedApps.includes(appId)) {
            throw new Error(`Access denied to encrypted pool '${poolName}': admin permission required when security module unavailable`);
          }
        }
      } catch (error) {
        console.error(chalk.red(`❌ Security check failed for app ${appId} on pool ${poolName}:`), error.message);
        throw error;
      }
    }

    // Check policy-based access control
    const policies = metadata.policies || this._getDefaultPolicies();
    const allowedApps = policies[requiredPermission] || [];
    
    if (!allowedApps.includes('*') && !allowedApps.includes(appId)) {
      throw new Error(`Access denied: ${appId} does not have ${requiredPermission} permission for pool '${poolName}'`);
    }

    return true;
  }

  /**
   * Prepare encrypted pool for triple-key security
   */
  async _prepareEncryptedPool(poolName, poolConfig) {
    if (!poolConfig.encrypted) {
      return poolConfig;
    }

    // Integration point for security module - key generation and management
    if (this.security && typeof this.security.prepareEncryptedPool === 'function') {
      try {
        const securityConfig = await this.security.prepareEncryptedPool(poolName, {
          type: poolConfig.type,
          owners: poolConfig.owners,
          policies: poolConfig.policies
        });
        
        return {
          ...poolConfig,
          security: securityConfig,
          keyDerivation: securityConfig.keyDerivation || 'pbkdf2',
          encryptionAlgorithm: securityConfig.algorithm || 'aes-256-gcm'
        };
      } catch (error) {
        console.error(chalk.red(`❌ Failed to prepare encrypted pool ${poolName}:`), error.message);
        throw new Error(`Failed to initialize encryption for pool '${poolName}': ${error.message}`);
      }
    } else {
      console.warn(chalk.yellow(`⚠️  Security module not available, encrypted pool '${poolName}' will have limited security`));
      return {
        ...poolConfig,
        security: {
          warning: 'Security module not available - encryption keys not managed'
        }
      };
    }
  }

  /**
   * Validate pool dependencies
   */
  async _validatePoolDependencies(poolName) {
    const pool = this.pools.get(poolName);
    if (!pool) {
      return { valid: true, dependencies: [] };
    }

    const dependencies = [];
    const issues = [];

    // Check memory block dependencies
    for (const blockId of pool.memoryBlocks.keys()) {
      try {
        if (this.memoryManager && typeof this.memoryManager.validateBlock === 'function') {
          const blockValid = await this.memoryManager.validateBlock(blockId);
          if (!blockValid) {
            issues.push(`Memory block ${blockId} is invalid`);
          }
        }
        dependencies.push({ type: 'memory', id: blockId });
      } catch (error) {
        issues.push(`Memory block ${blockId} validation failed: ${error.message}`);
      }
    }

    // Check app dependencies
    const members = this.poolMembership.get(poolName);
    if (members) {
      for (const appId of members) {
        dependencies.push({ type: 'app', id: appId });
      }
    }

    return {
      valid: issues.length === 0,
      dependencies,
      issues
    };
  }

  /**
   * Load pool metadata from persistence
   */
  async _loadPoolMetadata() {
    console.log(chalk.blue('📖 Loading pool metadata...'));
    
    try {
      const persistedPools = await this.persistence.getAllPools();
      
      for (const poolData of persistedPools) {
        // Load pool into memory
        const pool = new Pool(poolData, this.security, this.memoryManager);
        await pool.initialize();
        
        this.pools.set(poolData.name, pool);
        this.poolMetadata.set(poolData.name, poolData);
        this.poolMembership.set(poolData.name, new Set());
        
        console.log(chalk.green(`📖 Loaded pool: ${poolData.name} (${poolData.type})`));
      }
      
      console.log(chalk.green(`✅ Loaded ${persistedPools.length} pools from persistence`));
    } catch (error) {
      console.warn(chalk.yellow('⚠️  Could not load pool metadata from persistence:'), error.message);
      // Continue initialization even if persistence loading fails
    }
  }

  /**
   * Save pool metadata to persistence
   */
  async _savePoolMetadata() {
    console.log(chalk.blue('💾 Saving pool metadata...'));
    
    try {
      let savedCount = 0;
      
      for (const [poolName, metadata] of this.poolMetadata.entries()) {
        try {
          // Update pool in persistence
          await this.persistence.updatePool(poolName, metadata);
          savedCount++;
        } catch (error) {
          console.warn(chalk.yellow(`⚠️  Could not save metadata for pool ${poolName}:`), error.message);
        }
      }
      
      console.log(chalk.green(`✅ Saved ${savedCount} pool metadata records`));
    } catch (error) {
      console.error(chalk.red('❌ Failed to save pool metadata:'), error.message);
    }
  }

  /**
   * Get manager statistics
   */
  getStats() {
    return {
      totalPools: this.pools.size,
      poolTypes: this._getPoolTypeStats(),
      totalApps: this.appPoolMembership.size,
      defaultPools: this.defaultPools
    };
  }

  /**
   * Get pool type statistics
   */
  _getPoolTypeStats() {
    const stats = {};
    for (const type of Object.values(PoolTypes)) {
      stats[type] = 0;
    }

    for (const metadata of this.poolMetadata.values()) {
      stats[metadata.type]++;
    }

    return stats;
  }
}

/**
 * Individual pool instance
 */
class Pool extends EventEmitter {
  constructor(config, security, memoryManager) {
    super();
    this.config = config;
    this.security = security;
    this.memoryManager = memoryManager;
    
    this.members = new Map(); // appId -> permissions
    this.triggers = new Map(); // triggerName -> handler info
    this.memoryBlocks = new Map(); // blockId -> block info
    this.activeConnections = new Set(); // connection IDs
  }

  /**
   * Initialize the pool
   */
  async initialize() {
    // TODO: Initialize pool-specific resources
    console.log(chalk.blue(`🏊 Initializing pool: ${this.config.name}`));
  }

  /**
   * Cleanup pool resources
   */
  async cleanup() {
    // TODO: Cleanup memory blocks, close connections, etc.
    console.log(chalk.yellow(`🏊 Cleaning up pool: ${this.config.name}`));
    
    // Cleanup memory blocks
    for (const blockId of this.memoryBlocks.keys()) {
      await this.memoryManager.destroyBlock(blockId);
    }
    
    this.members.clear();
    this.triggers.clear();
    this.memoryBlocks.clear();
    this.activeConnections.clear();
  }

  /**
   * Add a member to the pool
   */
  async addMember(appId, permissions = []) {
    this.members.set(appId, permissions);
    this.emit('memberAdded', appId);
  }

  /**
   * Remove a member from the pool
   */
  async removeMember(appId) {
    this.members.delete(appId);
    this.emit('memberRemoved', appId);
  }

  /**
   * Register a trigger in this pool
   */
  registerTrigger(triggerName, appId, metadata = {}) {
    this.triggers.set(triggerName, {
      appId,
      registered: Date.now(),
      ...metadata
    });
  }

  /**
   * Unregister a trigger from this pool
   */
  unregisterTrigger(triggerName) {
    this.triggers.delete(triggerName);
  }

  /**
   * Get trigger information
   */
  getTrigger(triggerName) {
    return this.triggers.get(triggerName);
  }

  /**
   * Add a memory block to this pool
   */
  addMemoryBlock(blockId, metadata) {
    this.memoryBlocks.set(blockId, metadata);
  }

  /**
   * Remove a memory block from this pool
   */
  removeMemoryBlock(blockId) {
    this.memoryBlocks.delete(blockId);
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      name: this.config.name,
      type: this.config.type,
      memberCount: this.members.size,
      triggerCount: this.triggers.size,
      memoryBlockCount: this.memoryBlocks.size,
      activeConnections: this.activeConnections.size,
      created: this.config.created
    };
  }

  /**
   * Get member count
   */
  getMemberCount() {
    return this.members.size;
  }

  /**
   * Get trigger count
   */
  getTriggerCount() {
    return this.triggers.size;
  }

  /**
   * Get memory block count
   */
  getMemoryBlockCount() {
    return this.memoryBlocks.size;
  }

  /**
   * Get active connections
   */
  getActiveConnections() {
    return Array.from(this.activeConnections);
  }

  /**
   * Get memory blocks
   */
  getMemoryBlocks() {
    return Array.from(this.memoryBlocks.keys());
  }
}

module.exports = { PoolManager, Pool, PoolTypes, AccessPolicies };