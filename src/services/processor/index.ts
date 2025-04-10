import { createLogger } from '../../shared/utils/logger';
import { setupProcessingWorker } from './worker';
import { PROCESSING } from '../../shared/config/environment';

const logger = createLogger('ProcessorService');

/**
 * Initialize the processor service
 */
export const initializeProcessorService = async (): Promise<void> => {
  try {
    logger.info('Starting video processor service...');
    
    // Set up the processing worker
    await setupProcessingWorker();
    
    logger.info(`Processor service initialized with ${PROCESSING.CONCURRENT_JOBS} concurrent jobs`);
  } catch (error) {
    logger.error('Failed to initialize processor service:', error);
    throw error;
  }
};

export default { initializeProcessorService };