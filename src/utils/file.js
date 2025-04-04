const ffmpeg = require('fluent-ffmpeg');

async function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
        });
    });
}

async function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
        });
    });
}

/**
 * Adjust video speed to match narration duration
 * @param {string} videoPath - Path to the input video file
 * @param {string} audioPath - Path to the narration audio file
 * @param {string} outputPath - Path to save the adjusted video
 * @returns {Promise<string>} - Path to the adjusted video
 */
async function adjustVideoToAudio(videoPath, audioPath, outputPath) {
    // Get durations
    const videoDuration = await getVideoDuration(videoPath);
    const audioDuration = await getAudioDuration(audioPath);
    
    // Calculate target video duration:
    // Audio + 3 seconds (1 second before narration starts, 2 seconds after it ends)
    const targetDuration = audioDuration + 3;
    
    // Calculate speed factor (how much to slow down or speed up video)
    const speedFactor = videoDuration / targetDuration;
    
    console.log(`Adjusting video speed: 
      - Original video duration: ${videoDuration}s
      - Audio duration: ${audioDuration}s
      - Target duration: ${targetDuration}s
      - Speed factor: ${speedFactor}`);
    
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            // Adjust video speed without changing audio
            .videoFilters(`setpts=${1/speedFactor}*PTS`)
            .noAudio() // Remove any original audio
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

/**
 * Legacy function kept for backward compatibility
 * @deprecated Use adjustVideoToAudio instead
 */
async function adjustNarrationDuration(inputPath, outputPath, videoDuration) {
    const audioDuration = await getAudioDuration(inputPath);
    const targetSpokenDuration = videoDuration - 2;
    const spokenDurationWithDelay = targetSpokenDuration - 1;
    let paddingDuration = spokenDurationWithDelay - audioDuration;
    let audioFilters = ['adelay=1000|1000'];
    if (paddingDuration < 0) {
        audioFilters.push(`atrim=end=${spokenDurationWithDelay}`);
        paddingDuration = 0;
    } else if (paddingDuration > 0) {
        audioFilters.push(`apad=pad_dur=${paddingDuration}`);
    }

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioFilters(audioFilters)
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

/**
 * Combine video and audio with a 1-second delay for the audio
 */
async function combineVideoAndAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .complexFilter([
                // Add a 1-second delay to the audio
                'adelay=1000|1000[delayedaudio]'
            ], ['delayedaudio'])
            .outputOptions('-c:v libx264')
            .outputOptions('-preset fast')
            .outputOptions('-c:a aac')
            .outputOptions('-map 0:v:0') // Use video from first input
            .outputOptions('-map [delayedaudio]') // Use processed audio
            .outputOptions('-movflags +faststart')
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

module.exports = { 
    getVideoDuration, 
    getAudioDuration, 
    adjustNarrationDuration, 
    adjustVideoToAudio,
    combineVideoAndAudio
};