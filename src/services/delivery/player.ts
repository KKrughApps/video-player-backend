import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../../shared/utils/logger';
import { HttpError, SupportedLanguage } from '../../shared/types';
import * as AnimationModel from '../../shared/models/Animation';
import * as ProcessedVideoModel from '../../shared/models/ProcessedVideo';
import { getFileUrl } from '../storage';

const logger = createLogger('PlayerRoutes');

/**
 * Register player routes
 */
export const registerPlayerRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Serve the embedded player page
  fastify.get('/embed/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { language?: string };
  }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { language = 'en' } = request.query;
      const animationId = parseInt(id, 10);
      
      if (isNaN(animationId)) {
        throw new HttpError('Invalid animation ID', 400);
      }
      
      // Get animation
      const animation = await AnimationModel.getAnimationById(animationId);
      
      if (!animation) {
        throw new HttpError('Animation not found', 404);
      }
      
      // Get processed videos
      const processedVideos = await ProcessedVideoModel.getProcessedVideosByAnimation(animationId);
      const availableLanguages = processedVideos
        .filter(v => v.status === 'ready')
        .map(v => ({
          code: v.language,
          name: getLanguageName(v.language),
          url: getFileUrl(v.video_key)
        }));
      
      // Find the video for the requested language
      const videoToPlay = availableLanguages.find(v => v.code === language) || availableLanguages[0];
      
      if (!videoToPlay) {
        throw new HttpError('No processed videos available', 404);
      }
      
      // Generate the HTML for the embedded player
      const html = generatePlayerHtml(animation, videoToPlay, availableLanguages);
      
      reply.header('Content-Type', 'text/html');
      return reply.send(html);
    } catch (error) {
      logger.error(`Error serving embedded player for video ${request.params.id}:`, error);
      
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Error</title>
          <style>
            body { font-family: Arial, sans-serif; color: #333; margin: 40px; text-align: center; }
            .error { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1 class="error">Error</h1>
          <p>${error instanceof HttpError ? error.message : 'An unexpected error occurred'}</p>
        </body>
        </html>
      `;
      
      reply.header('Content-Type', 'text/html');
      reply.status(error instanceof HttpError ? error.status : 500);
      return reply.send(errorHtml);
    }
  });
};

/**
 * Get human-readable language name
 */
function getLanguageName(languageCode: string): string {
  const languages: Record<string, string> = {
    en: 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    it: 'Italiano',
    pt: 'Português',
  };
  
  return languages[languageCode] || languageCode;
}

/**
 * Generate the HTML for the embedded player
 */
function generatePlayerHtml(
  animation: any,
  currentVideo: { code: string; name: string; url: string },
  availableLanguages: Array<{ code: string; name: string; url: string }>
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${animation.name}</title>
      <link href="https://vjs.zencdn.net/8.0.4/video-js.css" rel="stylesheet" />
      <style>
        body { margin: 0; padding: 0; background-color: #000; overflow: hidden; }
        .video-container { width: 100%; height: 100vh; display: flex; flex-direction: column; }
        .video-js { width: 100%; height: 100%; }
        .language-selector { position: absolute; top: 10px; right: 10px; z-index: 10; }
        .language-selector select { 
          background: rgba(0,0,0,0.7); 
          color: white; 
          border: 1px solid #666;
          padding: 5px;
          border-radius: 3px;
        }
        .video-title {
          position: absolute;
          top: 10px;
          left: 10px;
          z-index: 10;
          color: white;
          font-family: Arial, sans-serif;
          font-size: 16px;
          background: rgba(0,0,0,0.7);
          padding: 5px 10px;
          border-radius: 3px;
        }
      </style>
    </head>
    <body>
      <div class="video-container">
        <div class="video-title">${animation.name}</div>
        <div class="language-selector">
          <select id="language-select" onchange="changeLanguage(this.value)">
            ${availableLanguages.map(lang => 
              `<option value="${lang.code}" ${lang.code === currentVideo.code ? 'selected' : ''}>${lang.name}</option>`
            ).join('')}
          </select>
        </div>
        <video
          id="my-video"
          class="video-js"
          controls
          preload="auto"
          poster=""
          data-setup="{}"
        >
          <source src="${currentVideo.url}" type="video/mp4" />
          <p class="vjs-no-js">
            To view this video please enable JavaScript, and consider upgrading to a
            web browser that
            <a href="https://videojs.com/html5-video-support/" target="_blank">supports HTML5 video</a>
          </p>
        </video>
      </div>
      
      <script src="https://vjs.zencdn.net/8.0.4/video.min.js"></script>
      <script>
        var player = videojs('my-video', {
          fluid: true,
          responsive: true,
          controls: true,
          autoplay: false
        });
        
        function changeLanguage(langCode) {
          // Store current time
          const currentTime = player.currentTime();
          const isPaused = player.paused();
          
          // Build new URL
          const baseUrl = window.location.href.split('?')[0];
          window.location.href = baseUrl + '?language=' + langCode;
        }
      </script>
    </body>
    </html>
  `;
}