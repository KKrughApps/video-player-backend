import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../shared/utils/logger';
import { Animation, AnimationStatus, HttpError, SupportedLanguage, UploadRequest } from '../../shared/types';
import { uploadFile } from '../storage';
import { addProcessingJob } from './queue';
import * as AnimationModel from '../../shared/models/Animation';

const logger = createLogger('UploadController');

/**
 * Process a validated upload request
 */
export const processUpload = async (request: UploadRequest): Promise<{ animationId: number }> => {
  try {
    logger.info(`Processing upload for: ${request.name}`);
    
    // Generate a unique key for the video
    const fileExtension = request.filename.split('.').pop();
    const videoKey = `uploads/original/${uuidv4()}.${fileExtension}`;
    
    // Upload the file to storage
    await uploadFile(request.file, videoKey, request.mimetype);
    logger.info(`Video uploaded to storage with key: ${videoKey}`);
    
    // Create the animation record in the database
    const animation = await AnimationModel.createAnimation({
      name: request.name,
      voiceover_text: request.voiceover_text,
      original_video_key: videoKey,
      status: AnimationStatus.PENDING,
    });
    
    logger.info(`Animation record created with ID: ${animation.id}`);
    
    // Get supported languages
    const languages = Object.values(SupportedLanguage);
    
    // Create a processing job
    await addProcessingJob({
      animationId: animation.id,
      languages,
      originalVideoKey: videoKey,
      voiceoverText: request.voiceover_text,
    });
    
    logger.info(`Processing job queued for animation ID: ${animation.id}`);
    
    // Update animation status to processing
    await AnimationModel.updateAnimationStatus(animation.id, AnimationStatus.PROCESSING);
    
    return { animationId: animation.id };
  } catch (error) {
    logger.error('Error processing upload:', error);
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Failed to process upload', 500);
  }
};