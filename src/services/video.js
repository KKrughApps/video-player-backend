const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const bucketName = process.env.SPACES_BUCKET;
const spacesEndpoint = process.env.SPACES_ENDPOINT;

async function generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration) {
    console.log(`Starting generateNarratedVideos for animation ${animationId}`);
    const languages = ['en', 'es'];

    for (const language of languages) {
        try {
            let translatedText = voiceoverText;
            if (language !== 'en') {
                const translationResponse = await axios.post(
                    `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
                    {
                        q: voiceoverText,
                        target: language,
                    }
                );
                translatedText = translationResponse.data.data.translations[0].translatedText;
            }
            console.log(`Translated text for ${language}: ${translatedText}`);

            const narrationFile = `narration_${language}.mp3`;
            const adjustedNarrationFile = `narration_adjusted_${language}.mp3`;
            const outputVideoFile = `temp_video_${animationId}_${language}_full.mp4`;

            console.log(`Calling ElevenLabs API with text: ${translatedText}, language: ${language}`);
            const narrationResponse = await axios({
                method: 'post',
                url: 'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM',
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                },
                data: {
                    text: translatedText,
                    voice_settings: {
                        stability: 0.75,
                        similarity_boost: 0.75,
                    },
                },
                responseType: 'arraybuffer',
            });

            await fs.writeFile(narrationFile, narrationResponse.data);

            const narrationDuration = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(narrationFile, (err, metadata) => {
                    if (err) return reject(err);
                    resolve(metadata.format.duration);
                });
            });

            const stretchFactor = originalDuration / narrationDuration;
            await new Promise((resolve, reject) => {
                ffmpeg(narrationFile)
                    .audioFilter(`atempo=${stretchFactor}`)
                    .output(adjustedNarrationFile)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            // Check if the input video has an audio stream
            const videoMetadata = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(videoPath, (err, metadata) => {
                    if (err) return reject(err);
                    resolve(metadata);
                });
            });

            const hasAudioStream = videoMetadata.streams.some(stream => stream.codec_type === 'audio');

            if (hasAudioStream) {
                // If the video has audio, mix it with the narration
                await new Promise((resolve, reject) => {
                    ffmpeg(videoPath)
                        .input(adjustedNarrationFile)
                        .complexFilter([
                            '[0:a][1:a]amix=inputs=2:duration=longest',
                        ])
                        .output(outputVideoFile)
                        .on('end', resolve)
                        .on('error', reject)
                        .run();
                });
            } else {
                // If the video has no audio, just add the narration as the audio stream
                await new Promise((resolve, reject) => {
                    ffmpeg(videoPath)
                        .input(adjustedNarrationFile)
                        .outputOptions('-c:v copy') // Copy video stream without re-encoding
                        .outputOptions('-c:a aac')  // Encode audio as AAC
                        .output(outputVideoFile)
                        .on('end', resolve)
                        .on('error', reject)
                        .run();
                });
            }

            const spacesPath = `videos/${outputVideoFile}`;
            await storage.bucket(bucketName).upload(outputVideoFile, {
                destination: spacesPath,
                metadata: {
                    contentType: 'video/mp4',
                },
            });

            const videoUrl = `https://${bucketName}.${spacesEndpoint}/${spacesPath}`;
            await fs.unlink(narrationFile);
            await fs.unlink(adjustedNarrationFile);
            await fs.unlink(outputVideoFile);
        } catch (err) {
            console.error(`Error in video generation for animation ${animationId} in language ${language}: ${err.message}`);
            throw err;
        }
    }
}

module.exports = { generateNarratedVideos };