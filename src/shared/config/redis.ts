import Redis from 'ioredis';
import { REDIS } from './environment';

// Redis connection options
const redisOptions: Redis.RedisOptions = {
  host: REDIS.HOST,
  port: REDIS.PORT,
  password: REDIS.PASSWORD || undefined,
};

// Add TLS if enabled
if (REDIS.TLS) {
  redisOptions.tls = {};
}

// Create Redis client
export const redis = new Redis(redisOptions);

// Initialize Redis connection
export const initializeRedis = async (): Promise<boolean> => {
  try {
    // Verify connection with PING
    await redis.ping();
    console.log('Redis connection established successfully');
    return true;
  } catch (error) {
    console.error('Redis connection failed:', error);
    throw error;
  }
};

// Set up event handlers for Redis connection
redis.on('error', (error) => {
  console.error('Redis error:', error);
});

redis.on('reconnecting', () => {
  console.log('Redis reconnecting...');
});

redis.on('connect', () => {
  console.log('Redis connected');
});

export default redis;