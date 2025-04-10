import fetch from 'node-fetch';
import { createLogger } from '../../shared/utils/logger';
import { API_KEYS } from '../../shared/config/environment';
import { HttpError } from '../../shared/types';

const logger = createLogger('TTSService');

// Voice IDs for different languages
const VOICE_IDS: Record<string, string> = {
  en: 'XrExE9yKIg1WjnnlVkGX', // Adam - English
  es: 'uSFgDUj3BMcJP1MIkZKi', // Mia - Spanish
  fr: 'Je6kXH7jQAWbmypt0QiC', // Remi - French
  de: 'BkrCME9KdCfbtSKQbhYJ', // Valentin - German
  it: 'SvHeRyUNoMajSwwgIbVK', // Matteo - Italian
  pt: 'GBv7mTt0atIp3Br8iCZE', // Pedro - Portuguese
};

/**
 * Generate speech from text using ElevenLabs API
 */
export const generateSpeech = async (text: string, language: string): Promise<Buffer> => {
  logger.info(`Generating speech for text in ${language}`);
  
  try {
    // Check if API key is available
    if (!API_KEYS.ELEVENLABS) {
      throw new Error('ElevenLabs API key is not configured');
    }
    
    // Get the appropriate voice ID for the language
    const voiceId = VOICE_IDS[language] || VOICE_IDS.en;
    
    // Prepare the request
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': API_KEYS.ELEVENLABS,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
        },
      }),
    };
    
    // Make the request
    const response = await fetch(url, options);
    
    // Check for errors
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`ElevenLabs API error: ${errorText}`);
      throw new HttpError('Failed to generate speech', 500);
    }
    
    // Get the audio data
    const audioBuffer = await response.buffer();
    
    logger.info(`Speech generation successful, received ${audioBuffer.length} bytes`);
    return audioBuffer;
  } catch (error) {
    logger.error(`Failed to generate speech: ${error}`);
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Failed to generate speech', 500);
  }
};