# LatZero Quick Start Guide

Get up and running with LatZero testing in under 5 minutes. This guide covers the essential steps to start the server and run your first tests.

## Prerequisites

- Node.js 16+ installed
- Terminal/command prompt access
- Basic familiarity with command line operations

## Step 1: Start the LatZero Server (1 minute)

Navigate to the server directory and start the server:

```bash
cd latzero/server
npm install
node index.js start
```

**Expected Output:**
```
🚀 Initializing LatZero Server...
✅ LatZero Server initialized successfully
🌟 LatZero Server running on 127.0.0.1:45227
📁 Data directory: /Users/username/.latzero
```

The server is now running on `localhost:45227`. Leave this terminal window open.

## Step 2: Test Basic Connection (1 minute)

Open a new terminal window and navigate to the examples directory:

```bash
cd latzero/examples
npm install
```

Test the handshake protocol:

```bash
node test-client.js handshake test-app echo
```

**Expected Output:**
```
🔗 Connecting to localhost:45227 as test-app...
✅ Connected to server
🤝 Performing handshake as test-app...
✅ Handshake successful
```

## Step 3: Test Trigger Operations (1 minute)

Call your first trigger:

```bash
node test-client.js trigger test-app echo '{"message":"Hello LatZero!"}'
```

**Expected Output:**
```
🔗 Connecting to localhost:45227 as test-app...
✅ Connected to server
🤝 Performing handshake as test-app...
✅ Handshake successful
🚀 Calling trigger: echo
✅ Trigger response received
Trigger result: {"echo":"Hello LatZero!","timestamp":1234567890}
```

## Step 4: Test Memory Operations (1 minute)

Create and manipulate a memory block:

```bash
# Create a 1KB memory block
node test-client.js memory test-app create my-block 1024

# Write data to the block
node test-client.js memory test-app write my-block 0 "Hello World!"

# Read the data back
node test-client.js memory test-app read my-block 0 12
```

**Expected Output:**
```
🔗 Connecting to localhost:45227 as test-app...
✅ Connected to server
🤝 Performing handshake as test-app...
✅ Handshake successful
🧠 Creating memory block: my-block (1024 bytes)
✅ Memory block created: my-block

🔗 Connecting to localhost:45227 as test-app...
✅ Connected to server
🤝 Performing handshake as test-app...
✅ Handshake successful
✏️  Writing to memory block: my-block (offset: 0, size: 12)
✅ Wrote 12 bytes to memory block: my-block

🔗 Connecting to localhost:45227 as test-app...
✅ Connected to server
🤝 Performing handshake as test-app...
✅ Handshake successful
📖 Reading from memory block: my-block (offset: 0)
✅ Read 12 bytes from memory block: my-block
Read data: Hello World!
```

## Step 5: Interactive Testing (1 minute)

Launch the interactive client for comprehensive testing:

```bash
node test-client.js interactive
```

**Interactive Commands:**
```
🚀 LatZero Test Client - Interactive Mode
Commands: handshake, trigger <name> [payload], memory <op> <args>, quit

> handshake
Already connected

> trigger echo {"test": "interactive mode"}
Result: {"echo":{"test":"interactive mode"},"timestamp":1234567890}

> memory create interactive-block 512
✅ Memory block created: interactive-block

> memory write interactive-block 0 "Interactive Test"
✅ Wrote 16 bytes to memory block: interactive-block

> memory read interactive-block 0 16
Data: Interactive Test

> quit
```

## Verification Checklist

- [ ] Server starts without errors
- [ ] Handshake completes successfully
- [ ] Trigger calls return responses
- [ ] Memory blocks can be created, written to, and read from
- [ ] Interactive mode allows multiple operations
- [ ] Server logs show expected activity

## Next Steps

Now that you have LatZero running:

1. **Explore Advanced Features**: Try encrypted memory blocks or custom pools
2. **Build Applications**: Use the client library in your own Node.js applications
3. **Monitor Performance**: Check server logs and connection statistics
4. **Read Full Documentation**: See [README.md](README.md) for detailed usage

## Troubleshooting

If something doesn't work:

1. **Check Server Status**: Ensure the server terminal shows "LatZero Server running"
2. **Verify Port**: Confirm nothing else is using port 45227
3. **Check Dependencies**: Run `npm install` in both server and examples directories
4. **Review Logs**: Look for error messages in server output
5. **See Troubleshooting Guide**: Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for detailed solutions

## Stop the Server

When finished testing, stop the server gracefully:

```bash
# In the server terminal, press Ctrl+C
# Or send SIGTERM signal
```

The server will perform cleanup and save persistent data before shutting down.