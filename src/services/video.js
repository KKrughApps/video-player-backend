const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { uploadToSpaces } = require('../utils/spaces');
const { adjustVideoToAudio, combineVideoAndAudio } = require('../utils/file');

// Liam voice ID from ElevenLabs
const LIAM_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ";

async function generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration) {
    console.log(`Starting generateNarratedVideos for animation ${animationId}`);
    
    // Check if video exists
    if (!videoPath) {
        console.error(`No video path provided for animation ${animationId}, cannot proceed`);
        return;
    }
    
    try {
        // Verify that the video file exists
        try {
            await fs.access(videoPath);
        } catch (fileError) {
            console.error(`Video file ${videoPath} does not exist or is not accessible`);
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

            // Define file paths
            const narrationFile = `narration_${language}.mp3`;
            const adjustedVideoFile = `adjusted_video_${animationId}_${language}.mp4`;
            const outputVideoFile = `temp_video_${animationId}_${language}_full.mp4`;

            console.log(`Calling ElevenLabs API with text: ${translatedText}, language: ${language}`);
            // Using Liam's voice (male voice)
            const narrationResponse = await axios({
                method: 'post',
                url: `https://api.elevenlabs.io/v1/text-to-speech/${LIAM_VOICE_ID}`,
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

            try {
                // Adjust the video speed to match the narration duration
                await adjustVideoToAudio(videoPath, narrationFile, adjustedVideoFile);
                console.log(`Adjusted video speed to match narration: ${adjustedVideoFile}`);
                
                // Combine the adjusted video with the narration audio
                await combineVideoAndAudio(adjustedVideoFile, narrationFile, outputVideoFile);
                console.log(`Combined adjusted video with narration: ${outputVideoFile}`);
    
                // Upload the final video to Spaces
                const spacesPath = `videos/${outputVideoFile}`;
                const videoUrl = await uploadToSpaces(outputVideoFile, spacesPath);
                console.log(`Uploaded video to Spaces: ${videoUrl}`);
            } catch (videoError) {
                console.error(`Error processing video: ${videoError.message}`);
                // Upload just the narration file if video processing fails
                const spacesPath = `audios/narration_${animationId}_${language}.mp3`;
                await uploadToSpaces(narrationFile, spacesPath);
                console.log(`Uploaded narration to Spaces as fallback`);
            }
            
            // Clean up temporary files
            await fs.unlink(narrationFile).catch(err => console.warn(`Error deleting ${narrationFile}: ${err.message}`));
            try {
                await fs.access(adjustedVideoFile);
                await fs.unlink(adjustedVideoFile).catch(err => console.warn(`Error deleting ${adjustedVideoFile}: ${err.message}`));
            } catch (err) {
                // Ignore if file doesn't exist
            }
            try {
                await fs.access(outputVideoFile);
                await fs.unlink(outputVideoFile).catch(err => console.warn(`Error deleting ${outputVideoFile}: ${err.message}`));
            } catch (err) {
                // Ignore if file doesn't exist
            }
        } catch (err) {
            console.error(`Error in video generation for animation ${animationId} in language ${language}: ${err.message}`);
            throw err;
        }
    }
}

module.exports = { generateNarratedVideos };