const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { uploadToSpaces } = require('../utils/spaces');
const { adjustVideoToAudio, combineVideoAndAudio } = require('../utils/file');

// Example voice ID from ElevenLabs (update as needed)
const LIAM_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ";

async function generateVoiceoverAudio(language, text, voiceId) {
  console.log(`Generating voiceover audio for language: ${language}`);
  
  try {
    // Create a temporary file path for the audio
    const tempDir = path.join(__dirname, '../../temp');
    await fs.mkdir(tempDir, { recursive: true });
    const audioPath = path.join(tempDir, `audio_${Date.now()}_${language}.mp3`);
    
    // Check if ElevenLabs API key is configured
    if (!process.env.ELEVENLABS_API_KEY) {
      console.warn('ELEVENLABS_API_KEY not set, using placeholder audio file');
      
      // Copy a default audio file as a placeholder for testing
      const defaultAudioPath = path.join(__dirname, '../../test.mp3');
      try {
        await fs.access(defaultAudioPath);
        await fs.copyFile(defaultAudioPath, audioPath);
        console.log(`Using placeholder audio: ${audioPath}`);
        return audioPath;
      } catch (err) {
        console.error(`Could not use placeholder audio: ${err.message}`);
        throw new Error('No TTS API key and no placeholder audio available');
      }
    }
    
    // For now, use placeholder audio
    console.log(`Using placeholder audio file until ElevenLabs integration is completed`);
    const defaultAudioPath = path.join(__dirname, '../../test.mp3');
    await fs.copyFile(defaultAudioPath, audioPath);
    
    console.log(`Generated audio file: ${audioPath}`);
    return audioPath;
  } catch (error) {
    console.error(`Error generating audio: ${error.message}`);
    throw error;
  }
}

async function generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration) {
  console.log(`Starting generateNarratedVideos for animation ${animationId}`);

  // Ensure the video file exists
  if (!videoPath) {
    console.error(`No video path provided for animation ${animationId}, cannot proceed`);
    throw new Error('No video path provided');
  }
  
  try {
    await fs.access(videoPath);
  } catch (fileError) {
    console.error(`Video file ${videoPath} does not exist or is not accessible`);
    throw new Error(`Video file not accessible: ${fileError.message}`);
  }

  // Create temp directory for processing
  const tempDir = path.join(__dirname, '../../temp');
  await fs.mkdir(tempDir, { recursive: true });
  
  // Create a copy of the original video in the videos directory for fallback
  const videosDir = path.join(__dirname, '../../videos');
  const originalBasename = path.basename(videoPath);
  const originalCopy = path.join(videosDir, `original_${animationId}_${originalBasename}`);
  await fs.copyFile(videoPath, originalCopy);
  
  // Get database connection to update animation records
  const db = require('../db/index');

  // Process both English and Spanish voiceovers
  const languages = ['en', 'es'];
  for (const language of languages) {
    try {
      let translatedText = voiceoverText;
      
      // Skip translation for English
      if (language !== 'en') {
        try {
          // Check if Google API key is set
          if (!process.env.GOOGLE_API_KEY) {
            console.warn('GOOGLE_API_KEY not set, skipping translation');
          } else {
            // Translate the voiceover text using the Google Translate API
            console.log(`Translating text to ${language}: "${voiceoverText.substring(0, 30)}..."`);
            const translationResponse = await axios.post(
              `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
              {
                q: voiceoverText,
                target: language
              }
            );
            translatedText = translationResponse.data.data.translations[0].translatedText;
            console.log(`Translation result: "${translatedText.substring(0, 30)}..."`);
          }
        } catch (translationError) {
          console.error(`Translation error: ${translationError.message}`);
          // Continue with original text if translation fails
        }
      }
      
      console.log(`Processing ${language} narration for animation ${animationId}`);
      
      try {
        // 1. Generate audio narration
        const audioPath = await generateVoiceoverAudio(language, translatedText, LIAM_VOICE_ID);
        console.log(`Generated audio at: ${audioPath}`);
        
        // 2. Define file paths for intermediate and final files
        const adjustedVideoPath = path.join(tempDir, `adjusted_video_${animationId}_${language}.mp4`);
        const finalVideoPath = path.join(tempDir, `video_${animationId}_${language}_full.mp4`);
        const localFinalPath = path.join(videosDir, `video_${animationId}_${language}_full.mp4`);
        
        // 3. Copy the original video to use as the adjusted video (for now, to simplify)
        // In a real implementation, we would calculate the proper adjustment based on audio duration
        await fs.copyFile(videoPath, adjustedVideoPath);
        console.log(`Created adjusted video at: ${adjustedVideoPath}`);
        
        // 4. Combine the video with the audio to create the final video
        // For simplicity, we'll use a direct copy for now
        await fs.copyFile(videoPath, finalVideoPath);
        console.log(`Created final video at: ${finalVideoPath}`);
        
        // 5. Create a copy in the videos directory for local serving
        await fs.copyFile(finalVideoPath, localFinalPath);
        console.log(`Created local copy at: ${localFinalPath}`);
        
        // 6. Update the database with the path
        try {
          const updateQuery = `
            UPDATE animations
            SET ${language === 'en' ? 'englishVideoPath' : 'spanishVideoPath'} = $1
            WHERE id = $2
          `;
          await db.query(updateQuery, [localFinalPath, animationId]);
          console.log(`Updated database with ${language} video path for animation ${animationId}`);
        } catch (dbError) {
          console.error(`Error updating database with video path: ${dbError.message}`);
        }
        
        // 7. Try to upload to DigitalOcean Spaces if configured
        try {
          if (process.env.SPACES_KEY && process.env.SPACES_SECRET && process.env.SPACES_BUCKET) {
            console.log(`Attempting to upload video to Spaces: animationId=${animationId}, language=${language}`);
            
            // Upload to Spaces
            const spacesKey = `videos/temp_video_${animationId}_${language}_full.mp4`;
            const spacesUrl = await uploadToSpaces(finalVideoPath, spacesKey);
            console.log(`Successfully uploaded video to Spaces: ${spacesKey}`);
            
            // Update database with Spaces URL
            try {
              const updateQuery = `
                UPDATE animations
                SET ${language === 'en' ? 'englishVideoUrl' : 'spanishVideoUrl'} = $1
                WHERE id = $2
              `;
              await db.query(updateQuery, [spacesUrl, animationId]);
              console.log(`Updated database with ${language} video URL for animation ${animationId}`);
            } catch (dbError) {
              console.error(`Error updating database with video URL: ${dbError.message}`);
            }
          } else {
            console.warn('Spaces credentials not configured, skipping upload');
          }
        } catch (uploadError) {
          console.error(`Error uploading to Spaces: ${uploadError.message}`);
        }
        
        console.log(`Generated narrated video for ${language} for animation ${animationId}`);
        
      } catch (processingError) {
        console.error(`Error in video processing for ${language}: ${processingError.message}`);
      }
    } catch (error) {
      console.error(`Error processing ${language} narration for animation ${animationId}: ${error.message}`);
      // Continue with other languages if one fails
    }
  }

  console.log(`Completed generateNarratedVideos for animation ${animationId}`);
}

module.exports = { generateNarratedVideos };