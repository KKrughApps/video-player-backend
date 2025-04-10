import db from '../config/database';
import { ProcessedVideo, ProcessedVideoStatus } from '../types';

const TABLE_NAME = 'processed_videos';

/**
 * Create a new processed video record
 */
export const createProcessedVideo = async (
  processedVideo: Omit<ProcessedVideo, 'id' | 'created_at' | 'updated_at'>
): Promise<ProcessedVideo> => {
  const [result] = await db(TABLE_NAME)
    .insert({
      ...processedVideo,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning('*');

  return result;
};

/**
 * Get a processed video by ID
 */
export const getProcessedVideoById = async (id: number): Promise<ProcessedVideo | null> => {
  const result = await db(TABLE_NAME).where({ id }).first();
  return result || null;
};

/**
 * Get a processed video by animation ID and language
 */
export const getProcessedVideoByAnimationAndLanguage = async (
  animation_id: number,
  language: string
): Promise<ProcessedVideo | null> => {
  const result = await db(TABLE_NAME)
    .where({
      animation_id,
      language,
    })
    .first();

  return result || null;
};

/**
 * Update a processed video record
 */
export const updateProcessedVideo = async (
  id: number,
  data: Partial<Omit<ProcessedVideo, 'id' | 'created_at'>>
): Promise<ProcessedVideo | null> => {
  const [result] = await db(TABLE_NAME)
    .where({ id })
    .update({
      ...data,
      updated_at: new Date(),
    })
    .returning('*');

  return result || null;
};

/**
 * Update processed video status
 */
export const updateProcessedVideoStatus = async (
  id: number,
  status: ProcessedVideoStatus
): Promise<ProcessedVideo | null> => {
  return updateProcessedVideo(id, { status });
};

/**
 * Get all processed videos for an animation
 */
export const getProcessedVideosByAnimation = async (
  animation_id: number
): Promise<ProcessedVideo[]> => {
  return db(TABLE_NAME).where({ animation_id });
};

/**
 * Delete a processed video
 */
export const deleteProcessedVideo = async (id: number): Promise<boolean> => {
  const result = await db(TABLE_NAME).where({ id }).delete();
  return result > 0;
};

/**
 * Delete all processed videos for an animation
 */
export const deleteProcessedVideosByAnimation = async (
  animation_id: number
): Promise<boolean> => {
  const result = await db(TABLE_NAME).where({ animation_id }).delete();
  return result > 0;
};

export default {
  createProcessedVideo,
  getProcessedVideoById,
  getProcessedVideoByAnimationAndLanguage,
  updateProcessedVideo,
  updateProcessedVideoStatus,
  getProcessedVideosByAnimation,
  deleteProcessedVideo,
  deleteProcessedVideosByAnimation,
};