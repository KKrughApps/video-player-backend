import Queue from 'bull';
import { createLogger } from '../../shared/utils/logger';
import { REDIS, PROCESSING } from '../../shared/config/environment';
import { ProcessingJobData, AnimationStatus, ProcessedVideoStatus } from '../../shared/types';
import * as AnimationModel from '../../shared/models/Animation';
import * as ProcessedVideoModel from '../../shared/models/ProcessedVideo';
import { translateText } from './translate';
import { generateSpeech } from './tts';
import { processVideo } from './ffmpeg';

const logger = createLogger('ProcessorWorker');

// Create the video processing queue
const processingQueue = new Queue<ProcessingJobData>('video-processing', {
  redis: {
    host: REDIS.HOST,
    port: REDIS.PORT,
    password: REDIS.PASSWORD || undefined,
    tls: REDIS.TLS ? {} : undefined,
  },
});

/**
 * Process a single language for a video
 */
const processLanguage = async (
  jobData: ProcessingJobData,
  language: string
): Promise<string> => {
  logger.info(`Processing language: ${language} for animation: ${jobData.animationId}`);
  
  try {
    // Create a processed video record in pending state
    const processedVideo = await ProcessedVideoModel.createProcessedVideo({
      animation_id: jobData.animationId,
      language,
      video_key: '',
      status: ProcessedVideoStatus.PROCESSING,
    });
    
    logger.info(`Created processed video record: ${processedVideo.id}`);
    
    // Step 1: Translate the text if needed
    let translatedText = jobData.voiceoverText;
    if (language !== 'en') {
      translatedText = await translateText(jobData.voiceoverText, language);
      logger.info(`Text translated to ${language}`);
    }
    
    // Step 2: Generate speech from text
    const audioBuffer = await generateSpeech(translatedText, language);
    logger.info(`Speech generated for ${language}`);
    
    // Step 3: Process video with audio
    const videoKey = await processVideo(jobData.originalVideoKey, audioBuffer, jobData.animationId, language);
    logger.info(`Video processed with ${language} audio: ${videoKey}`);
    
    // Update the processed video record
    await ProcessedVideoModel.updateProcessedVideo(processedVideo.id, {
      video_key: videoKey,
      status: ProcessedVideoStatus.READY,
    });
    
    logger.info(`Completed processing for language: ${language}`);
    return videoKey;
  } catch (error) {
    logger.error(`Error processing language ${language} for animation ${jobData.animationId}:`, error);
    
    // Update the processed video record to error state
    const existingVideo = await ProcessedVideoModel.getProcessedVideoByAnimationAndLanguage(
      jobData.animationId,
      language
    );
    
    if (existingVideo) {
      await ProcessedVideoModel.updateProcessedVideoStatus(
        existingVideo.id,
        ProcessedVideoStatus.ERROR
      );
    }
    
    throw error;
  }
};

/**
 * Process a video for all requested languages
 */
const processVideoWithNarration = async (jobData: ProcessingJobData): Promise<void> => {
  logger.info(`Starting processing for animation: ${jobData.animationId}`);
  
  try {
    // Update animation status to processing
    await AnimationModel.updateAnimationStatus(jobData.animationId, AnimationStatus.PROCESSING);
    
    // Process each language in parallel
    const languagePromises = jobData.languages.map((language) => 
      processLanguage(jobData, language)
    );
    
    await Promise.all(languagePromises);
    
    // Update animation status to ready
    await AnimationModel.updateAnimationStatus(jobData.animationId, AnimationStatus.READY);
    
    logger.info(`Completed processing for animation: ${jobData.animationId}`);
  } catch (error) {
    logger.error(`Error processing animation ${jobData.animationId}:`, error);
    
    // Update animation status to error
    await AnimationModel.updateAnimationStatus(jobData.animationId, AnimationStatus.ERROR);
    
    throw error;
  }
};

/**
 * Set up the processing worker
 */
export const setupProcessingWorker = async (): Promise<void> => {
  // Set up event listeners
  processingQueue.on('error', (error) => {
    logger.error('Processing queue error:', error);
  });
  
  processingQueue.on('failed', (job, error) => {
    logger.error(`Job ${job.id} failed:`, error);
  });
  
  processingQueue.on('completed', (job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });
  
  // Process jobs
  processingQueue.process(PROCESSING.CONCURRENT_JOBS, async (job) => {
    logger.info(`Processing job: ${job.id} for animation: ${job.data.animationId}`);
    
    try {
      await processVideoWithNarration(job.data);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to process job ${job.id}:`, error);
      throw error;
    }
  });
  
  logger.info(`Processing worker initialized with ${PROCESSING.CONCURRENT_JOBS} concurrent jobs`);
};