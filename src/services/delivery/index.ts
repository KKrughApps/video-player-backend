import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import { createLogger } from '../../shared/utils/logger';
import { SERVER, SECURITY, LOCAL_STORAGE } from '../../shared/config/environment';
import deliveryRoutes from './routes';
import { registerPlayerRoutes } from './player';

const logger = createLogger('DeliveryService');

/**
 * Initialize the delivery service
 */
export const initializeDeliveryService = async (): Promise<FastifyInstance> => {
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

    // Register static file serving for locally stored files
    await server.register(staticFiles, {
      root: path.resolve(LOCAL_STORAGE.PATH),
      prefix: '/storage',
      decorateReply: false,
    });

    // Register API routes
    server.register(deliveryRoutes, { prefix: '/api/videos' });
    
    // Register player routes
    await registerPlayerRoutes(server);

    // Health check route
    server.get('/health', async () => {
      return { status: 'ok', service: 'delivery' };
    });

    // Start the server
    await server.listen({ port: SERVER.PORT + 1, host: '0.0.0.0' });
    logger.info(`Delivery service started on port ${SERVER.PORT + 1}`);

    return server;
  } catch (error) {
    logger.error('Failed to start delivery service:', error);
    throw error;
  }
};

export default { initializeDeliveryService };