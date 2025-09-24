/**
 * LatZero Server - Bootstrap & CLI Entry Point
 * 
 * This module serves as the main entry point for the LatZero orchestration server.
 * It handles server initialization, CLI argument parsing, and coordinates the startup
 * of all core server components including transport layer, pool management, and
 * persistence systems.
 * 
 * Key Responsibilities:
 * - Server bootstrap and graceful shutdown
 * - CLI command parsing and execution
 * - Configuration loading and validation
 * - Component initialization and dependency injection
 * - Process signal handling and cleanup
 * 
 * Default server configuration:
 * - Port: 45227 (latzero://APP_ID connects here)
 * - Host: localhost (127.0.0.1)
 * - Data directory: ~/.latzero
 */

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const os = require('os');

// Core server components
const Transport = require('./transport');
const { PoolManager } = require('./poolManager');
const { AppRegistry } = require('./appRegistry');
const { TriggerRouter } = require('./triggerRouter');
const { MemoryManager } = require('./memoryManager');
// const Security = require('./security');
const { Persistence } = require('./persistence');
const ClusterManager = require('./clusterManager');

// Debug logging to validate Persistence import
console.log('DEBUG: Persistence import type:', typeof Persistence);
console.log('DEBUG: Persistence import keys:', Object.keys(Persistence));
console.log('DEBUG: Persistence.Persistence type:', typeof Persistence.Persistence);
console.log('DEBUG: Persistence.PersistenceManager type:', typeof Persistence.PersistenceManager);

class LatZeroServer {
  constructor(options = {}) {
    this.config = {
      port: options.port || 45227,
      host: options.host || '127.0.0.1',
      dataDir: options.dataDir || path.join(os.homedir(), '.latzero'),
      logLevel: options.logLevel || 'info',
      enableTLS: options.enableTLS || false,
      clusterMode: options.clusterMode || false,
      ...options
    };

    // Core components
    this.transport = null;
    this.poolManager = null;
    this.appRegistry = null;
    this.triggerRouter = null;
    this.memoryManager = null;
    this.security = null;
    this.persistence = null;
    this.clusterManager = null;

    this.isRunning = false;
  }

  /**
   * Initialize all server components in dependency order
   */
  async initialize() {
    console.log(chalk.blue('🚀 Initializing LatZero Server...'));
    
    try {
      // TODO: Initialize persistence layer first (SQLite setup)
      this.persistence = new Persistence(this.config);
      await this.persistence.initialize();

      // TODO: Initialize security module (triple-key encryption)
      // this.security = new Security(this.config);
      // await this.security.initialize();

      // TODO: Initialize memory manager (mmap operations)
      this.memoryManager = new MemoryManager(this.config);
      await this.memoryManager.initialize();

      // TODO: Initialize pool manager (pool lifecycle)
      this.poolManager = new PoolManager(this.config, this.persistence, this.security, this.memoryManager);
      await this.poolManager.initialize();

      // TODO: Initialize app registry (AppID mapping)
      this.appRegistry = new AppRegistry(this.config, this.persistence, this.poolManager);
      await this.appRegistry.initialize();

      // TODO: Initialize trigger router (request routing)
      console.log(chalk.blue('🔧 Creating TriggerRouter with parameters:'));
      console.log(chalk.cyan(`   - config: ${typeof this.config}`));
      console.log(chalk.cyan(`   - appRegistry: ${typeof this.appRegistry}`));
      console.log(chalk.cyan(`   - poolManager: ${typeof this.poolManager}`));
      console.log(chalk.cyan(`   - transport: ${typeof this.transport}`));
      console.log(chalk.cyan(`   - persistence: ${typeof this.persistence}`));

      this.triggerRouter = new TriggerRouter(this.config, this.appRegistry, this.poolManager, null, this.persistence);
      console.log(chalk.blue('🔧 TriggerRouter created, now initializing...'));
      await this.triggerRouter.initialize();

      // TODO: Initialize cluster manager if enabled
      if (this.config.clusterMode) {
        this.clusterManager = new ClusterManager(this.config);
        await this.clusterManager.initialize();
      }

      // TODO: Initialize transport layer (socket acceptor)
      console.log(chalk.blue('🔧 Initializing Transport layer...'));
      console.log(chalk.cyan(`   - TriggerRouter initialized: ${this.triggerRouter ? 'YES' : 'NO'}`));
      console.log(chalk.cyan(`   - TriggerRouter isInitialized: ${this.triggerRouter?.isInitialized || 'N/A'}`));

      this.transport = new Transport(this.config, this.triggerRouter);
      await this.transport.initialize();

      // Set transport reference on TriggerRouter after both are initialized
      console.log(chalk.blue('🔧 Setting transport reference on TriggerRouter...'));
      this.triggerRouter.setTransport(this.transport);

      console.log(chalk.green('✅ LatZero Server initialized successfully'));
    } catch (error) {
      console.error(chalk.red('❌ Failed to initialize server:'), error.message);
      throw error;
    }
  }

  /**
   * Start the server and begin accepting connections
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    await this.initialize();
    
    // TODO: Start transport layer to accept connections
    await this.transport.start();
    
    this.isRunning = true;
    
    console.log(chalk.green(`🌟 LatZero Server running on ${this.config.host}:${this.config.port}`));
    console.log(chalk.cyan(`📁 Data directory: ${this.config.dataDir}`));
    console.log(chalk.cyan(`🔧 Cluster mode: ${this.config.clusterMode ? 'enabled' : 'disabled'}`));
  }

  /**
   * Gracefully shutdown the server
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }

    console.log(chalk.yellow('🛑 Shutting down LatZero Server...'));

    try {
      // TODO: Shutdown components in reverse order
      if (this.transport) await this.transport.shutdown();
      if (this.clusterManager) await this.clusterManager.shutdown();
      if (this.triggerRouter) await this.triggerRouter.shutdown();
      if (this.poolManager) await this.poolManager.shutdown();
      if (this.appRegistry) await this.appRegistry.shutdown();
      if (this.memoryManager) await this.memoryManager.shutdown();
      if (this.security) await this.security.shutdown();
      if (this.persistence) await this.persistence.shutdown();

      this.isRunning = false;
      console.log(chalk.green('✅ LatZero Server shutdown complete'));
    } catch (error) {
      console.error(chalk.red('❌ Error during shutdown:'), error.message);
      throw error;
    }
  }

  /**
   * Get server status and statistics
   */
  getStatus() {
    // TODO: Implement status collection from all components
    return {
      running: this.isRunning,
      config: this.config,
      stats: {
        // TODO: Collect stats from components
        activeConnections: 0,
        activePools: 0,
        registeredApps: 0,
        inFlightTriggers: 0,
        memoryBlocks: 0
      }
    };
  }
}

// CLI Command definitions
const program = new Command();

program
  .name('latzero-server')
  .description('LatZero process orchestration fabric server')
  .version('0.1.0');

program
  .command('start')
  .description('Start the LatZero server')
  .option('-p, --port <port>', 'Server port', '45227')
  .option('-h, --host <host>', 'Server host', '127.0.0.1')
  .option('-d, --data-dir <dir>', 'Data directory', path.join(os.homedir(), '.latzero'))
  .option('--cluster', 'Enable cluster mode')
  .option('--tls', 'Enable TLS')
  .option('--log-level <level>', 'Log level', 'info')
  .action(async (options) => {
    const server = new LatZeroServer({
      port: parseInt(options.port),
      host: options.host,
      dataDir: options.dataDir,
      clusterMode: options.cluster,
      enableTLS: options.tls,
      logLevel: options.logLevel
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n' + chalk.yellow('Received SIGINT, shutting down gracefully...'));
      await server.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n' + chalk.yellow('Received SIGTERM, shutting down gracefully...'));
      await server.shutdown();
      process.exit(0);
    });

    try {
      await server.start();
    } catch (error) {
      console.error(chalk.red('Failed to start server:'), error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show server status')
  .action(() => {
    // TODO: Implement status check (connect to running server)
    console.log(chalk.blue('Server status check not yet implemented'));
  });

program
  .command('stop')
  .description('Stop the running server')
  .action(() => {
    // TODO: Implement graceful stop (send signal to running server)
    console.log(chalk.blue('Server stop command not yet implemented'));
  });

// Export for programmatic use
module.exports = { LatZeroServer };

// CLI execution
if (require.main === module) {
  program.parse();
}