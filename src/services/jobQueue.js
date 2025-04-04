const Bull = require('bull');
const { generateNarratedVideos } = require('./video');

// Configure the Bull queue with Redis connection details from environment variables
const videoQueue = new Bull('videoQueue', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || ''
  }
});

// Attach a process handler so that jobs are processed
videoQueue.process(async (job) => {
  const { animationId, videoPath, voiceoverText, originalDuration } = job.data;
  console.log(`Processing job #${job.id} for animation ${animationId}`);
  try {
    await generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration);
    console.log(`Job #${job.id} complete for animation ${animationId}`);
  } catch (error) {
    console.error(`Error processing job #${job.id}:`, error);
    throw error;
  }
});

module.exports = videoQueue;