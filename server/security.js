/**
 * LatZero Security - Triple-Key Encryption Logic
 *
 * This module implements the LatZero security model based on the "Trinity Keys"
 * system for encrypted pools. It provides encryption, decryption, key management,
 * and access control functionality using a three-key approach.
 *
 * Key Responsibilities:
 * - Triple-key (Trinity Keys) encryption and decryption
 * - Key derivation and management (HKDF-based)
 * - Pool access control and authorization
 * - Encrypted memory block operations
 * - Key rotation and lifecycle management
 * - Transport layer security (TLS) support
 *
 * Trinity Keys System:
 * - SigilKey (Access Key): Authorizes joining encrypted pools
 * - CipherShard (Read Key): Allows decrypting memory and reading events
 * - OblivionSeal (Write Key): Allows writing/encrypting memory and privileged events
 *
 * The three keys are combined using HKDF to derive a symmetric pool key
 * used with AES-GCM for actual encryption/decryption operations.
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const chalk = require('chalk');

// Encryption constants
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION_ALGORITHM = 'sha256';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits for GCM
const SALT_LENGTH = 32; // 256 bits
const DERIVED_KEY_LENGTH = 32; // 256 bits
const MAC_ALGORITHM = 'sha256';

// Trinity key types (renamed from TrinityKeyTypes for consistency with spec)
const TrinityKeyTypes = {
  SIGIL_KEY: 'sigil_key',      // Access Key
  CIPHER_SHARD: 'cipher_shard', // Read Key
  OBLIVION_SEAL: 'oblivion_seal' // Write Key
};

// Access levels based on key possession
const AccessLevels = {
  NONE: 0,
  JOIN: 1,      // Has SigilKey
  READ: 2,      // Has SigilKey + CipherShard
  WRITE: 4,     // Has SigilKey + CipherShard + OblivionSeal
  ADMIN: 8      // Special admin privileges
};

// Security error types
const SecurityErrors = {
  INVALID_KEY_FORMAT: 'INVALID_KEY_FORMAT',
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  KEY_ROTATION_FAILED: 'KEY_ROTATION_FAILED',
  TLS_ERROR: 'TLS_ERROR',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS'
};

class Security extends EventEmitter {
  constructor(config, keyStorage = null) {
    super();
    this.config = {
      encryption: {
        algorithm: 'aes-256-gcm',
        keyLength: 32,
        ivLength: 16,
        tagLength: 16
      },
      keyDerivation: {
        algorithm: 'hkdf',
        hashFunction: 'sha256',
        iterations: 100000
      },
      tls: {
        enabled: false,
        certPath: null,
        keyPath: null,
        selfSigned: true
      },
      keyRotation: {
        enabled: false,
        interval: 86400000 // 24 hours
      },
      ...config
    };
    
    // Key storage (external or in-memory)
    this.keyStorage = keyStorage;
    
    // Key storage and management
    this.poolKeys = new Map(); // poolName -> derived symmetric key
    this.trinityKeys = new Map(); // poolName -> { sigil, cipher, oblivion }
    this.keyVersions = new Map(); // poolName -> version number
    this.keyRotationSchedule = new Map(); // poolName -> rotation info
    
    // Access control
    this.poolACLs = new Map(); // poolName -> access control lists
    this.appKeyPossession = new Map(); // appId -> Map(poolName -> Set of possessed keys)
    this.appCredentials = new Map(); // appId -> credentials
    this.permissions = new Map(); // appId -> Map(resource -> Set of operations)
    
    // Encryption cache for performance
    this.encryptionCache = new Map();
    this.cacheMaxSize = this.config.encryptionCacheSize || 1000;
    
    // TLS configuration
    this.tlsOptions = null;
    this.certificates = new Map(); // certId -> certificate data
    
    // Security statistics
    this.stats = {
      keysGenerated: 0,
      keysRotated: 0,
      encryptionOperations: 0,
      decryptionOperations: 0,
      accessGranted: 0,
      accessDenied: 0,
      authenticationAttempts: 0,
      authenticationFailures: 0
    };
    
    // Initialization state
    this.isInitialized = false;
  }

  /**
   * Initialize the security module
   */
  async initialize() {
    console.log(chalk.blue('🔐 Initializing Security Module...'));
    
    // Load existing keys and ACLs
    await this._loadSecurityConfiguration();
    
    // Setup key rotation scheduler
    this._setupKeyRotationScheduler();
    
    console.log(chalk.green('✅ Security Module initialized'));
  }

  /**
   * Shutdown the security module
   */
  async shutdown() {
    console.log(chalk.yellow('🔐 Shutting down Security Module...'));
    
    // Save security configuration
    await this._saveSecurityConfiguration();
    
    // Clear sensitive data from memory
    this._clearSensitiveData();
    
    console.log(chalk.green('✅ Security Module shutdown complete'));
  }

  // ==========================================
  // Key Management Operations
  // ==========================================

  /**
   * Generate new triple-key set for a pool
   */
  async generateTripleKey(poolName, options = {}) {
    if (this.trinityKeys.has(poolName)) {
      throw new Error(`Triple keys already exist for pool: ${poolName}`);
    }

    console.log(chalk.cyan(`🔐 Generating triple keys for pool: ${poolName}`));

    try {
      // Generate the three keys
      const trinityKeys = {
        [TrinityKeyTypes.SIGIL_KEY]: this._generateKey(32), // Access Key
        [TrinityKeyTypes.CIPHER_SHARD]: this._generateKey(32), // Read Key
        [TrinityKeyTypes.OBLIVION_SEAL]: this._generateKey(32) // Write Key
      };

      // Derive symmetric pool key from trinity keys
      const poolKey = await this.derivePoolKey(
        trinityKeys[TrinityKeyTypes.SIGIL_KEY],
        trinityKeys[TrinityKeyTypes.CIPHER_SHARD],
        trinityKeys[TrinityKeyTypes.OBLIVION_SEAL],
        poolName
      );

      // Store keys with version
      this.trinityKeys.set(poolName, trinityKeys);
      this.poolKeys.set(poolName, poolKey);
      this.keyVersions.set(poolName, 1);

      // Store in external key storage if available
      if (this.keyStorage) {
        await this.keyStorage.storeKeys(poolName, trinityKeys, 1);
      }

      // Setup key rotation if specified
      if (options.rotationInterval || this.config.keyRotation.enabled) {
        const interval = options.rotationInterval || this.config.keyRotation.interval;
        this._scheduleKeyRotation(poolName, interval);
      }

      this.stats.keysGenerated++;
      this.emit('keys_generated', poolName, {
        sigil: trinityKeys[TrinityKeyTypes.SIGIL_KEY].toString('hex'),
        cipher: trinityKeys[TrinityKeyTypes.CIPHER_SHARD].toString('hex'),
        oblivion: trinityKeys[TrinityKeyTypes.OBLIVION_SEAL].toString('hex'),
        version: 1
      });

      return {
        [TrinityKeyTypes.SIGIL_KEY]: trinityKeys[TrinityKeyTypes.SIGIL_KEY].toString('hex'),
        [TrinityKeyTypes.CIPHER_SHARD]: trinityKeys[TrinityKeyTypes.CIPHER_SHARD].toString('hex'),
        [TrinityKeyTypes.OBLIVION_SEAL]: trinityKeys[TrinityKeyTypes.OBLIVION_SEAL].toString('hex'),
        version: 1
      };
    } catch (error) {
      console.error(chalk.red(`❌ Failed to generate triple keys for pool ${poolName}:`), error.message);
      throw new Error(`Key generation failed: ${error.message}`);
    }
  }

  /**
   * Derive pool encryption key from triple keys using HKDF
   */
  async derivePoolKey(sigilKey, cipherShard, oblivionSeal, poolName) {
    try {
      // Validate inputs
      if (!sigilKey || !cipherShard || !oblivionSeal || !poolName) {
        throw new Error('All three keys and pool name are required');
      }

      // Convert hex strings to buffers if needed
      const sigilBuffer = Buffer.isBuffer(sigilKey) ? sigilKey : Buffer.from(sigilKey, 'hex');
      const cipherBuffer = Buffer.isBuffer(cipherShard) ? cipherShard : Buffer.from(cipherShard, 'hex');
      const oblivionBuffer = Buffer.isBuffer(oblivionSeal) ? oblivionSeal : Buffer.from(oblivionSeal, 'hex');

      // Combine all three keys as input key material
      const ikm = Buffer.concat([sigilBuffer, cipherBuffer, oblivionBuffer]);

      // Use pool name as salt for key derivation
      const salt = this.generateSalt(poolName);

      // Derive key using HKDF
      const derivedKey = await this.deriveKey(
        ikm,
        salt,
        `latzero-pool-${poolName}`,
        DERIVED_KEY_LENGTH
      );

      return derivedKey;
    } catch (error) {
      console.error(chalk.red(`❌ Pool key derivation failed for ${poolName}:`), error.message);
      throw new Error(`Pool key derivation failed: ${error.message}`);
    }
  }

  /**
   * Validate triple-key format and strength
   */
  validateTripleKey(keys) {
    try {
      if (!keys || typeof keys !== 'object') {
        throw new Error('Keys must be an object');
      }

      const requiredKeys = [TrinityKeyTypes.SIGIL_KEY, TrinityKeyTypes.CIPHER_SHARD, TrinityKeyTypes.OBLIVION_SEAL];
      
      for (const keyType of requiredKeys) {
        if (!keys[keyType]) {
          throw new Error(`Missing required key: ${keyType}`);
        }

        if (!this.validateTrinityKey(keys[keyType], keyType)) {
          throw new Error(`Invalid ${keyType} format`);
        }
      }

      return true;
    } catch (error) {
      console.error(chalk.red('❌ Triple key validation failed:'), error.message);
      throw error;
    }
  }

  /**
   * Get pool keys (with proper authorization)
   */
  async getPoolKeys(poolName, appId = null) {
    try {
      if (!this.trinityKeys.has(poolName)) {
        throw new Error(`No keys found for pool: ${poolName}`);
      }

      // Check authorization if appId provided
      if (appId) {
        const hasAccess = await this.validatePoolAccess(appId, poolName, 'read', null);
        if (!hasAccess) {
          throw new Error(`Access denied to pool keys for ${poolName}`);
        }
      }

      const keys = this.trinityKeys.get(poolName);
      const version = this.keyVersions.get(poolName) || 1;

      return {
        [TrinityKeyTypes.SIGIL_KEY]: keys[TrinityKeyTypes.SIGIL_KEY].toString('hex'),
        [TrinityKeyTypes.CIPHER_SHARD]: keys[TrinityKeyTypes.CIPHER_SHARD].toString('hex'),
        [TrinityKeyTypes.OBLIVION_SEAL]: keys[TrinityKeyTypes.OBLIVION_SEAL].toString('hex'),
        version: version
      };
    } catch (error) {
      console.error(chalk.red(`❌ Failed to get pool keys for ${poolName}:`), error.message);
      throw error;
    }
  }

  /**
   * Remove pool keys
   */
  async removePoolKeys(poolName) {
    try {
      if (!this.trinityKeys.has(poolName)) {
        return false;
      }

      console.log(chalk.yellow(`🗑️ Removing keys for pool: ${poolName}`));

      // Clear keys from memory (overwrite with zeros first)
      const keys = this.trinityKeys.get(poolName);
      if (keys) {
        for (const key of Object.values(keys)) {
          if (Buffer.isBuffer(key)) {
            key.fill(0);
          }
        }
      }

      const poolKey = this.poolKeys.get(poolName);
      if (poolKey && Buffer.isBuffer(poolKey)) {
        poolKey.fill(0);
      }

      // Remove from maps
      this.trinityKeys.delete(poolName);
      this.poolKeys.delete(poolName);
      this.keyVersions.delete(poolName);
      this.keyRotationSchedule.delete(poolName);

      // Remove from external key storage if available
      if (this.keyStorage) {
        await this.keyStorage.removeKeys(poolName);
      }

      // Clear app key possessions for this pool
      for (const [appId, appKeys] of this.appKeyPossession.entries()) {
        if (appKeys.has(poolName)) {
          appKeys.delete(poolName);
        }
      }

      return true;
    } catch (error) {
      console.error(chalk.red(`❌ Failed to remove pool keys for ${poolName}:`), error.message);
      throw error;
    }
  }

  /**
   * Create trinity keys for a new encrypted pool (legacy method)
   */
  async createTrinityKeys(poolName, options = {}) {
    return await this.generateTripleKey(poolName, options);
  }

  // ==========================================
  // Encryption/Decryption Operations
  // ==========================================

  /**
   * Encrypt data using pool keys
   */
  async encryptData(data, poolName, keys = null) {
    try {
      let poolKey;
      
      if (keys) {
        // Use provided keys to derive pool key
        this.validateTripleKey(keys);
        poolKey = await this.derivePoolKey(
          keys[TrinityKeyTypes.SIGIL_KEY],
          keys[TrinityKeyTypes.CIPHER_SHARD],
          keys[TrinityKeyTypes.OBLIVION_SEAL],
          poolName
        );
      } else {
        // Use stored pool key
        poolKey = this.poolKeys.get(poolName);
        if (!poolKey) {
          throw new Error(`No encryption key found for pool: ${poolName}`);
        }
      }

      const encrypted = this._encryptData(data, poolKey);
      this.stats.encryptionOperations++;
      this.emit('encryption_performed', poolName, data.length);
      
      return encrypted;
    } catch (error) {
      console.error(chalk.red(`❌ Encryption failed for pool ${poolName}:`), error.message);
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data using pool keys
   */
  async decryptData(encryptedData, poolName, keys = null) {
    try {
      let poolKey;
      
      if (keys) {
        // Use provided keys to derive pool key
        this.validateTripleKey(keys);
        poolKey = await this.derivePoolKey(
          keys[TrinityKeyTypes.SIGIL_KEY],
          keys[TrinityKeyTypes.CIPHER_SHARD],
          keys[TrinityKeyTypes.OBLIVION_SEAL],
          poolName
        );
      } else {
        // Use stored pool key
        poolKey = this.poolKeys.get(poolName);
        if (!poolKey) {
          throw new Error(`No decryption key found for pool: ${poolName}`);
        }
      }

      const decrypted = this._decryptData(encryptedData, poolKey);
      this.stats.decryptionOperations++;
      this.emit('decryption_performed', poolName, encryptedData.length);
      
      return decrypted;
    } catch (error) {
      console.error(chalk.red(`❌ Decryption failed for pool ${poolName}:`), error.message);
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt memory block
   */
  async encryptMemoryBlock(blockData, poolName, keys = null) {
    try {
      if (!Buffer.isBuffer(blockData)) {
        blockData = Buffer.from(blockData);
      }

      return await this.encryptData(blockData, poolName, keys);
    } catch (error) {
      console.error(chalk.red(`❌ Memory block encryption failed:`), error.message);
      throw new Error(`Memory block encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt memory block
   */
  async decryptMemoryBlock(encryptedBlock, poolName, keys = null) {
    try {
      if (!Buffer.isBuffer(encryptedBlock)) {
        encryptedBlock = Buffer.from(encryptedBlock);
      }

      return await this.decryptData(encryptedBlock, poolName, keys);
    } catch (error) {
      console.error(chalk.red(`❌ Memory block decryption failed:`), error.message);
      throw new Error(`Memory block decryption failed: ${error.message}`);
    }
  }

  /**
   * Generate initialization vector for encryption
   */
  generateIV() {
    return crypto.randomBytes(IV_LENGTH);
  }

  /**
   * Verify data integrity using signature
   */
  async verifyIntegrity(data, signature) {
    try {
      // For now, use HMAC for integrity verification
      // In production, this could use digital signatures
      const expectedSignature = this.generateMAC(data, signature.key);
      return crypto.timingSafeEqual(
        Buffer.from(signature.value, 'hex'),
        expectedSignature
      );
    } catch (error) {
      console.error(chalk.red('❌ Integrity verification failed:'), error.message);
      return false;
    }
  }

  /**
   * Encrypt data for a specific pool (legacy method)
   */
  async encryptForPool(poolName, data, appId = null) {
    // Check if app has write permission (if appId provided)
    if (appId) {
      const hasWriteAccess = await this.validatePoolAccess(appId, poolName, 'write', null);
      if (!hasWriteAccess) {
        throw new Error(`App ${appId} does not have write access to pool ${poolName}`);
      }
    }
    
    return await this.encryptData(data, poolName);
  }

  /**
   * Decrypt data from a specific pool (legacy method)
   */
  async decryptFromPool(poolName, encryptedData, appId = null) {
    // Check if app has read permission (if appId provided)
    if (appId) {
      const hasReadAccess = await this.validatePoolAccess(appId, poolName, 'read', null);
      if (!hasReadAccess) {
        throw new Error(`App ${appId} does not have read access to pool ${poolName}`);
      }
    }
    
    return await this.decryptData(encryptedData, poolName);
  }

  // ==========================================
  // Access Control Operations
  // ==========================================

  /**
   * Validate pool access with triple-key model
   */
  async validatePoolAccess(appId, poolName, operation, keys = null) {
    try {
      if (keys) {
        // Validate provided keys
        this.validateTripleKey(keys);
        
        // Register keys for this app if valid
        await this.registerAppKeys(appId, poolName, keys);
      }

      // Check access based on registered keys
      const hasAccess = await this.checkPoolAccess(appId, poolName, operation);
      
      if (hasAccess) {
        this.stats.accessGranted++;
        this.emit('access_granted', appId, poolName, operation);
      } else {
        this.stats.accessDenied++;
        this.emit('access_denied', appId, poolName, operation);
      }

      return hasAccess;
    } catch (error) {
      this.stats.accessDenied++;
      this.emit('access_denied', appId, poolName, operation, error.message);
      console.error(chalk.red(`❌ Access validation failed for ${appId} on ${poolName}:`), error.message);
      return false;
    }
  }

  /**
   * Check operation permission for app
   */
  async checkPermission(appId, resource, operation) {
    try {
      const appPermissions = this.permissions.get(appId);
      if (!appPermissions) {
        return false;
      }

      const resourcePermissions = appPermissions.get(resource);
      if (!resourcePermissions) {
        return false;
      }

      return resourcePermissions.has(operation) || resourcePermissions.has('*');
    } catch (error) {
      console.error(chalk.red(`❌ Permission check failed for ${appId}:`), error.message);
      return false;
    }
  }

  /**
   * Authenticate connection with credentials
   */
  async authenticateConnection(connection, credentials) {
    try {
      this.stats.authenticationAttempts++;

      if (!credentials || !credentials.appId) {
        throw new Error('Missing credentials or appId');
      }

      const { appId, token, signature } = credentials;

      // Validate app credentials
      const isValid = await this.validateAppCredentials(appId, credentials);
      if (!isValid) {
        this.stats.authenticationFailures++;
        this.emit('authentication_failure', appId, 'Invalid credentials');
        return false;
      }

      // Store connection authentication
      connection.appId = appId;
      connection.authenticated = true;
      connection.authTime = Date.now();

      this.emit('authentication_success', appId, connection.id);
      return true;
    } catch (error) {
      this.stats.authenticationFailures++;
      this.emit('authentication_failure', credentials?.appId || 'unknown', error.message);
      console.error(chalk.red('❌ Authentication failed:'), error.message);
      return false;
    }
  }

  /**
   * Authorize operation for app
   */
  async authorizeOperation(appId, operation, context = {}) {
    try {
      // Check if app is registered
      if (!this.appCredentials.has(appId)) {
        throw new Error(`App ${appId} not registered`);
      }

      // Check operation-specific permissions
      if (context.poolName) {
        return await this.validatePoolAccess(appId, context.poolName, operation, context.keys);
      }

      if (context.resource) {
        return await this.checkPermission(appId, context.resource, operation);
      }

      // Default: allow basic operations for registered apps
      return ['read', 'write', 'execute'].includes(operation);
    } catch (error) {
      console.error(chalk.red(`❌ Authorization failed for ${appId}:`), error.message);
      return false;
    }
  }

  /**
   * Validate app credentials
   */
  async validateAppCredentials(appId, credentials) {
    try {
      const storedCredentials = this.appCredentials.get(appId);
      if (!storedCredentials) {
        // Auto-register new apps in development mode
        if (this.config.development) {
          this.appCredentials.set(appId, {
            appId,
            registered: Date.now(),
            autoRegistered: true
          });
          return true;
        }
        return false;
      }

      // Validate token if provided
      if (credentials.token && storedCredentials.token) {
        return crypto.timingSafeEqual(
          Buffer.from(credentials.token),
          Buffer.from(storedCredentials.token)
        );
      }

      // Validate signature if provided
      if (credentials.signature && storedCredentials.publicKey) {
        // TODO: Implement signature verification
        return true;
      }

      return true; // Basic validation passed
    } catch (error) {
      console.error(chalk.red(`❌ Credential validation failed for ${appId}:`), error.message);
      return false;
    }
  }

  /**
   * Register trinity keys for an application
   */
  async registerAppKeys(appId, poolName, keys) {
    const keySet = new Set();
    
    // Validate and register each provided key
    for (const [keyType, keyValue] of Object.entries(keys)) {
      if (!Object.values(TrinityKeyTypes).includes(keyType)) {
        throw new Error(`Invalid key type: ${keyType}`);
      }
      
      const keyBuffer = Buffer.from(keyValue, 'hex');
      const poolKeys = this.trinityKeys.get(poolName);
      
      if (!poolKeys) {
        throw new Error(`No trinity keys found for pool: ${poolName}`);
      }
      
      // Verify key matches stored key
      if (!keyBuffer.equals(poolKeys[keyType])) {
        throw new Error(`Invalid ${keyType} for pool: ${poolName}`);
      }
      
      keySet.add(keyType);
    }
    
    // Store app key possession
    const appKeyMap = this.appKeyPossession.get(appId) || new Map();
    appKeyMap.set(poolName, keySet);
    this.appKeyPossession.set(appId, appKeyMap);
    
    console.log(chalk.cyan(`🔐 Registered keys for app ${appId} in pool ${poolName}: ${Array.from(keySet).join(', ')}`));
    
    this.emit('appKeysRegistered', appId, poolName, Array.from(keySet));
  }

  /**
   * Check if an app has access to a pool with required permission
   */
  async checkPoolAccess(appId, poolName, requiredPermission) {
    const appKeys = this.appKeyPossession.get(appId);
    if (!appKeys) {
      return false;
    }
    
    const poolKeys = appKeys.get(poolName);
    if (!poolKeys) {
      return false;
    }
    
    // Determine access level based on key possession
    let accessLevel = AccessLevels.NONE;
    
    if (poolKeys.has(TrinityKeyTypes.SIGIL_KEY)) {
      accessLevel |= AccessLevels.JOIN;
    }
    
    if (poolKeys.has(TrinityKeyTypes.CIPHER_SHARD)) {
      accessLevel |= AccessLevels.READ;
    }
    
    if (poolKeys.has(TrinityKeyTypes.OBLIVION_SEAL)) {
      accessLevel |= AccessLevels.WRITE;
    }
    
    // Check if access level meets requirement
    const requiredLevel = AccessLevels[requiredPermission.toUpperCase()] || AccessLevels.NONE;
    
    return (accessLevel & requiredLevel) === requiredLevel;
  }

  /**
   * Rotate trinity keys for a pool
   */
  async rotatePoolKeys(poolName) {
    const oldKeys = this.trinityKeys.get(poolName);
    if (!oldKeys) {
      throw new Error(`No trinity keys found for pool: ${poolName}`);
    }
    
    console.log(chalk.yellow(`🔄 Rotating trinity keys for pool: ${poolName}`));
    
    // Generate new trinity keys
    const newTrinityKeys = {
      [TrinityKeyTypes.SIGIL_KEY]: this._generateKey(32),
      [TrinityKeyTypes.CIPHER_SHARD]: this._generateKey(32),
      [TrinityKeyTypes.OBLIVION_SEAL]: this._generateKey(32)
    };
    
    // Derive new pool key
    const newPoolKey = await this._derivePoolKey(poolName, newTrinityKeys);
    
    // TODO: Re-encrypt all memory blocks with new key
    await this._reencryptPoolData(poolName, this.poolKeys.get(poolName), newPoolKey);
    
    // Update stored keys
    this.trinityKeys.set(poolName, newTrinityKeys);
    this.poolKeys.set(poolName, newPoolKey);
    
    // Clear app key registrations (they need to re-register with new keys)
    for (const [appId, appKeys] of this.appKeyPossession.entries()) {
      appKeys.delete(poolName);
    }
    
    this.emit('keysRotated', poolName);
    
    return {
      [TrinityKeyTypes.SIGIL_KEY]: newTrinityKeys[TrinityKeyTypes.SIGIL_KEY].toString('hex'),
      [TrinityKeyTypes.CIPHER_SHARD]: newTrinityKeys[TrinityKeyTypes.CIPHER_SHARD].toString('hex'),
      [TrinityKeyTypes.OBLIVION_SEAL]: newTrinityKeys[TrinityKeyTypes.OBLIVION_SEAL].toString('hex')
    };
  }

  /**
   * Generate a cryptographically secure random key
   */
  _generateKey(length) {
    return crypto.randomBytes(length);
  }

  /**
   * Derive symmetric pool key from trinity keys using HKDF
   */
  async _derivePoolKey(poolName, trinityKeys) {
    // Combine all three keys as input key material
    const ikm = Buffer.concat([
      trinityKeys[TrinityKeyTypes.SIGIL_KEY],
      trinityKeys[TrinityKeyTypes.CIPHER_SHARD],
      trinityKeys[TrinityKeyTypes.OBLIVION_SEAL]
    ]);
    
    // Use pool name as salt for key derivation
    const salt = crypto.createHash('sha256').update(poolName).digest();
    
    // Derive key using HKDF
    const derivedKey = crypto.hkdfSync(
      KEY_DERIVATION_ALGORITHM,
      ikm,
      salt,
      Buffer.from(`latzero-pool-${poolName}`, 'utf8'), // info parameter
      DERIVED_KEY_LENGTH
    );
    
    return derivedKey;
  }

  /**
   * Encrypt data using AES-GCM
   */
  _encryptData(data, key) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipher(ENCRYPTION_ALGORITHM, key, { iv });
    
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const tag = cipher.getAuthTag();
    
    // Return IV + encrypted data + auth tag
    return Buffer.concat([iv, encrypted, tag]);
  }

  /**
   * Decrypt data using AES-GCM
   */
  _decryptData(encryptedData, key) {
    if (encryptedData.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid encrypted data format');
    }
    
    // Extract components
    const iv = encryptedData.slice(0, IV_LENGTH);
    const tag = encryptedData.slice(-TAG_LENGTH);
    const encrypted = encryptedData.slice(IV_LENGTH, -TAG_LENGTH);
    
    const decipher = crypto.createDecipher(ENCRYPTION_ALGORITHM, key, { iv });
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  }

  /**
   * Re-encrypt pool data with new key (for key rotation)
   */
  async _reencryptPoolData(poolName, oldKey, newKey) {
    // TODO: Implement re-encryption of all memory blocks in the pool
    console.log(chalk.blue(`🔄 Re-encrypting data for pool: ${poolName}`));
    
    // This would involve:
    // 1. Finding all memory blocks in the pool
    // 2. Decrypting with old key
    // 3. Encrypting with new key
    // 4. Updating storage
  }

  /**
   * Setup key rotation scheduler
   */
  _setupKeyRotationScheduler() {
    const rotationCheckInterval = this.config.keyRotationCheckInterval || 3600000; // 1 hour
    
    setInterval(() => {
      this._checkKeyRotationSchedule();
    }, rotationCheckInterval);
  }

  /**
   * Check and execute scheduled key rotations
   */
  _checkKeyRotationSchedule() {
    const now = Date.now();
    
    for (const [poolName, rotationInfo] of this.keyRotationSchedule.entries()) {
      if (now >= rotationInfo.nextRotation) {
        this.rotatePoolKeys(poolName).catch(error => {
          console.error(chalk.red(`❌ Error rotating keys for pool ${poolName}:`), error.message);
        });
        
        // Schedule next rotation
        rotationInfo.nextRotation = now + rotationInfo.interval;
      }
    }
  }

  /**
   * Schedule key rotation for a pool
   */
  _scheduleKeyRotation(poolName, interval) {
    this.keyRotationSchedule.set(poolName, {
      interval: interval,
      nextRotation: Date.now() + interval
    });
    
    console.log(chalk.cyan(`🔐 Scheduled key rotation for pool ${poolName} every ${interval}ms`));
  }

  /**
   * Load security configuration from persistence
   */
  async _loadSecurityConfiguration() {
    // TODO: Load from persistence layer
    console.log(chalk.blue('📖 Loading security configuration...'));
  }

  /**
   * Save security configuration to persistence
   */
  async _saveSecurityConfiguration() {
    // TODO: Save to persistence layer
    console.log(chalk.blue('💾 Saving security configuration...'));
  }

  /**
   * Clear sensitive data from memory
   */
  _clearSensitiveData() {
    // Clear keys from memory
    for (const [poolName, keys] of this.trinityKeys.entries()) {
      for (const key of Object.values(keys)) {
        key.fill(0); // Overwrite with zeros
      }
    }
    
    for (const [poolName, key] of this.poolKeys.entries()) {
      key.fill(0); // Overwrite with zeros
    }
    
    this.trinityKeys.clear();
    this.poolKeys.clear();
    this.appKeyPossession.clear();
    this.encryptionCache.clear();
  }

  /**
   * Get security statistics
   */
  getStats() {
    return {
      encryptedPools: this.trinityKeys.size,
      registeredApps: this.appKeyPossession.size,
      scheduledRotations: this.keyRotationSchedule.size,
      cacheSize: this.encryptionCache.size,
      supportedAlgorithms: [ENCRYPTION_ALGORITHM],
      keyDerivationAlgorithm: KEY_DERIVATION_ALGORITHM
    };
  }

  /**
   * Validate trinity key format
   */
  validateTrinityKey(keyValue, keyType) {
    if (typeof keyValue !== 'string') {
      throw new Error('Trinity key must be a hex string');
    }
    
    if (keyValue.length !== 64) { // 32 bytes = 64 hex chars
      throw new Error('Trinity key must be 32 bytes (64 hex characters)');
    }
    
    if (!/^[0-9a-fA-F]+$/.test(keyValue)) {
      throw new Error('Trinity key must be valid hexadecimal');
    }
    
    if (!Object.values(TrinityKeyTypes).includes(keyType)) {
      throw new Error(`Invalid trinity key type: ${keyType}`);
    }
    
    return true;
  }

  /**
   * Generate a complete set of trinity keys (utility function)
   */
  generateTrinityKeySet() {
    return {
      [TrinityKeyTypes.SIGIL_KEY]: this._generateKey(32).toString('hex'),
      [TrinityKeyTypes.CIPHER_SHARD]: this._generateKey(32).toString('hex'),
      [TrinityKeyTypes.OBLIVION_SEAL]: this._generateKey(32).toString('hex')
    };
  }
}

module.exports = { 
  Security, 
  TrinityKeyTypes, 
  AccessLevels,
  ENCRYPTION_ALGORITHM,
  KEY_DERIVATION_ALGORITHM
};

  // ==========================================
  // Key Derivation and Cryptography Functions
  // ==========================================

  /**
   * HKDF key derivation
   */
  async deriveKey(masterKey, salt, info, length = DERIVED_KEY_LENGTH) {
    try {
      if (!Buffer.isBuffer(masterKey)) {
        masterKey = Buffer.from(masterKey, 'hex');
      }
      if (!Buffer.isBuffer(salt)) {
        salt = Buffer.from(salt, 'hex');
      }
      if (typeof info === 'string') {
        info = Buffer.from(info, 'utf8');
      }

      return crypto.hkdfSync(
        this.config.keyDerivation.hashFunction,
        masterKey,
        salt,
        info,
        length
      );
    } catch (error) {
      console.error(chalk.red('❌ Key derivation failed:'), error.message);
      throw new Error(`Key derivation failed: ${error.message}`);
    }
  }

  /**
   * Generate cryptographic salt
   */
  generateSalt(input = null) {
    if (input) {
      // Deterministic salt based on input
      return crypto.createHash('sha256').update(input).digest();
    }
    // Random salt
    return crypto.randomBytes(SALT_LENGTH);
  }

  /**
   * Hash data with specified algorithm
   */
  hashData(data, algorithm = 'sha256') {
    try {
      if (!Buffer.isBuffer(data)) {
        data = Buffer.from(data);
      }
      return crypto.createHash(algorithm).update(data).digest();
    } catch (error) {
      console.error(chalk.red('❌ Data hashing failed:'), error.message);
      throw new Error(`Data hashing failed: ${error.message}`);
    }
  }

  /**
   * Generate message authentication code
   */
  generateMAC(data, key) {
    try {
      if (!Buffer.isBuffer(data)) {
        data = Buffer.from(data);
      }
      if (!Buffer.isBuffer(key)) {
        key = Buffer.from(key, 'hex');
      }
      return crypto.createHmac(MAC_ALGORITHM, key).update(data).digest();
    } catch (error) {
      console.error(chalk.red('❌ MAC generation failed:'), error.message);
      throw new Error(`MAC generation failed: ${error.message}`);
    }
  }

  /**
   * Verify message authentication code
   */
  verifyMAC(data, mac, key) {
    try {
      const expectedMAC = this.generateMAC(data, key);
      if (!Buffer.isBuffer(mac)) {
        mac = Buffer.from(mac, 'hex');
      }
      return crypto.timingSafeEqual(mac, expectedMAC);
    } catch (error) {
      console.error(chalk.red('❌ MAC verification failed:'), error.message);
      return false;
    }
  }

  // ==========================================
  // TLS and Transport Security
  // ==========================================

  /**
   * Load TLS certificates
   */
  async loadTLSCertificates(certPath, keyPath) {
    try {
      console.log(chalk.blue('🔒 Loading TLS certificates...'));

      const cert = await fs.readFile(certPath);
      const key = await fs.readFile(keyPath);

      this.tlsOptions = {
        cert: cert,
        key: key,
        requestCert: false,
        rejectUnauthorized: false
      };

      this.certificates.set('default', {
        cert: cert,
        key: key,
        loaded: Date.now()
      });

      console.log(chalk.green('✅ TLS certificates loaded successfully'));
      return this.tlsOptions;
    } catch (error) {
      console.error(chalk.red('❌ Failed to load TLS certificates:'), error.message);
      throw new Error(`TLS certificate loading failed: ${error.message}`);
    }
  }

  /**
   * Generate self-signed certificate for development
   */
  async generateSelfSignedCert() {
    try {
      console.log(chalk.blue('🔒 Generating self-signed certificate...'));

      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });

      this.certificates.set('self-signed', {
        privateKey: privateKey,
        publicKey: publicKey,
        generated: Date.now()
      });

      this.tlsOptions = {
        key: privateKey,
        cert: publicKey,
        requestCert: false,
        rejectUnauthorized: false
      };

      console.log(chalk.green('✅ Self-signed certificate generated'));
      return this.tlsOptions;
    } catch (error) {
      console.error(chalk.red('❌ Failed to generate self-signed certificate:'), error.message);
      throw new Error(`Self-signed certificate generation failed: ${error.message}`);
    }
  }

  /**
   * Validate TLS connection security
   */
  validateTLSConnection(connection) {
    try {
      if (!connection.encrypted) {
        return { valid: false, reason: 'Connection not encrypted' };
      }

      const cipher = connection.getCipher();
      if (!cipher) {
        return { valid: false, reason: 'No cipher information available' };
      }

      const weakCiphers = ['RC4', 'DES', '3DES'];
      if (weakCiphers.some(weak => cipher.name.includes(weak))) {
        return { valid: false, reason: `Weak cipher: ${cipher.name}` };
      }

      return {
        valid: true,
        cipher: cipher.name,
        version: cipher.version
      };
    } catch (error) {
      console.error(chalk.red('❌ TLS connection validation failed:'), error.message);
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Get TLS configuration options
   */
  getTLSOptions() {
    if (!this.tlsOptions && this.config.tls.selfSigned) {
      this.generateSelfSignedCert().catch(error => {
        console.error(chalk.red('❌ Failed to generate self-signed certificate:'), error.message);
      });
    }

    return this.tlsOptions || {
      requestCert: false,
      rejectUnauthorized: false
    };
  }

  // ==========================================
  // Integration Methods
  // ==========================================

  /**
   * Prepare encrypted pool for Pool Manager integration
   */
  async prepareEncryptedPool(poolName, poolConfig) {
    try {
      console.log(chalk.blue(`🔐 Preparing encrypted pool: ${poolName}`));

      const keys = await this.generateTripleKey(poolName, {
        rotationInterval: poolConfig.keyRotationInterval
      });

      return {
        keys: keys,
        keyDerivation: this.config.keyDerivation.algorithm,
        algorithm: this.config.encryption.algorithm,
        version: this.keyVersions.get(poolName) || 1,
        encrypted: true
      };
    } catch (error) {
      console.error(chalk.red(`❌ Failed to prepare encrypted pool ${poolName}:`), error.message);
      throw error;
    }
  }

  /**
   * Handle memory operation with encryption
   */
  async handleEncryptedMemoryOperation(operation, blockId, data, poolName, appId) {
    try {
      const hasAccess = await this.validatePoolAccess(appId, poolName, operation, null);
      if (!hasAccess) {
        throw new Error(`Access denied for ${operation} operation on pool ${poolName}`);
      }

      switch (operation) {
        case 'encrypt':
          return await this.encryptMemoryBlock(data, poolName);
        case 'decrypt':
          return await this.decryptMemoryBlock(data, poolName);
        default:
          throw new Error(`Unknown memory operation: ${operation}`);
      }
    } catch (error) {
      console.error(chalk.red(`❌ Encrypted memory operation failed:`), error.message);
      throw error;
    }
  }

  /**
   * Validate block access for Memory Manager integration
   */
  async validateBlock(blockId) {
    try {
      return true; // Placeholder implementation
    } catch (error) {
      console.error(chalk.red(`❌ Block validation failed for ${blockId}:`), error.message);
      return false;
    }
  }

  /**
   * Get comprehensive security statistics
   */
  getSecurityStats() {
    return {
      ...this.stats,
      encryptedPools: this.trinityKeys.size,
      registeredApps: this.appKeyPossession.size,
      scheduledRotations: this.keyRotationSchedule.size,
      cacheSize: this.encryptionCache.size,
      tlsEnabled: !!this.tlsOptions,
      certificates: this.certificates.size,
      keyVersions: Array.from(this.keyVersions.entries()),
      isInitialized: this.isInitialized
    };
  }

  /**
   * Get security health status
   */
  getHealthStatus() {
    const now = Date.now();
    const issues = [];

    for (const [certId, cert] of this.certificates.entries()) {
      if (cert.loaded && (now - cert.loaded) > 365 * 24 * 60 * 60 * 1000) {
        issues.push(`Certificate ${certId} is old and may need renewal`);
      }
    }

    for (const [poolName, rotationInfo] of this.keyRotationSchedule.entries()) {
      if (rotationInfo.nextRotation < now) {
        issues.push(`Pool ${poolName} key rotation is overdue`);
      }
    }

    return {
      healthy: issues.length === 0,
      issues: issues,
      lastCheck: now
    };
  }