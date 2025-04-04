const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

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
    try {
        console.log(`Starting video adjustment: video=${videoPath}, audio=${audioPath}, output=${outputPath}`);
        
        // Validate input files exist
        try {
            await fs.promises.access(videoPath, fs.constants.R_OK);
            console.log(`Video file exists and is readable: ${videoPath}`);
        } catch (err) {
            console.error(`Input video file not accessible: ${videoPath}`, err);
            throw new Error(`Input video file not accessible: ${videoPath}`);
        }
        
        try {
            await fs.promises.access(audioPath, fs.constants.R_OK);
            console.log(`Audio file exists and is readable: ${audioPath}`);
        } catch (err) {
            console.error(`Input audio file not accessible: ${audioPath}`, err);
            throw new Error(`Input audio file not accessible: ${audioPath}`);
        }
        
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
            const command = ffmpeg(videoPath)
                // Adjust video speed without changing audio
                .videoFilters(`setpts=${1/speedFactor}*PTS`)
                .noAudio() // Remove any original audio
                .output(outputPath);
            
            // Log the command
            console.log('FFmpeg command:', command._getArguments().join(' '));
            
            command
                .on('start', cmdline => {
                    console.log(`FFmpeg started with command: ${cmdline}`);
                })
                .on('progress', progress => {
                    console.log(`Processing: ${Math.floor(progress.percent || 0)}% done`);
                })
                .on('end', () => {
                    console.log(`FFmpeg processing finished: ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error(`FFmpeg processing error:`, err);
                    reject(err);
                })
                .run();
        });
    } catch (err) {
        console.error(`Failed to adjust video to audio:`, err);
        throw err;
    }
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
    try {
        console.log(`Starting video-audio combination: video=${videoPath}, audio=${audioPath}, output=${outputPath}`);
        
        // Validate input files exist
        try {
            await fs.promises.access(videoPath, fs.constants.R_OK);
            console.log(`Video file exists and is readable: ${videoPath}`);
        } catch (err) {
            console.error(`Input video file not accessible: ${videoPath}`, err);
            throw new Error(`Input video file not accessible: ${videoPath}`);
        }
        
        try {
            await fs.promises.access(audioPath, fs.constants.R_OK);
            console.log(`Audio file exists and is readable: ${audioPath}`);
        } catch (err) {
            console.error(`Input audio file not accessible: ${audioPath}`, err);
            throw new Error(`Input audio file not accessible: ${audioPath}`);
        }
        
        // Ensure output directory exists
        const outputDir = require('path').dirname(outputPath);
        await fs.promises.mkdir(outputDir, { recursive: true }).catch(err => {
            console.log(`Output directory already exists or creation failed: ${outputDir}`, err);
        });
        
        return new Promise((resolve, reject) => {
            const command = ffmpeg()
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
                .output(outputPath);
                
            // Log the command
            console.log('FFmpeg combineVideoAndAudio command:', command._getArguments().join(' '));
            
            command
                .on('start', cmdline => {
                    console.log(`FFmpeg combination started with command: ${cmdline}`);
                })
                .on('progress', progress => {
                    console.log(`Combining: ${Math.floor(progress.percent || 0)}% done`);
                })
                .on('end', () => {
                    console.log(`FFmpeg combination finished: ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error(`FFmpeg combination error:`, err);
                    reject(err);
                })
                .run();
        });
    } catch (err) {
        console.error(`Failed to combine video and audio:`, err);
        throw err;
    }
}

module.exports = { 
    getVideoDuration, 
    getAudioDuration, 
    adjustNarrationDuration, 
    adjustVideoToAudio,
    combineVideoAndAudio
};