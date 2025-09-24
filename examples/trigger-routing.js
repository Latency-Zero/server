/**
 * LatZero Trigger Routing Example
 *
 * This example demonstrates explicit trigger routing with destinations, pools,
 * and different routing strategies. It shows how triggers can be directed to
 * specific applications or groups of applications.
 *
 * Usage:
 *   node trigger-routing.js sender [destination-pattern]
 *   node trigger-routing.js receiver [app-id] [triggers...]
 *   node trigger-routing.js router [routing-strategy]
 *   node trigger-routing.js demo
 *
 * Routing strategies demonstrated:
 * - Direct routing to specific app IDs
 * - Pool-based routing
 * - Round-robin load balancing
 * - Priority-based routing
 */

const { LatZeroClient } = require('./test-client');

class TriggerSender {
  constructor(appId, destinationPattern = '*') {
    this.appId = appId;
    this.destinationPattern = destinationPattern;
    this.client = new LatZeroClient({ appId });
    this.sentCount = 0;
    this.routingStrategies = ['direct', 'pool', 'round-robin', 'priority'];
  }

  async start() {
    console.log(`📤 Starting Trigger Sender: ${this.appId} (dest: ${this.destinationPattern})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['routing-pool', 'priority-pool', 'load-balance-pool'],
        triggers: [], // Senders don't register triggers
        metadata: { role: 'sender', destinationPattern: this.destinationPattern }
      });

      console.log(`✅ Sender ${this.appId} connected and ready`);

      // Send triggers using different routing strategies
      const sendInterval = setInterval(async () => {
        try {
          const strategy = this.routingStrategies[this.sentCount % this.routingStrategies.length];
          await this.sendTriggerWithStrategy(strategy);
          this.sentCount++;
        } catch (error) {
          console.error(`❌ Send error:`, error.message);
        }
      }, 3000); // Send every 3 seconds

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 20000));
      clearInterval(sendInterval);

      console.log(`📤 Trigger Sender ${this.appId} finished. Total sent: ${this.sentCount}`);
    } catch (error) {
      console.error(`❌ Trigger Sender ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  async sendTriggerWithStrategy(strategy) {
    const basePayload = {
      id: `msg-${this.sentCount}`,
      sender: this.appId,
      timestamp: Date.now(),
      strategy: strategy
    };

    switch (strategy) {
      case 'direct':
        // Direct routing to specific app
        const directPayload = { ...basePayload, data: 'Direct routed message' };
        console.log(`🎯 Sending direct trigger to receiver-1`);
        await this.client.callTrigger('process-direct', directPayload, {
          destination: 'receiver-1',
          pool: 'routing-pool',
          ttl: 10000
        });
        break;

      case 'pool':
        // Pool-based routing - any app in the pool can handle
        const poolPayload = { ...basePayload, data: 'Pool routed message' };
        console.log(`🏊 Sending pool-based trigger`);
        await this.client.callTrigger('process-pool', poolPayload, {
          pool: 'routing-pool',
          ttl: 15000
        });
        break;

      case 'round-robin':
        // Round-robin among multiple receivers
        const rrPayload = { ...basePayload, data: 'Round-robin message' };
        const receiverIndex = this.sentCount % 3 + 1; // receiver-1, receiver-2, receiver-3
        console.log(`🔄 Sending round-robin trigger to receiver-${receiverIndex}`);
        await this.client.callTrigger('process-round-robin', rrPayload, {
          destination: `receiver-${receiverIndex}`,
          pool: 'load-balance-pool',
          ttl: 12000
        });
        break;

      case 'priority':
        // Priority-based routing
        const priority = (this.sentCount % 3) + 1; // 1=low, 2=medium, 3=high
        const priorityPayload = {
          ...basePayload,
          data: `Priority ${priority} message`,
          priority: priority
        };
        console.log(`⭐ Sending priority ${priority} trigger`);
        await this.client.callTrigger('process-priority', priorityPayload, {
          pool: 'priority-pool',
          ttl: 8000 + (priority * 2000) // Higher priority = longer TTL
        });
        break;
    }
  }
}

class TriggerReceiver {
  constructor(appId, triggers = ['process-direct', 'process-pool', 'process-round-robin', 'process-priority']) {
    this.appId = appId;
    this.triggers = triggers;
    this.client = new LatZeroClient({ appId });
    this.receivedCount = 0;
    this.processingStats = {
      'process-direct': 0,
      'process-pool': 0,
      'process-round-robin': 0,
      'process-priority': 0
    };
  }

  async start() {
    console.log(`📨 Starting Trigger Receiver: ${this.appId} (triggers: ${this.triggers.join(', ')})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['routing-pool', 'priority-pool', 'load-balance-pool'],
        triggers: this.triggers,
        metadata: {
          role: 'receiver',
          triggers: this.triggers,
          priority: this.getPriority()
        }
      });

      console.log(`✅ Receiver ${this.appId} connected and listening`);

      // In a real implementation, receivers would process incoming triggers
      // For this demo, we'll simulate processing and show statistics

      const statsInterval = setInterval(() => {
        console.log(`📊 ${this.appId} Stats: ${this.receivedCount} total received`);
        Object.entries(this.processingStats).forEach(([trigger, count]) => {
          if (count > 0) {
            console.log(`   ${trigger}: ${count}`);
          }
        });
      }, 5000);

      // Simulate receiving and processing triggers
      const processInterval = setInterval(() => {
        this.simulateTriggerProcessing();
      }, 1000);

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 25000));

      clearInterval(statsInterval);
      clearInterval(processInterval);

      console.log(`📨 Trigger Receiver ${this.appId} finished. Total processed: ${this.receivedCount}`);
    } catch (error) {
      console.error(`❌ Trigger Receiver ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  simulateTriggerProcessing() {
    // Simulate receiving different types of triggers
    const triggerTypes = ['process-direct', 'process-pool', 'process-round-robin', 'process-priority'];
    const randomTrigger = triggerTypes[Math.floor(Math.random() * triggerTypes.length)];

    if (this.triggers.includes(randomTrigger)) {
      this.receivedCount++;
      this.processingStats[randomTrigger]++;

      const processingTime = 100 + Math.random() * 900; // 100-1000ms
      console.log(`⚙️  ${this.appId} processing ${randomTrigger} (${processingTime.toFixed(0)}ms)`);

      // Simulate processing delay
      setTimeout(() => {
        console.log(`✅ ${this.appId} completed ${randomTrigger}`);
      }, processingTime);
    }
  }

  getPriority() {
    // Extract priority from app ID (receiver-1 = priority 1, etc.)
    const match = this.appId.match(/receiver-(\d+)/);
    return match ? parseInt(match[1]) : 1;
  }
}

class TriggerRouter {
  constructor(appId, strategy = 'load-balance') {
    this.appId = appId;
    this.strategy = strategy;
    this.client = new LatZeroClient({ appId });
    this.routingTable = new Map();
    this.routeCount = 0;
  }

  async start() {
    console.log(`🚦 Starting Trigger Router: ${this.appId} (strategy: ${this.strategy})`);

    try {
      await this.client.connect();
      await this.client.handshake({
        pools: ['routing-pool', 'priority-pool', 'load-balance-pool'],
        triggers: ['route-request'], // Router receives routing requests
        metadata: { role: 'router', strategy: this.strategy }
      });

      // Initialize routing table
      this.initializeRoutingTable();

      console.log(`✅ Router ${this.appId} connected and routing`);

      // Simulate routing decisions
      const routeInterval = setInterval(() => {
        this.simulateRouting();
      }, 2000);

      // Run for demo duration
      await new Promise(resolve => setTimeout(resolve, 30000));
      clearInterval(routeInterval);

      console.log(`🚦 Trigger Router ${this.appId} finished. Total routes: ${this.routeCount}`);
    } catch (error) {
      console.error(`❌ Trigger Router ${this.appId} error:`, error.message);
    } finally {
      await this.client.disconnect();
    }
  }

  initializeRoutingTable() {
    // Set up routing table based on strategy
    switch (this.strategy) {
      case 'load-balance':
        this.routingTable.set('process-task', ['receiver-1', 'receiver-2', 'receiver-3']);
        break;
      case 'priority':
        this.routingTable.set('high-priority', ['receiver-1']); // Highest priority receiver
        this.routingTable.set('medium-priority', ['receiver-2']);
        this.routingTable.set('low-priority', ['receiver-3']);
        break;
      case 'direct':
        this.routingTable.set('user-specific', ['receiver-1']);
        break;
    }
  }

  simulateRouting() {
    const routes = Array.from(this.routingTable.keys());
    const randomRoute = routes[Math.floor(Math.random() * routes.length)];
    const destinations = this.routingTable.get(randomRoute);

    if (destinations && destinations.length > 0) {
      const destination = this.selectDestination(destinations);
      this.routeCount++;

      console.log(`🚦 Routing ${randomRoute} -> ${destination} (${this.strategy})`);

      // In a real implementation, this would actually route the trigger
      // For demo purposes, we just log the routing decision
    }
  }

  selectDestination(destinations) {
    switch (this.strategy) {
      case 'load-balance':
        // Round-robin selection
        return destinations[this.routeCount % destinations.length];

      case 'priority':
        // Always use first (highest priority) destination
        return destinations[0];

      case 'direct':
        // Direct mapping
        return destinations[0];

      default:
        return destinations[0];
    }
  }
}

class TriggerRoutingDemo {
  constructor() {
    this.senders = [];
    this.receivers = [];
    this.routers = [];
  }

  async run() {
    console.log(`🚀 Starting Trigger Routing Demo`);
    console.log(`=================================`);

    try {
      // Start receivers first
      const receiverPromises = [];
      for (let i = 1; i <= 3; i++) {
        const receiver = new TriggerReceiver(`receiver-${i}`);
        this.receivers.push(receiver);
        receiverPromises.push(receiver.start());
      }

      // Small delay for receivers to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start routers
      const routerStrategies = ['load-balance', 'priority', 'direct'];
      const routerPromises = [];
      for (let i = 0; i < routerStrategies.length; i++) {
        const router = new TriggerRouter(`router-${i + 1}`, routerStrategies[i]);
        this.routers.push(router);
        routerPromises.push(router.start());
      }

      // Start senders
      const senderPromises = [];
      for (let i = 0; i < 2; i++) {
        const sender = new TriggerSender(`sender-${i + 1}`);
        this.senders.push(sender);
        senderPromises.push(sender.start());
      }

      // Wait for senders to complete
      await Promise.all(senderPromises);

      // Let receivers and routers finish
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Stop all components
      this.receivers.forEach(r => r.stop && r.stop());
      this.routers.forEach(r => r.stop && r.stop());

      console.log(`✅ Trigger Routing Demo completed successfully`);
      console.log(`📊 Demo Summary:`);
      console.log(`   - Senders: ${this.senders.length}`);
      console.log(`   - Receivers: ${this.receivers.length}`);
      console.log(`   - Routers: ${this.routers.length}`);

    } catch (error) {
      console.error(`❌ Demo failed:`, error.message);
    }
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('LatZero Trigger Routing Example');
    console.log('');
    console.log('Usage:');
    console.log('  node trigger-routing.js sender [destination-pattern]');
    console.log('  node trigger-routing.js receiver [app-id] [triggers...]');
    console.log('  node trigger-routing.js router [routing-strategy]');
    console.log('  node trigger-routing.js demo');
    console.log('');
    console.log('Routing Strategies:');
    console.log('  load-balance  - Round-robin distribution');
    console.log('  priority      - Priority-based routing');
    console.log('  direct        - Direct app-to-app routing');
    console.log('');
    console.log('Examples:');
    console.log('  node trigger-routing.js sender receiver-1');
    console.log('  node trigger-routing.js receiver my-receiver process-data');
    console.log('  node trigger-routing.js router load-balance');
    console.log('  node trigger-routing.js demo');
    return;
  }

  try {
    switch (command) {
      case 'sender':
        const destPattern = args[1] || '*';
        const sender = new TriggerSender(`sender-${Date.now()}`, destPattern);
        await sender.start();
        break;

      case 'receiver':
        const appId = args[1] || `receiver-${Date.now()}`;
        const triggers = args.slice(2).length > 0 ? args.slice(2) :
          ['process-direct', 'process-pool', 'process-round-robin', 'process-priority'];
        const receiver = new TriggerReceiver(appId, triggers);
        await receiver.start();
        break;

      case 'router':
        const strategy = args[1] || 'load-balance';
        const router = new TriggerRouter(`router-${Date.now()}`, strategy);
        await router.start();
        break;

      case 'demo':
        const demo = new TriggerRoutingDemo();
        await demo.run();
        break;

      default:
        console.log(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

// Run CLI if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { TriggerSender, TriggerReceiver, TriggerRouter, TriggerRoutingDemo };