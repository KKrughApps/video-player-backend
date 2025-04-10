import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { createLogger } from '../../shared/utils/logger';
import { HttpError } from '../../shared/types';
import { fileExists, getFileUrl, uploadFile } from '../storage';

// Set FFmpeg path
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
} else {
  throw new Error('FFmpeg path not found. Make sure ffmpeg-static is installed.');
}

const logger = createLogger('FFmpegService');

/**
 * Process a video by combining it with an audio file
 */
export const processVideo = async (
  originalVideoKey: string,
  audioBuffer: Buffer,
  animationId: number,
  language: string
): Promise<string> => {
  logger.info(`Processing video ${originalVideoKey} with ${language} audio`);
  
  try {
    // Get the original video URL
    const videoUrl = getFileUrl(originalVideoKey);
    
    // Create temporary directory
    const tempDir = path.join(os.tmpdir(), `video-processing-${uuidv4()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create temporary audio file
    const audioPath = path.join(tempDir, 'narration.mp3');
    await fs.writeFile(audioPath, audioBuffer);
    
    // Set up the output path
    const outputPath = path.join(tempDir, 'output.mp4');
    
    // Process the video using fluent-ffmpeg
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoUrl)
        .input(audioPath)
        .outputOptions([
          '-c:v copy',       // Copy video stream without re-encoding
          '-c:a aac',        // Use AAC codec for audio
          '-map 0:v',        // Map video from the first input (original video)
          '-map 1:a',        // Map audio from the second input (generated audio)
          '-shortest',       // Finish encoding when the shortest input stream ends
          '-movflags +faststart', // Optimize for web streaming
        ])
        .on('start', (command) => {
          logger.info(`FFmpeg command: ${command}`);
        })
        .on('progress', (progress) => {
          logger.info(`Processing: ${progress.percent ? progress.percent.toFixed(1) : 0}% done`);
        })
        .on('error', (err) => {
          logger.error(`FFmpeg error: ${err.message}`);
          reject(new Error(`FFmpeg processing failed: ${err.message}`));
        })
        .on('end', () => {
          logger.info('FFmpeg processing finished');
          resolve();
        })
        .save(outputPath);
    });
    
    // Read the processed video
    const processedVideoBuffer = await fs.readFile(outputPath);
    
    // Upload to storage with a proper key
    const processedVideoKey = `videos/processed/${animationId}/${language}.mp4`;
    await uploadFile(processedVideoBuffer, processedVideoKey, 'video/mp4');
    
    // Clean up temporary files
    try {
      await fs.unlink(audioPath);
      await fs.unlink(outputPath);
      await fs.rmdir(tempDir);
    } catch (error) {
      logger.warn(`Error cleaning up temporary files: ${error}`);
    }
    
    logger.info(`Video processed and uploaded with key: ${processedVideoKey}`);
    return processedVideoKey;
  } catch (error) {
    logger.error(`Error processing video: ${error}`);
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    throw new HttpError('Failed to process video', 500);
  }
};