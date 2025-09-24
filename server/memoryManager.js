/**
 * LatZero Memory Manager - mmap Operations & Metadata
 * 
 * This module manages shared memory blocks using memory-mapped files (mmap)
 * for zero-copy access between processes. It handles memory block creation,
 * attachment, metadata management, and cross-platform compatibility.
 * 
 * Key Responsibilities:
 * - Memory block creation and lifecycle management
 * - mmap-backed shared memory implementation
 * - Cross-platform compatibility (Linux, Windows, macOS)
 * - Memory block metadata and versioning
 * - Access control and locking mechanisms
 * - Memory block subscription and change notifications
 * - Cleanup and garbage collection
 * 
 * Implementation Strategy:
 * - Linux/macOS: Use /dev/shm or mmap on temp files
 * - Windows: Use named shared memory APIs or memory-mapped files
 * - Fallback: Memory-backed files in temp directory
 * - Node.js: mmap-io library or native addons
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { v4: uuidv4 } = require('uuid');

// Import mmap-io for memory mapping
let mmap;
try {
  mmap = require('mmap-io');
} catch (error) {
  console.warn(chalk.yellow('⚠️  mmap-io not available, using fallback mode'));
  mmap = null;
}

// Memory block types
const BlockTypes = {
  SHARED: 'shared',
  PERSISTENT: 'persistent', 
  ENCRYPTED: 'encrypted',
  TEMPORARY: 'temporary',
  JSON: 'json',
  BINARY: 'binary',
  STREAM: 'stream'
};

// Memory block permissions
const BlockPermissions = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute'
};

// Lock modes
const LockModes = {
  READ: 'read',
  WRITE: 'write',
  EXCLUSIVE: 'exclusive'
};

class MemoryManager extends EventEmitter {
  constructor(config, persistence = null, poolManager = null) {
    super();
    this.config = config || {};
    this.persistence = persistence;
    this.poolManager = poolManager;
    
    // Memory blocks registry
    this.blocks = new Map(); // blockId -> MemoryBlock
    this.blockMetadata = new Map(); // blockId -> metadata
    this.attachments = new Map(); // blockId -> Set of appIds
    this.locks = new Map(); // blockId -> lock info
    this.subscriptions = new Map(); // blockId -> Set of callbacks
    
    // Platform-specific configuration
    this.platform = os.platform();
    this.mmapSupported = this._checkMmapSupport();
    this.sharedMemoryPath = null; // Will be resolved async
    
    // Cross-platform paths
    this.platformPaths = {
      linux: '/dev/shm',
      darwin: null, // Will use temp directory
      win32: null   // Will use temp directory
    };
    
    // Statistics
    this.stats = {
      totalBlocks: 0,
      totalMemoryUsed: 0,
      activeBlocks: 0,
      mmapBlocks: 0,
      fallbackBlocks: 0,
      totalReads: 0,
      totalWrites: 0,
      totalLocks: 0
    };
    
    // Cleanup intervals
    this.cleanupInterval = null;
    this.lockTimeoutInterval = null;
    
    // Initialization state
    this.isInitialized = false;
  }

  /**
   * Initialize the memory manager
   */
  async initialize() {
    console.log(chalk.blue('🧠 Initializing Memory Manager...'));
    
    if (this.isInitialized) {
      console.log(chalk.yellow('⚠️  Memory Manager already initialized'));
      return;
    }
    
    // Resolve shared memory path
    this.sharedMemoryPath = await this._getSharedMemoryPath();
    
    // Ensure shared memory directory exists
    await this._ensureSharedMemoryDirectory();
    
    // Load existing memory blocks metadata from persistence
    await this._loadBlockMetadata();
    
    // Setup cleanup intervals
    this._setupCleanupIntervals();
    
    this.isInitialized = true;
    console.log(chalk.green(`✅ Memory Manager initialized (mmap: ${this.mmapSupported})`));
    console.log(chalk.cyan(`📁 Shared memory path: ${this.sharedMemoryPath}`));
    
    this.emit('initialized');
  }

  /**
   * Shutdown the memory manager
   */
  async shutdown() {
    console.log(chalk.yellow('🧠 Shutting down Memory Manager...'));
    
    if (!this.isInitialized) {
      console.log(chalk.yellow('⚠️  Memory Manager not initialized'));
      return;
    }
    
    // Clear cleanup intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.lockTimeoutInterval) {
      clearInterval(this.lockTimeoutInterval);
    }
    
    // Cleanup all memory blocks
    for (const block of this.blocks.values()) {
      try {
        await block.cleanup();
      } catch (error) {
        console.error(chalk.red(`❌ Error cleaning up block ${block.config.id}:`), error.message);
      }
    }
    
    // Save metadata to persistence
    await this._saveBlockMetadata();
    
    // Clear all registries
    this.blocks.clear();
    this.blockMetadata.clear();
    this.attachments.clear();
    this.locks.clear();
    this.subscriptions.clear();
    
    this.isInitialized = false;
    console.log(chalk.green('✅ Memory Manager shutdown complete'));
    
    this.emit('shutdown');
  }

  // ==========================================
  // Memory Block Lifecycle Operations
  // ==========================================

  /**
   * Create a new memory block
   */
  async createMemoryBlock(block_id, size, type = BlockTypes.SHARED, pool_name = 'default', permissions = {}) {
    if (!block_id || typeof block_id !== 'string') {
      throw new Error('block_id is required and must be a string');
    }
    
    if (!size || typeof size !== 'number' || size <= 0) {
      throw new Error('size is required and must be a positive number');
    }
    
    if (this.blocks.has(block_id)) {
      throw new Error(`Memory block '${block_id}' already exists`);
    }

    // Validate pool exists if poolManager is available
    if (this.poolManager && !(await this.poolManager.hasPool(pool_name))) {
      throw new Error(`Pool '${pool_name}' does not exist`);
    }

    const blockConfig = {
      id: block_id,
      name: permissions.name || block_id,
      pool: pool_name,
      size: size,
      type: type,
      permissions: permissions.permissions || this._getDefaultPermissions(),
      version: 1,
      created: Date.now(),
      updated: Date.now(),
      persistent: permissions.persistent || false,
      encrypted: permissions.encrypted || false,
      ...permissions
    };

    console.log(chalk.cyan(`🧠 Creating memory block: ${block_id} (${size} bytes, ${type})`));

    // Create in persistence layer first
    if (this.persistence) {
      try {
        await this.persistence.createMemoryBlock(block_id, size, type, permissions);
      } catch (error) {
        console.error(chalk.red(`❌ Failed to persist memory block ${block_id}:`), error.message);
        throw error;
      }
    }

    // Create memory block instance
    const block = new MemoryBlock(blockConfig, this);
    await block.initialize();

    // Store block
    this.blocks.set(block_id, block);
    this.blockMetadata.set(block_id, blockConfig);
    this.attachments.set(block_id, new Set());

    // Update statistics
    this.stats.totalBlocks++;
    this.stats.activeBlocks++;
    this.stats.totalMemoryUsed += size;
    
    if (block.usesMmap) {
      this.stats.mmapBlocks++;
    } else {
      this.stats.fallbackBlocks++;
    }

    this.emit('block_created', block_id, blockConfig);
    
    return blockConfig;
  }

  /**
   * Attach to an existing memory block
   */
  async attachMemoryBlock(block_id, mode = 'read') {
    if (!block_id) {
      throw new Error('block_id is required');
    }

    let block = this.blocks.get(block_id);
    
    if (!block) {
      // Try to load from persistence
      if (this.persistence) {
        const metadata = await this.persistence.getMemoryBlock(block_id);
        if (metadata) {
          block = new MemoryBlock(metadata, this);
          await block.initialize();
          this.blocks.set(block_id, block);
          this.blockMetadata.set(block_id, metadata);
          this.attachments.set(block_id, new Set());
          this.stats.activeBlocks++;
        }
      }
      
      if (!block) {
        throw new Error(`Memory block '${block_id}' not found`);
      }
    }

    console.log(chalk.cyan(`🧠 Attached to memory block: ${block_id} (${mode})`));
    
    this.emit('block_attached', block_id, mode);
    
    return block;
  }

  /**
   * Detach from a memory block
   */
  async detachMemoryBlock(block_id, app_id = null) {
    if (!block_id) {
      throw new Error('block_id is required');
    }

    const attachmentSet = this.attachments.get(block_id);
    if (attachmentSet && app_id) {
      attachmentSet.delete(app_id);
    }

    console.log(chalk.cyan(`🧠 Detached from memory block: ${block_id}`));
    this.emit('block_detached', block_id, app_id);
    
    return true;
  }

  /**
   * Remove a memory block
   */
  async removeMemoryBlock(block_id) {
    if (!block_id) {
      throw new Error('block_id is required');
    }

    const block = this.blocks.get(block_id);
    
    if (!block) {
      console.warn(chalk.yellow(`⚠️  Memory block '${block_id}' not found for removal`));
      return false;
    }

    // Check for active attachments
    const attachmentSet = this.attachments.get(block_id);
    if (attachmentSet && attachmentSet.size > 0) {
      throw new Error(`Memory block '${block_id}' has active attachments. Detach all apps first.`);
    }

    console.log(chalk.yellow(`🧠 Removing memory block: ${block_id}`));

    // Cleanup block
    await block.cleanup();

    // Remove from persistence
    if (this.persistence) {
      try {
        await this.persistence.removeMemoryBlock(block_id);
      } catch (error) {
        console.error(chalk.red(`❌ Failed to remove memory block from persistence: ${error.message}`));
      }
    }

    // Update statistics
    this.stats.activeBlocks--;
    this.stats.totalMemoryUsed -= block.config.size;
    
    if (block.usesMmap) {
      this.stats.mmapBlocks--;
    } else {
      this.stats.fallbackBlocks--;
    }

    // Remove from registries
    this.blocks.delete(block_id);
    this.blockMetadata.delete(block_id);
    this.attachments.delete(block_id);
    this.locks.delete(block_id);
    this.subscriptions.delete(block_id);

    this.emit('block_removed', block_id);
    return true;
  }

  /**
   * Get memory block metadata
   */
  async getMemoryBlock(block_id) {
    if (!block_id) {
      throw new Error('block_id is required');
    }

    const metadata = this.blockMetadata.get(block_id);
    if (metadata) {
      return metadata;
    }

    // Try to load from persistence
    if (this.persistence) {
      return await this.persistence.getMemoryBlock(block_id);
    }

    return null;
  }

  /**
   * Get all memory blocks
   */
  async getAllMemoryBlocks() {
    const blocks = [];
    
    for (const [blockId, metadata] of this.blockMetadata.entries()) {
      const block = this.blocks.get(blockId);
      const attachmentSet = this.attachments.get(blockId);
      
      blocks.push({
        ...metadata,
        active: !!block,
        attachments: attachmentSet ? attachmentSet.size : 0,
        usesMmap: block ? block.usesMmap : false
      });
    }
    
    return blocks;
  }

  // ==========================================
  // Memory Operations
  // ==========================================

  /**
   * Read data from memory block
   */
  async readMemoryBlock(block_id, offset = 0, length = null) {
    const block = await this.attachMemoryBlock(block_id, 'read');
    this.stats.totalReads++;
    return await block.read(offset, length);
  }

  /**
   * Write data to memory block
   */
  async writeMemoryBlock(block_id, offset, data) {
    const block = await this.attachMemoryBlock(block_id, 'write');
    this.stats.totalWrites++;
    return await block.write(offset, data);
  }

  /**
   * Compare and swap operation
   */
  async compareAndSwap(block_id, offset, expected, new_value) {
    const block = await this.attachMemoryBlock(block_id, 'write');
    
    // Read current value
    const currentData = await block.read(offset, expected.length);
    
    // Compare
    if (!currentData.equals(expected)) {
      return { success: false, current: currentData };
    }
    
    // Swap
    await block.write(offset, new_value);
    
    return { success: true, previous: expected };
  }

  /**
   * Get block version
   */
  async getBlockVersion(block_id) {
    const metadata = await this.getMemoryBlock(block_id);
    return metadata ? metadata.version : null;
  }

  /**
   * Increment block version
   */
  async incrementVersion(block_id) {
    const metadata = this.blockMetadata.get(block_id);
    if (metadata) {
      metadata.version++;
      metadata.updated = Date.now();
      
      // Update in persistence
      if (this.persistence) {
        await this.persistence.updateMemoryBlock(block_id, { version: metadata.version });
      }
      
      return metadata.version;
    }
    throw new Error(`Memory block '${block_id}' not found`);
  }

  // ==========================================
  // Locking and Synchronization
  // ==========================================

  /**
   * Lock memory block
   */
  async lockMemoryBlock(block_id, mode = LockModes.EXCLUSIVE, timeout = 5000) {
    if (!block_id) {
      throw new Error('block_id is required');
    }

    const lockKey = `${block_id}:${mode}`;
    const existingLock = this.locks.get(lockKey);
    
    if (existingLock) {
      throw new Error(`Memory block '${block_id}' already locked in ${mode} mode`);
    }

    const lock = {
      blockId: block_id,
      mode: mode,
      acquired: Date.now(),
      timeout: timeout,
      lockId: uuidv4()
    };

    this.locks.set(lockKey, lock);
    this.stats.totalLocks++;

    // Set timeout for automatic release
    setTimeout(() => {
      if (this.locks.has(lockKey)) {
        this.locks.delete(lockKey);
        console.warn(chalk.yellow(`⚠️  Auto-released expired lock on block ${block_id}`));
        this.emit('lock_timeout', block_id, lock.lockId);
      }
    }, timeout);

    console.log(chalk.cyan(`🔒 Locked memory block: ${block_id} (${mode})`));
    this.emit('block_locked', block_id, mode, lock.lockId);
    
    return lock.lockId;
  }

  /**
   * Unlock memory block
   */
  async unlockMemoryBlock(block_id, mode = LockModes.EXCLUSIVE) {
    if (!block_id) {
      throw new Error('block_id is required');
    }

    const lockKey = `${block_id}:${mode}`;
    const lock = this.locks.get(lockKey);
    
    if (!lock) {
      throw new Error(`No ${mode} lock found for memory block '${block_id}'`);
    }

    this.locks.delete(lockKey);
    
    console.log(chalk.cyan(`🔓 Unlocked memory block: ${block_id} (${mode})`));
    this.emit('block_unlocked', block_id, mode, lock.lockId);
    
    return true;
  }

  /**
   * Try to lock memory block (non-blocking)
   */
  async tryLockMemoryBlock(block_id, mode = LockModes.EXCLUSIVE, timeout = 5000) {
    try {
      return await this.lockMemoryBlock(block_id, mode, timeout);
    } catch (error) {
      return null; // Lock not available
    }
  }

  // ==========================================
  // Permission Management
  // ==========================================

  /**
   * Set block permissions
   */
  async setBlockPermissions(block_id, permissions) {
    if (!block_id) {
      throw new Error('block_id is required');
    }

    const metadata = this.blockMetadata.get(block_id);
    if (!metadata) {
      throw new Error(`Memory block '${block_id}' not found`);
    }

    metadata.permissions = permissions;
    metadata.updated = Date.now();

    // Update in persistence
    if (this.persistence) {
      await this.persistence.updateMemoryBlock(block_id, { permissions });
    }

    this.emit('permission_changed', block_id, permissions);
    return true;
  }

  /**
   * Get block permissions
   */
  async getBlockPermissions(block_id) {
    const metadata = await this.getMemoryBlock(block_id);
    return metadata ? metadata.permissions : null;
  }

  /**
   * Check permission for operation
   */
  async checkPermission(block_id, app_id, operation) {
    const permissions = await this.getBlockPermissions(block_id);
    if (!permissions) {
      return false;
    }

    const allowedApps = permissions[operation] || [];
    return allowedApps.includes('*') || allowedApps.includes(app_id);
  }

  /**
   * Validate access rights
   */
  async validateAccess(block_id, app_id, mode) {
    const requiredPermission = mode === 'write' ? BlockPermissions.WRITE : BlockPermissions.READ;
    const hasPermission = await this.checkPermission(block_id, app_id, requiredPermission);
    
    if (!hasPermission) {
      throw new Error(`Access denied: ${app_id} does not have ${requiredPermission} permission for block '${block_id}'`);
    }
    
    return true;
  }

  // ==========================================
  // Cross-platform Compatibility
  // ==========================================

  /**
   * Get platform-specific path for memory block
   */
  _getPlatformPath(block_id) {
    const sanitizedId = block_id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.sharedMemoryPath, `${sanitizedId}.mem`);
  }

  /**
   * Create shared memory region
   */
  async _createSharedMemory(filePath, size) {
    if (this.mmapSupported && mmap) {
      try {
        // Create file first
        const fd = fsSync.openSync(filePath, 'w+');
        fsSync.ftruncateSync(fd, size);
        
        // Memory map the file
        const buffer = mmap.map(size, mmap.PROT_READ | mmap.PROT_WRITE, mmap.MAP_SHARED, fd, 0);
        fsSync.closeSync(fd);
        
        return { buffer, usesMmap: true };
      } catch (error) {
        console.warn(chalk.yellow(`⚠️  mmap failed for ${filePath}, using fallback: ${error.message}`));
      }
    }
    
    // Fallback to regular buffer
    const buffer = Buffer.alloc(size);
    await fs.writeFile(filePath, buffer);
    
    return { buffer, usesMmap: false };
  }

  /**
   * Attach to shared memory
   */
  async _attachSharedMemory(filePath, mode = 'r+') {
    if (this.mmapSupported && mmap) {
      try {
        const stats = await fs.stat(filePath);
        const fd = fsSync.openSync(filePath, mode);
        
        const protection = mode.includes('w') 
          ? mmap.PROT_READ | mmap.PROT_WRITE 
          : mmap.PROT_READ;
        
        const buffer = mmap.map(stats.size, protection, mmap.MAP_SHARED, fd, 0);
        fsSync.closeSync(fd);
        
        return { buffer, usesMmap: true };
      } catch (error) {
        console.warn(chalk.yellow(`⚠️  mmap attach failed for ${filePath}, using fallback: ${error.message}`));
      }
    }
    
    // Fallback to regular file read
    const buffer = await fs.readFile(filePath);
    return { buffer, usesMmap: false };
  }

  // ==========================================
  // Message Handling for Protocol Integration
  // ==========================================

  /**
   * Handle memory operation messages from protocol layer
   */
  async handleMemoryMessage(message, app_id) {
    try {
      const { operation, block_id } = message;
      
      switch (operation) {
        case 'create':
          return await this.createMemoryBlock(
            block_id,
            message.size,
            message.type || BlockTypes.SHARED,
            message.pool || 'default',
            message.permissions || {}
          );
          
        case 'attach':
          return await this.attachMemoryBlock(block_id, message.mode || 'read');
          
        case 'read':
          await this.validateAccess(block_id, app_id, 'read');
          return await this.readMemoryBlock(block_id, message.offset, message.length);
          
        case 'write':
          await this.validateAccess(block_id, app_id, 'write');
          return await this.writeMemoryBlock(block_id, message.offset, message.data);
          
        case 'lock':
          return await this.lockMemoryBlock(block_id, message.mode, message.timeout);
          
        case 'unlock':
          return await this.unlockMemoryBlock(block_id, message.mode);
          
        default:
          throw new Error(`Unknown memory operation: ${operation}`);
      }
    } catch (error) {
      console.error(chalk.red(`❌ Memory operation failed:`, error.message));
      throw error;
    }
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Check mmap support on current platform
   */
  _checkMmapSupport() {
    return !!mmap;
  }

  /**
   * Get shared memory path for current platform
   */
  async _getSharedMemoryPath() {
    const dataDir = this.config.dataDir || path.join(os.homedir(), '.latzero');
    
    switch (this.platform) {
      case 'linux':
        // Try /dev/shm first, fallback to data directory
        try {
          await fs.access('/dev/shm');
          return '/dev/shm/latzero';
        } catch {
          return path.join(dataDir, 'memory');
        }
        
      case 'darwin': // macOS
        return path.join(dataDir, 'memory');
        
      case 'win32': // Windows
        return path.join(dataDir, 'memory');
        
      default:
        return path.join(dataDir, 'memory');
    }
  }

  /**
   * Ensure shared memory directory exists
   */
  async _ensureSharedMemoryDirectory() {
    try {
      await fs.mkdir(this.sharedMemoryPath, { recursive: true });
    } catch (error) {
      console.error(chalk.red('❌ Failed to create shared memory directory:'), error.message);
      throw error;
    }
  }

  /**
   * Get default permissions for memory blocks
   */
  _getDefaultPermissions() {
    return {
      [BlockPermissions.READ]: ['*'],
      [BlockPermissions.WRITE]: ['*'],
      [BlockPermissions.EXECUTE]: []
    };
  }

  /**
   * Load block metadata from persistence
   */
  async _loadBlockMetadata() {
    if (!this.persistence) {
      console.log(chalk.blue('📖 No persistence layer, skipping metadata load'));
      return;
    }

    try {
      console.log(chalk.blue('📖 Loading memory block metadata...'));
      const blocks = await this.persistence.getAllMemoryBlocks();
      
      for (const blockData of blocks) {
        this.blockMetadata.set(blockData.id, blockData);
        this.attachments.set(blockData.id, new Set());
        console.log(chalk.green(`📖 Loaded metadata for block: ${blockData.id}`));
      }
      
      console.log(chalk.green(`✅ Loaded ${blocks.length} memory block metadata records`));
    } catch (error) {
      console.warn(chalk.yellow('⚠️  Could not load memory block metadata:'), error.message);
    }
  }

  /**
   * Save block metadata to persistence
   */
  async _saveBlockMetadata() {
    if (!this.persistence) {
      console.log(chalk.blue('💾 No persistence layer, skipping metadata save'));
      return;
    }

    try {
      console.log(chalk.blue('💾 Saving memory block metadata...'));
      let savedCount = 0;
      
      for (const [blockId, metadata] of this.blockMetadata.entries()) {
        try {
          await this.persistence.updateMemoryBlock(blockId, metadata);
          savedCount++;
        } catch (error) {
          console.warn(chalk.yellow(`⚠️  Could not save metadata for block ${blockId}:`), error.message);
        }
      }
      
      console.log(chalk.green(`✅ Saved ${savedCount} memory block metadata records`));
    } catch (error) {
      console.error(chalk.red('❌ Failed to save memory block metadata:'), error.message);
    }
  }

  /**
   * Setup cleanup intervals
   */
  _setupCleanupIntervals() {
    const cleanupInterval = this.config.memoryCleanupInterval || 300000; // 5 minutes
    const lockTimeoutInterval = this.config.lockTimeoutInterval || 60000; // 1 minute
    
    this.cleanupInterval = setInterval(() => {
      this._cleanupUnusedBlocks();
    }, cleanupInterval);
    
    this.lockTimeoutInterval = setInterval(() => {
      this._cleanupExpiredLocks();
    }, lockTimeoutInterval);
  }

  /**
   * Cleanup unused memory blocks
   */
  _cleanupUnusedBlocks() {
    const now = Date.now();
    const maxIdleTime = this.config.memoryBlockMaxIdleTime || 3600000; // 1 hour
    
    for (const [blockId, block] of this.blocks.entries()) {
      const attachmentSet = this.attachments.get(blockId);
      const hasAttachments = attachmentSet && attachmentSet.size > 0;
      
      if (!hasAttachments && (now - block.lastAccessed) > maxIdleTime) {
        console.log(chalk.yellow(`🧹 Cleaning up idle memory block: ${blockId}`));
        this.removeMemoryBlock(blockId).catch(error => {
          console.error(chalk.red(`❌ Error cleaning up block ${blockId}:`), error.message);
        });
      }
    }
  }

  /**
   * Cleanup expired locks
   */
  _cleanupExpiredLocks() {
    const now = Date.now();
    
    for (const [lockKey, lock] of this.locks.entries()) {
      if (now - lock.acquired > lock.timeout) {
        this.locks.delete(lockKey);
        console.warn(chalk.yellow(`⚠️  Cleaned up expired lock: ${lockKey}`));
        this.emit('lock_expired', lock.blockId, lock.lockId);
      }
    }
  }

  /**
   * Get memory manager statistics
   */
  getStats() {
    return {
      ...this.stats,
      platform: this.platform,
      mmapSupported: this.mmapSupported,
      sharedMemoryPath: this.sharedMemoryPath,
      activeLocks: this.locks.size,
      totalSubscriptions: Array.from(this.subscriptions.values()).reduce((sum, set) => sum + set.size, 0)
    };
  }

  // Legacy methods for backward compatibility
  async createBlock(blockName, size, options = {}) {
    const blockId = `${options.pool || 'default'}:${blockName}`;
    return await this.createMemoryBlock(blockId, size, options.type || BlockTypes.SHARED, options.pool || 'default', options);
  }

  async attachBlock(blockId) {
    return await this.attachMemoryBlock(blockId, 'read');
  }

  async destroyBlock(blockId, force = false) {
    return await this.removeMemoryBlock(blockId);
  }

  getBlock(blockId) {
    return this.blocks.get(blockId);
  }

  hasBlock(blockId) {
    return this.blocks.has(blockId) || this.blockMetadata.has(blockId);
  }

  listBlocks(poolName = null) {
    const blocks = [];
    
    for (const [blockId, metadata] of this.blockMetadata.entries()) {
      if (poolName && metadata.pool !== poolName) {
        continue;
      }
      
      const block = this.blocks.get(blockId);
      const attachmentSet = this.attachments.get(blockId);
      
      blocks.push({
        id: blockId,
        name: metadata.name,
        pool: metadata.pool,
        size: metadata.size,
        type: metadata.type,
        version: metadata.version,
        created: metadata.created,
        active: !!block,
        attachments: attachmentSet ? attachmentSet.size : 0,
        usesMmap: block ? block.usesMmap : false
      });
    }
    
    return blocks;
  }
}

/**
 * Individual memory block implementation
 */
class MemoryBlock extends EventEmitter {
  constructor(config, memoryManager) {
    super();
    this.config = config;
    this.memoryManager = memoryManager;
    
    this.buffer = null;
    this.mmapHandle = null;
    this.filePath = null;
    this.usesMmap = false;
    this.lastAccessed = Date.now();
    
    // Subscribers for change notifications
    this.subscribers = new Set();
  }

  /**
   * Initialize the memory block
   */
  async initialize() {
    this.filePath = this.memoryManager._getPlatformPath(this.config.id);
    
    try {
      const result = await this.memoryManager._createSharedMemory(this.filePath, this.config.size);
      this.buffer = result.buffer;
      this.usesMmap = result.usesMmap;
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Memory block initialization failed for ${this.config.id}, using fallback`));
      await this._initializeFallback();
    }
    
    this.lastAccessed = Date.now();
  }

  /**
   * Attach to existing memory block
   */
  async attach() {
    if (this.buffer) {
      return; // Already attached
    }
    
    try {
      const result = await this.memoryManager._attachSharedMemory(this.filePath, 'r+');
      this.buffer = result.buffer;
      this.usesMmap = result.usesMmap;
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Memory block attach failed for ${this.config.id}, using fallback`));
      await this._initializeFallback();
    }
  }

  /**
   * Initialize using fallback (regular buffer + file)
   */
  async _initializeFallback() {
    try {
      // Try to load existing file
      const data = await fs.readFile(this.filePath);
      this.buffer = data;
    } catch (error) {
      // Create new buffer
      this.buffer = Buffer.alloc(this.config.size);
      await fs.writeFile(this.filePath, this.buffer);
    }
    
    this.usesMmap = false;
  }

  /**
   * Read data from memory block
   */
  async read(offset = 0, length = null) {
    this._checkAccess(BlockPermissions.READ);
    this.lastAccessed = Date.now();
    
    if (!this.buffer) {
      throw new Error('Memory block not initialized');
    }
    
    const readLength = length || (this.buffer.length - offset);
    
    if (offset + readLength > this.buffer.length) {
      throw new Error('Read beyond buffer bounds');
    }
    
    return this.buffer.slice(offset, offset + readLength);
  }

  /**
   * Write data to memory block
   */
  async write(offset, data) {
    this._checkAccess(BlockPermissions.WRITE);
    this.lastAccessed = Date.now();
    
    if (!this.buffer) {
      throw new Error('Memory block not initialized');
    }
    
    if (offset + data.length > this.buffer.length) {
      throw new Error('Write beyond buffer bounds');
    }
    
    // Copy data to buffer
    data.copy(this.buffer, offset);
    
    // Persist to file if not using mmap
    if (!this.usesMmap) {
      await fs.writeFile(this.filePath, this.buffer);
    }
    
    // Increment version
    this.config.version++;
    this.config.updated = Date.now();
    
    // Notify subscribers
    this._notifySubscribers('write', { offset, length: data.length });
    
    this.emit('write', { offset, length: data.length });
    
    return true;
  }

  /**
   * Read JSON data from memory block
   */
  async readJSON() {
    if (this.config.type !== BlockTypes.JSON) {
      throw new Error('Block is not of JSON type');
    }
    
    const data = await this.read();
    const jsonString = data.toString('utf8').replace(/\0+$/, ''); // Remove null padding
    
    if (!jsonString) {
      return null;
    }
    
    return JSON.parse(jsonString);
  }

  /**
   * Write JSON data to memory block
   */
  async writeJSON(obj) {
    if (this.config.type !== BlockTypes.JSON) {
      throw new Error('Block is not of JSON type');
    }
    
    const jsonString = JSON.stringify(obj);
    const jsonBuffer = Buffer.from(jsonString, 'utf8');
    
    if (jsonBuffer.length > this.config.size) {
      throw new Error('JSON data too large for memory block');
    }
    
    // Clear buffer and write JSON
    this.buffer.fill(0);
    await this.write(0, jsonBuffer);
  }

  /**
   * Subscribe to memory block changes
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Cleanup memory block resources
   */
  async cleanup() {
    // Close mmap handle if using mmap
    if (this.mmapHandle && mmap) {
      try {
        mmap.unmap(this.buffer);
      } catch (error) {
        console.warn(chalk.yellow(`⚠️  Error unmapping memory block: ${error.message}`));
      }
    }
    
    // Clear buffer
    this.buffer = null;
    
    // Clear subscribers
    this.subscribers.clear();
    
    // Remove file if not persistent
    if (!this.config.persistent && this.filePath) {
      try {
        await fs.unlink(this.filePath);
      } catch (error) {
        console.warn(chalk.yellow(`⚠️  Could not remove memory block file: ${this.filePath}`));
      }
    }
  }

  /**
   * Check access permissions
   */
  _checkAccess(permission) {
    // Basic permission check - can be enhanced with proper ACL
    const permissions = this.config.permissions || {};
    const allowedApps = permissions[permission] || [];
    
    // For now, allow all access if wildcard is present
    return allowedApps.includes('*');
  }

  /**
   * Notify subscribers of changes
   */
  _notifySubscribers(event, data) {
    for (const callback of this.subscribers) {
      try {
        callback(event, data);
      } catch (error) {
        console.error(chalk.red('❌ Error in memory block subscriber:'), error.message);
      }
    }
  }

  /**
   * Get block statistics
   */
  getStats() {
    return {
      id: this.config.id,
      size: this.config.size,
      type: this.config.type,
      version: this.config.version,
      usesMmap: this.usesMmap,
      subscribers: this.subscribers.size,
      lastAccessed: this.lastAccessed
    };
  }
}

module.exports = { MemoryManager, MemoryBlock, BlockTypes, BlockPermissions, LockModes };