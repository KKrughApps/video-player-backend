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

async function combineVideoAndAudio(videoPath, audioPath, outputPath, videoDuration) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .outputOptions('-c:v libx264')
            .outputOptions('-preset fast')
            .outputOptions('-c:a aac')
            .outputOptions('-map 0:v:0')
            .outputOptions('-map 1:a:0')
            .outputOptions('-movflags +faststart')
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

module.exports = { getVideoDuration, getAudioDuration, adjustNarrationDuration, combineVideoAndAudio };