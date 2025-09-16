const { initializeDatabase } = require('./src/config/database');
const { connectRedis } = require('./src/config/redis');
const logger = require('./src/utils/logger');

async function testConnections() {
  try {
    console.log('Testing database connection...');
    await initializeDatabase();
    console.log('✅ Database connected successfully');
    
    console.log('Testing Redis connection...');
    await connectRedis();
    console.log('✅ Redis connected successfully');
    
    console.log('All connections successful!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testConnections();