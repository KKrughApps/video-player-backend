const Bull = require('bull');

// Configure the Bull queue with Redis connection details from environment variables
const videoQueue = new Bull('videoQueue', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || ''
  }
});

// Set up error and event handlers
videoQueue.on('error', (error) => {
  console.error('Bull Queue Error:', error);
});

videoQueue.on('active', (job) => {
  console.log(`Job ${job.id} is now active`);
});

// Note: Processing logic is defined in worker.js to avoid duplicate processing

module.exports = videoQueue;