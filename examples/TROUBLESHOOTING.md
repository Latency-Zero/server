# LatZero Troubleshooting Guide

This guide covers common issues and their solutions when working with the LatZero testing solution. Issues are organized by category for easy reference.

## Server Startup Problems

### Server Won't Start

**Symptoms:**
- "Failed to start server" error
- Port already in use messages
- Permission denied errors

**Solutions:**

1. **Check Port Availability**
   ```bash
   # Check if port 45227 is in use
   netstat -an | grep 45227
   lsof -i :45227

   # Use a different port
   node index.js start --port 8080
   ```

2. **Check Permissions**
   ```bash
   # Ensure write access to data directory
   ls -la ~/.latzero
   mkdir -p ~/.latzero
   chmod 755 ~/.latzero
   ```

3. **Check Dependencies**
   ```bash
   cd latzero/server
   npm install
   npm ls sql.js
   ```

4. **Check Node.js Version**
   ```bash
   node --version  # Should be 16+
   npm --version
   ```

### Database Initialization Errors

**Symptoms:**
- "Failed to initialize persistence layer"
- SQLite-related errors
- Schema migration failures

**Solutions:**

1. **Clear Database Files**
   ```bash
   rm -rf ~/.latzero/data.db
   rm -rf ~/.latzero/backups/*
   ```

2. **Check Disk Space**
   ```bash
   df -h ~/.latzero
   ```

3. **Manual Schema Creation**
   ```bash
   # Start server with memory-only mode
   node index.js start --memory-mode
   ```

4. **Check File Permissions**
   ```bash
   chmod 644 ~/.latzero/data.db
   ```

## Connection Issues

### Client Cannot Connect

**Symptoms:**
- "Connection refused" errors
- "ECONNREFUSED" messages
- Timeout errors

**Solutions:**

1. **Verify Server Status**
   ```bash
   # Check if server is running
   ps aux | grep latzero
   curl http://localhost:45227/status 2>/dev/null || echo "Server not responding"
   ```

2. **Check Firewall Settings**
   ```bash
   # Linux
   sudo ufw status
   sudo ufw allow 45227

   # macOS
   sudo pfctl -s info
   ```

3. **Verify Host and Port**
   ```bash
   # Test basic connectivity
   telnet localhost 45227
   nc -zv localhost 45227
   ```

4. **Check Network Configuration**
   ```javascript
   // In client code
   const client = new LatZeroClient({
     host: '127.0.0.1',  // Try explicit localhost
     port: 45227,
     timeout: 10000      // Increase timeout
   });
   ```

### Handshake Failures

**Symptoms:**
- "Handshake failed" errors
- "Invalid protocol version" messages
- App registration rejected

**Solutions:**

1. **Check Protocol Version**
   ```javascript
   // Ensure protocol version matches
   const message = {
     protocol_version: '0.1.0',  // Must match server
     // ... other fields
   };
   ```

2. **Validate App ID Format**
   ```javascript
   // App ID requirements
   const client = new LatZeroClient({
     appId: 'valid-app-id',  // No spaces, valid characters
   });
   ```

3. **Check Server Logs**
   ```bash
   # Server should show handshake attempts
   tail -f ~/.latzero/logs/server.log
   ```

4. **Test with Minimal Handshake**
   ```bash
   node test-client.js handshake simple-app
   ```

## Client Errors

### Trigger Operation Failures

**Symptoms:**
- "Trigger failed" errors
- Timeout on trigger calls
- Invalid trigger responses

**Solutions:**

1. **Verify Trigger Registration**
   ```javascript
   // Register triggers during handshake
   await client.handshake({
     triggers: ['echo', 'process', 'my-trigger']
   });
   ```

2. **Check Trigger Payload Format**
   ```javascript
   // Ensure payload is valid JSON
   await client.callTrigger('echo', {
     message: 'test',
     data: { valid: 'json' }
   });
   ```

3. **Increase Timeout**
   ```javascript
   const client = new LatZeroClient({
     timeout: 30000  // 30 seconds
   });
   ```

4. **Check Server-Side Trigger Handling**
   ```bash
   # Look for trigger routing errors in server logs
   grep "trigger" ~/.latzero/logs/server.log
   ```

### Memory Operation Errors

**Symptoms:**
- "Memory block creation failed"
- "Access denied" on memory operations
- Invalid data on read operations

**Solutions:**

1. **Check Memory Block Permissions**
   ```javascript
   await client.createMemoryBlock('my-block', 1024, {
     permissions: {
       read: ['*'],    // Allow all apps to read
       write: ['*']    // Allow all apps to write
     }
   });
   ```

2. **Validate Block Size**
   ```javascript
   // Ensure size is reasonable
   const MAX_SIZE = 1024 * 1024; // 1MB limit
   const size = Math.min(requestedSize, MAX_SIZE);
   ```

3. **Check Block Existence**
   ```javascript
   // Attach before read/write
   await client.attachMemoryBlock('existing-block');
   ```

4. **Verify Data Encoding**
   ```javascript
   // Use Buffer for binary data
   const data = Buffer.from('Hello World');
   await client.writeMemoryBlock('block', 0, data);
   ```

## Performance Issues

### Slow Response Times

**Symptoms:**
- High latency on operations
- Timeout errors under load
- Memory usage spikes

**Solutions:**

1. **Optimize Database Settings**
   ```javascript
   const server = new LatZeroServer({
     cacheSize: 10000,     // Increase cache
     walMode: true,        // Enable WAL
     memoryMode: false     // Use persistent storage
   });
   ```

2. **Monitor Connection Pools**
   ```javascript
   // Check pool status
   const stats = server.getStatus();
   console.log('Active pools:', stats.stats.activePools);
   ```

3. **Enable Compression**
   ```javascript
   // For large payloads
   const compressed = gzipSync(JSON.stringify(largePayload));
   ```

4. **Profile Memory Usage**
   ```bash
   # Monitor Node.js memory
   ps aux | grep node
   node --inspect index.js  # Use Chrome DevTools
   ```

### High Memory Usage

**Symptoms:**
- Server memory consumption growing
- Out of memory errors
- Slow garbage collection

**Solutions:**

1. **Enable Memory Monitoring**
   ```javascript
   // Add memory monitoring
   setInterval(() => {
     const usage = process.memoryUsage();
     console.log('Memory usage:', {
       rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
       heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
       heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB'
     });
   }, 30000);
   ```

2. **Configure Memory Limits**
   ```bash
   # Set Node.js memory limit
   node --max-old-space-size=4096 index.js
   ```

3. **Clean Up Expired Data**
   ```javascript
   // Regular cleanup
   setInterval(() => {
     persistence.cleanupExpiredTriggerRecords();
   }, 60000); // Every minute
   ```

4. **Use Memory Pools Efficiently**
   ```javascript
   // Reuse memory blocks
   const pool = await client.getPool('shared-memory');
   const block = pool.allocate(1024);
   ```

## Debugging Tips

### Enable Debug Logging

```bash
# Server debug logging
node index.js start --log-level debug

# Client debug logging
DEBUG=latzero:* node test-client.js handshake debug-app
```

### Capture Network Traffic

```bash
# Use tcpdump to capture traffic
sudo tcpdump -i lo0 port 45227 -w latzero.pcap

# Analyze with Wireshark
wireshark latzero.pcap
```

### Database Inspection

```bash
# Connect to SQLite database
sqlite3 ~/.latzero/data.db

# Inspect tables
.schema
SELECT * FROM app_registry;
SELECT COUNT(*) FROM trigger_records;
```

### Client-Side Debugging

```javascript
// Add detailed error handling
try {
  await client.connect();
  await client.handshake();
  const result = await client.callTrigger('test');
} catch (error) {
  console.error('Operation failed:', error);
  console.error('Stack trace:', error.stack);
  console.error('Client state:', {
    connected: client.connected,
    appId: client.appId,
    pendingRequests: client.pendingRequests.size
  });
}
```

### Server-Side Debugging

```javascript
// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Log all incoming messages
transport.on('message', (message) => {
  console.log('Received message:', JSON.stringify(message, null, 2));
});
```

## Common Error Codes

| Error Code | Description | Solution |
|------------|-------------|----------|
| ECONNREFUSED | Connection refused | Check server status and port |
| ETIMEDOUT | Operation timeout | Increase timeout values |
| EACCES | Permission denied | Check file/directory permissions |
| ENOMEM | Out of memory | Reduce memory usage or increase limits |
| EPIPE | Broken pipe | Reconnect client |
| ECONNRESET | Connection reset | Check network stability |

## Getting Help

If these solutions don't resolve your issue:

1. **Check Existing Issues**: Search project issue tracker
2. **Gather Diagnostics**:
   ```bash
   # System information
   uname -a
   node --version
   npm --version

   # LatZero version
   grep "version" latzero/server/package.json

   # Log files
   ls -la ~/.latzero/logs/
   tail -100 ~/.latzero/logs/server.log
   ```

3. **Create Minimal Reproduction**: Simplify your test case to isolate the issue
4. **File a Bug Report**: Include system info, logs, and reproduction steps

## Prevention Best Practices

- **Regular Backups**: Enable automatic database backups
- **Monitor Resources**: Track memory and CPU usage
- **Update Dependencies**: Keep Node.js and packages current
- **Test Configurations**: Validate settings before production use
- **Log Rotation**: Implement log rotation to prevent disk space issues