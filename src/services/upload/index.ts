import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import path from 'path';
import { createLogger } from '../../shared/utils/logger';
import { SERVER, SECURITY, VIDEO } from '../../shared/config/environment';
import uploadRoutes from './routes';
import { setupQueueProcessor } from './queue';

const logger = createLogger('UploadService');

/**
 * Initialize the upload service
 */
export const initializeUploadService = async (): Promise<FastifyInstance> => {
  const server = fastify({
    logger: true,
    trustProxy: true,
  });

  try {
    // Register CORS
    await server.register(cors, {
      origin: SECURITY.CORS_ORIGINS,
      credentials: true,
    });

    // Register multipart for file uploads
    await server.register(multipart, {
      limits: {
        fileSize: VIDEO.MAX_SIZE,
      },
    });
    
    // Register static file serving for admin UI
    await server.register(staticFiles, {
      root: path.resolve(process.cwd(), 'public'),
      prefix: '/',
    });

    // Register API routes
    server.register(uploadRoutes, { prefix: '/api/upload' });

    // Health check route
    server.get('/health', async () => {
      return { status: 'ok', service: 'upload' };
    });

    // Start the queue processor for uploaded videos
    await setupQueueProcessor();

    // Start the server
    await server.listen({ port: SERVER.PORT, host: '0.0.0.0' });
    logger.info(`Upload service started on port ${SERVER.PORT}`);

    return server;
  } catch (error) {
    logger.error('Failed to start upload service:', error);
    throw error;
  }
};

export default { initializeUploadService };