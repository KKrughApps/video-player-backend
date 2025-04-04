const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { uploadToSpaces } = require('../utils/spaces');
const { adjustVideoToAudio, combineVideoAndAudio } = require('../utils/file');

// Example voice ID from ElevenLabs (update as needed)
const LIAM_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ";

async function generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration) {
  console.log(`Starting generateNarratedVideos for animation ${animationId}`);

  // Ensure the video file exists
  if (!videoPath) {
    console.error(`No video path provided for animation ${animationId}, cannot proceed`);
    return;
  }
  try {
    await fs.access(videoPath);
  } catch (fileError) {
    console.error(`Video file ${videoPath} does not exist or is not accessible`);
    return;
  }

  // Process both English and Spanish voiceovers
  const languages = ['en', 'es'];
  for (const language of languages) {
    try {
      let translatedText = voiceoverText;
      if (language !== 'en') {
        // Translate the voiceover text using the Google Translate API
        const translationResponse = await axios.post(
          `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
          {
            q: voiceoverText,
            target: language
          }
        );
        translatedText = translationResponse.data.data.translations[0].translatedText;
      }
      console.log(`Processing ${language} narration for animation ${animationId}`);
      
      // Here you would generate the narration audio using a TTS API (e.g., ElevenLabs)
      // For example:
      // const audioPath = await generateVoiceoverAudio(language, translatedText, LIAM_VOICE_ID);
      // Then adjust the video duration to match the audio:
      // const adjustedVideoPath = await adjustVideoToAudio(videoPath, audioPath, outputPath);
      // Combine the adjusted video with the narration audio:
      // const finalVideoPath = await combineVideoAndAudio(adjustedVideoPath, audioPath, finalOutputPath);
      // Upload the final narrated video to DigitalOcean Spaces:
      // await uploadToSpaces(finalVideoPath, `videos/${path.basename(finalVideoPath)}`);
      
      // For now, we simulate the process with a delay and log:
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log(`Generated narrated video for ${language} for animation ${animationId}`);
      
    } catch (error) {
      console.error(`Error processing ${language} narration for animation ${animationId}: ${error.message}`);
    }
  }

  console.log(`Completed generateNarratedVideos for animation ${animationId}`);
}

module.exports = { generateNarratedVideos };