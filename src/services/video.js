const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { uploadToSpaces } = require('../utils/spaces');

async function generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration) {
    console.log(`Starting generateNarratedVideos for animation ${animationId}`);
    
    // Check if video exists
    if (!videoPath) {
        console.log(`No video path provided for animation ${animationId}, generating audio only`);
        // Handle case where there's no video - just create the audio narration
        await generateNarrationOnly(animationId, voiceoverText, originalDuration);
        return;
    }
    
    try {
        // Verify that the video file exists
        try {
            await fs.access(videoPath);
        } catch (fileError) {
            console.error(`Video file ${videoPath} does not exist or is not accessible`);
            // Generate audio only if video file isn't available
            await generateNarrationOnly(animationId, voiceoverText, originalDuration);
            return;
        }
    } catch (error) {
        console.error(`Error checking video file: ${error.message}`);
        return;
    }
    
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

            try {
                const videoMetadata = await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(videoPath, (err, metadata) => {
                        if (err) return reject(err);
                        resolve(metadata);
                    });
                });
                
                const hasAudioStream = videoMetadata.streams.some(stream => stream.codec_type === 'audio');
                console.log(`Video has audio stream: ${hasAudioStream}`);
    
                // Regardless of whether the original video has audio, use the narration file as the audio source
                await new Promise((resolve, reject) => {
                    // Create a new ffmpeg command for the video file
                    let command = ffmpeg(videoPath)
                        .input(adjustedNarrationFile)
                        .outputOptions('-c:v copy')      // Copy video stream without re-encoding
                        .outputOptions('-c:a aac')       // Use AAC for audio
                        .outputOptions('-b:a 192k')      // Set audio bitrate
                        .outputOptions('-map 0:v:0')     // Use the first video stream from the first input
                        .outputOptions('-map 1:a:0')     // Use the first audio stream from the second input
                        .output(outputVideoFile);
                    
                    // Log the ffmpeg command for debugging
                    console.log('FFMPEG command:', command._getArguments().join(' '));
                    
                    command.on('start', (commandLine) => {
                        console.log('FFmpeg started with command:', commandLine);
                    })
                    .on('end', () => {
                        console.log(`FFmpeg successfully processed ${outputVideoFile}`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('FFmpeg error:', err);
                        reject(err);
                    })
                    .run();
                });
    
                const spacesPath = `videos/${outputVideoFile}`;
                const videoUrl = await uploadToSpaces(outputVideoFile, spacesPath);
                console.log(`Uploaded video to Spaces: ${videoUrl}`);
            } catch (videoError) {
                console.error(`Error processing video: ${videoError.message}`);
                // Upload just the narration file if video processing fails
                const spacesPath = `audios/narration_${animationId}_${language}.mp3`;
                await uploadToSpaces(adjustedNarrationFile, spacesPath);
                console.log(`Uploaded narration to Spaces as fallback`);
            }
            
            // Clean up temporary files
            await fs.unlink(narrationFile).catch(err => console.warn(`Error deleting ${narrationFile}: ${err.message}`));
            await fs.unlink(adjustedNarrationFile).catch(err => console.warn(`Error deleting ${adjustedNarrationFile}: ${err.message}`));
            try {
                // Only try to delete output video if it exists
                await fs.access(outputVideoFile);
                await fs.unlink(outputVideoFile);
            } catch (err) {
                // Ignore error if file doesn't exist
            }
        } catch (err) {
            console.error(`Error in video generation for animation ${animationId} in language ${language}: ${err.message}`);
            throw err;
        }
    }
}

// Function to generate narration audio only (no video)
async function generateNarrationOnly(animationId, voiceoverText, originalDuration) {
    console.log(`Generating narration only for animation ${animationId}`);
    const languages = ['en', 'es'];

    for (const language of languages) {
        try {
            // Translate text if needed
            let translatedText = voiceoverText;
            if (language !== 'en') {
                try {
                    const translationResponse = await axios.post(
                        `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
                        {
                            q: voiceoverText,
                            target: language,
                        }
                    );
                    translatedText = translationResponse.data.data.translations[0].translatedText;
                    console.log(`Translated text for ${language}: ${translatedText}`);
                } catch (translationError) {
                    console.error(`Translation error: ${translationError.message}`);
                    // Continue with original text if translation fails
                }
            }

            // Generate audio files
            const narrationFile = `narration_${animationId}_${language}.mp3`;
            
            try {
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
                console.log(`Generated narration file: ${narrationFile}`);
                
                // Upload the narration directly to Spaces
                const spacesPath = `audios/narration_${animationId}_${language}.mp3`;
                await uploadToSpaces(narrationFile, spacesPath);
                console.log(`Uploaded narration to ${spacesPath}`);
                
                // Clean up local file
                await fs.unlink(narrationFile).catch(err => console.warn(`Error deleting ${narrationFile}: ${err.message}`));
            } catch (audioError) {
                console.error(`Error generating or uploading audio: ${audioError.message}`);
            }
        } catch (err) {
            console.error(`Error generating narration for animation ${animationId} in language ${language}: ${err.message}`);
        }
    }
}

module.exports = { generateNarratedVideos, generateNarrationOnly };