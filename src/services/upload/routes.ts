import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../../shared/utils/logger';
import { validateUploadRequest } from './validators';
import { processUpload } from './controller';
import { ApiResponse, HttpError, UploadRequest } from '../../shared/types';

const logger = createLogger('UploadRoutes');

/**
 * Route handler for video uploads
 */
export default async function routes(fastify: FastifyInstance): Promise<void> {
  // Handle video uploads
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('Processing new video upload request');
      
      // Validate the upload request
      const validatedRequest = await validateUploadRequest(request);
      
      // Process the upload
      const result = await processUpload(validatedRequest);
      
      // Return success response
      const response: ApiResponse = {
        success: true,
        data: result,
      };
      
      return reply.status(201).send(response);
    } catch (error) {
      logger.error('Error processing upload:', error);
      
      // Handle known HTTP errors
      if (error instanceof HttpError) {
        const response: ApiResponse = {
          success: false,
          error: error.message,
          status: error.status,
        };
        
        return reply.status(error.status).send(response);
      }
      
      // Handle unexpected errors
      const response: ApiResponse = {
        success: false,
        error: 'An unexpected error occurred while processing your upload',
        status: 500,
      };
      
      return reply.status(500).send(response);
    }
  });
  
  // Get upload status
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const animationId = parseInt(id, 10);
      
      if (isNaN(animationId)) {
        throw new HttpError('Invalid animation ID', 400);
      }
      
      // Get animation status from database
      const animation = await import('../../shared/models/Animation')
        .then((module) => module.getAnimationById(animationId));
      
      if (!animation) {
        throw new HttpError('Animation not found', 404);
      }
      
      // Get processed videos
      const processedVideos = await import('../../shared/models/ProcessedVideo')
        .then((module) => module.getProcessedVideosByAnimation(animationId));
      
      // Return the combined response
      const response: ApiResponse = {
        success: true,
        data: {
          animation,
          processedVideos,
        },
      };
      
      return reply.send(response);
    } catch (error) {
      logger.error(`Error retrieving upload status for ID ${request.params.id}:`, error);
      
      // Handle known HTTP errors
      if (error instanceof HttpError) {
        const response: ApiResponse = {
          success: false,
          error: error.message,
          status: error.status,
        };
        
        return reply.status(error.status).send(response);
      }
      
      // Handle unexpected errors
      const response: ApiResponse = {
        success: false,
        error: 'An unexpected error occurred',
        status: 500,
      };
      
      return reply.status(500).send(response);
    }
  });
}