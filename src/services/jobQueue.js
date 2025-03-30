const Queue = require('bull');

const videoQueue = new Queue('video-processing', process.env.REDIS_URL, {
    redis: { tls: { rejectUnauthorized: false } }
});

videoQueue.on('error', (error) => {
    console.error('Bull Queue Error:', error);
});

videoQueue.on('active', (job) => {
    console.log(`Job ${job.id} is now active`);
});

module.exports = videoQueue;