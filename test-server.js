// Simple test server to debug Railway deployment
const http = require('http');
const port = process.env.PORT || 3000;

console.log('🚀 Starting test server...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', port);
console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('DATABASE') || key.includes('REDIS') || key.includes('GOOGLE')));

const server = http.createServer((req, res) => {
  console.log(`📥 Request: ${req.method} ${req.url}`);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'OK',
    message: 'Test server is working!',
    timestamp: new Date().toISOString(),
    port: port,
    env: process.env.NODE_ENV,
    uptime: process.uptime()
  }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`✅ Test server running on port ${port}`);
  console.log(`🌐 Server accessible at http://0.0.0.0:${port}`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

console.log('🔄 Test server setup complete');