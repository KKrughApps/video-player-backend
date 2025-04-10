import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../../shared/utils/logger';
import { ApiResponse, HttpError, AnimationStatus, ProcessedVideoStatus } from '../../shared/types';
import * as AnimationModel from '../../shared/models/Animation';
import * as ProcessedVideoModel from '../../shared/models/ProcessedVideo';
import { getFileUrl } from '../storage';

const logger = createLogger('DeliveryRoutes');

/**
 * Route handler for video delivery
 */
export default async function routes(fastify: FastifyInstance): Promise<void> {
  // List all videos
  fastify.get('/', async (request: FastifyRequest<{
    Querystring: {
      page?: string;
      limit?: string;
      status?: AnimationStatus;
    }
  }>, reply: FastifyReply) => {
    try {
      const page = request.query.page ? parseInt(request.query.page, 10) : 1;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 10;
      const status = request.query.status;
      
      // Get paginated animations
      const result = await AnimationModel.listAnimations(page, limit, status);
      
      // Return success response
      const response: ApiResponse = {
        success: true,
        data: {
          animations: result.animations,
          total: result.total,
          page,
          limit,
          pages: Math.ceil(result.total / limit),
        },
      };
      
      return reply.send(response);
    } catch (error) {
      logger.error('Error listing videos:', error);
      
      const response: ApiResponse = {
        success: false,
        error: 'Failed to list videos',
        status: 500,
      };
      
      return reply.status(500).send(response);
    }
  });
  
  // Get a specific video by ID
  fastify.get('/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { language?: string };
  }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { language } = request.query;
      const animationId = parseInt(id, 10);
      
      if (isNaN(animationId)) {
        throw new HttpError('Invalid animation ID', 400);
      }
      
      // Get animation
      const animation = await AnimationModel.getAnimationById(animationId);
      
      if (!animation) {
        throw new HttpError('Animation not found', 404);
      }
      
      // Get processed videos for this animation
      const processedVideos = await ProcessedVideoModel.getProcessedVideosByAnimation(animationId);
      
      // If language specified, filter for that language
      let videoToPlay = null;
      if (language) {
        videoToPlay = processedVideos.find(
          (video) => video.language === language && video.status === ProcessedVideoStatus.READY
        );
        
        if (!videoToPlay) {
          throw new HttpError(`No processed video found for language: ${language}`, 404);
        }
      } else if (processedVideos.length > 0) {
        // Default to English or first available language
        videoToPlay = processedVideos.find(
          (video) => video.language === 'en' && video.status === ProcessedVideoStatus.READY
        ) || processedVideos.find(
          (video) => video.status === ProcessedVideoStatus.READY
        );
      }
      
      if (!videoToPlay) {
        throw new HttpError('No processed videos available', 404);
      }
      
      // Get the file URL
      const videoUrl = getFileUrl(videoToPlay.video_key);
      
      // Return response
      const response: ApiResponse = {
        success: true,
        data: {
          animation,
          videoUrl,
          language: videoToPlay.language,
          availableLanguages: processedVideos
            .filter((v) => v.status === ProcessedVideoStatus.READY)
            .map((v) => v.language),
        },
      };
      
      return reply.send(response);
    } catch (error) {
      logger.error(`Error getting video ${request.params.id}:`, error);
      
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
  
  // Get the embed code for a video
  fastify.get('/:id/embed', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { language?: string };
  }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { language } = request.query;
      const animationId = parseInt(id, 10);
      
      if (isNaN(animationId)) {
        throw new HttpError('Invalid animation ID', 400);
      }
      
      // Get animation
      const animation = await AnimationModel.getAnimationById(animationId);
      
      if (!animation) {
        throw new HttpError('Animation not found', 404);
      }
      
      // Generate embed HTML
      const embedUrl = `${request.protocol}://${request.hostname}/embed/${id}${language ? `?language=${language}` : ''}`;
      const embedHtml = `
        <iframe 
          src="${embedUrl}" 
          width="640" 
          height="360" 
          frameborder="0" 
          allowfullscreen
          allow="autoplay; encrypted-media"
        ></iframe>
      `;
      
      // Return response
      const response: ApiResponse = {
        success: true,
        data: {
          embedHtml,
          embedUrl,
        },
      };
      
      return reply.send(response);
    } catch (error) {
      logger.error(`Error generating embed code for video ${request.params.id}:`, error);
      
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