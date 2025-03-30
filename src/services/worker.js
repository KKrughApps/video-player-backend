const videoQueue = require('./jobQueue');
const { generateNarratedVideos } = require('./video');

videoQueue.process('generate-narrated-videos', async (job) => {
    const { animationId, videoPath, voiceoverText, originalDuration } = job.data;
    console.log(`Processing job ${job.id}: Generating narrated videos for animation ${animationId}`);
    await generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration);
    console.log(`Job ${job.id} completed: Narrated videos generated for animation ${animationId}`);
});

videoQueue.on('completed', (job) => {
    console.log(`Job ${job.id} has been completed`);
});

videoQueue.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed with error: ${err.message}`);
});