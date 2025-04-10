import Queue from 'bull';
import { createLogger } from '../../shared/utils/logger';
import { REDIS, PROCESSING } from '../../shared/config/environment';
import { ProcessingJobData } from '../../shared/types';

const logger = createLogger('UploadQueue');

// Create the video processing queue
const processingQueue = new Queue<ProcessingJobData>('video-processing', {
  redis: {
    host: REDIS.HOST,
    port: REDIS.PORT,
    password: REDIS.PASSWORD || undefined,
    tls: REDIS.TLS ? {} : undefined,
  },
  defaultJobOptions: {
    attempts: PROCESSING.MAX_RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 seconds
    },
    timeout: PROCESSING.JOB_TIMEOUT,
    removeOnComplete: true,
    removeOnFail: false,
  },
});

/**
 * Add a new job to the processing queue
 */
export const addProcessingJob = async (data: ProcessingJobData): Promise<string> => {
  try {
    const job = await processingQueue.add(data, {
      jobId: `animation-${data.animationId}`,
    });
    
    logger.info(`Added job to processing queue: ${job.id} for animation: ${data.animationId}`);
    return job.id as string;
  } catch (error) {
    logger.error(`Error adding job to processing queue for animation ${data.animationId}:`, error);
    throw error;
  }
};

/**
 * Set up the queue processor - in this case, we're just monitoring the queue
 * The actual processing will be done by the processor service
 */
export const setupQueueProcessor = async (): Promise<void> => {
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
  
  logger.info('Processing queue setup complete');
};