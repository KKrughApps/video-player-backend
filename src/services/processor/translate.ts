import fetch from 'node-fetch';
import { createLogger } from '../../shared/utils/logger';
import { API_KEYS } from '../../shared/config/environment';
import { HttpError } from '../../shared/types';

const logger = createLogger('TranslationService');

/**
 * Translate text to the target language using Google Translate API
 */
export const translateText = async (text: string, targetLanguage: string): Promise<string> => {
  logger.info(`Translating text to ${targetLanguage}`);

  try {
    // Check if API key is available
    if (!API_KEYS.GOOGLE) {
      throw new Error('Google API key is not configured');
    }

    // Prepare the request
    const url = `https://translation.googleapis.com/language/translate/v2?key=${API_KEYS.GOOGLE}`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: text,
        target: targetLanguage,
        format: 'text',
      }),
    };

    // Make the request
    const response = await fetch(url, options);
    const data = await response.json() as any;

    // Check for errors
    if (!response.ok || data.error) {
      logger.error(`Translation API error: ${JSON.stringify(data.error || 'Unknown error')}`);
      throw new HttpError('Failed to translate text', 500);
    }

    // Extract the translated text
    const translatedText = data.data.translations[0].translatedText;
    
    logger.info(`Translation to ${targetLanguage} successful`);
    return translatedText;
  } catch (error) {
    logger.error(`Failed to translate text: ${error}`);
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Failed to translate text', 500);
  }
};