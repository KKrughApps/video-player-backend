import { SERVER } from './shared/config/environment';
import { initializeDatabase } from './shared/config/database';
import { initializeRedis } from './shared/config/redis';
import logger from './shared/utils/logger';
import { initializeUploadService } from './services/upload';
import { initializeProcessorService } from './services/processor';
import { initializeDeliveryService } from './services/delivery';

/**
 * Initialize all application components
 */
const initialize = async () => {
  logger.info('Starting Video Narration Service...');
  
  try {
    // Initialize database connection
    await initializeDatabase();
    logger.info('Database initialized successfully');
    
    // Initialize Redis connection
    await initializeRedis();
    logger.info('Redis initialized successfully');
    
    // Initialize services
    const uploadServer = await initializeUploadService();
    logger.info('Upload service initialized successfully');
    
    await initializeProcessorService();
    logger.info('Processor service initialized successfully');
    
    const deliveryServer = await initializeDeliveryService();
    logger.info('Delivery service initialized successfully');
    
    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down services...');
      
      try {
        await uploadServer.close();
        await deliveryServer.close();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
    logger.info(`Video Narration Service is ready!`);
    logger.info(`Upload API running on http://localhost:${SERVER.PORT}`);
    logger.info(`Delivery API running on http://localhost:${SERVER.PORT + 1}`);
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Start the application
initialize().catch((error) => {
  logger.error('Uncaught error during initialization:', error);
  process.exit(1);
});