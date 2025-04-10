import db from '../config/database';
import { Animation, AnimationStatus } from '../types';

const TABLE_NAME = 'animations';

/**
 * Create a new animation record
 */
export const createAnimation = async (
  animation: Omit<Animation, 'id' | 'created_at' | 'updated_at'>
): Promise<Animation> => {
  const [result] = await db(TABLE_NAME)
    .insert({
      ...animation,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning('*');

  return result;
};

/**
 * Get an animation by ID
 */
export const getAnimationById = async (id: number): Promise<Animation | null> => {
  const result = await db(TABLE_NAME).where({ id }).first();
  return result || null;
};

/**
 * Update an animation record
 */
export const updateAnimation = async (
  id: number,
  data: Partial<Omit<Animation, 'id' | 'created_at'>>
): Promise<Animation | null> => {
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
 * Update animation status
 */
export const updateAnimationStatus = async (
  id: number,
  status: AnimationStatus
): Promise<Animation | null> => {
  return updateAnimation(id, { status });
};

/**
 * Delete an animation
 */
export const deleteAnimation = async (id: number): Promise<boolean> => {
  const result = await db(TABLE_NAME).where({ id }).delete();
  return result > 0;
};

/**
 * List animations with pagination
 */
export const listAnimations = async (
  page: number = 1,
  pageSize: number = 10,
  status?: AnimationStatus
): Promise<{ animations: Animation[]; total: number }> => {
  const query = db(TABLE_NAME);

  if (status) {
    query.where({ status });
  }

  const offset = (page - 1) * pageSize;
  
  // Get total count
  const [{ count }] = await db(TABLE_NAME)
    .count('id as count')
    .modify((builder) => {
      if (status) {
        builder.where({ status });
      }
    });
  
  // Get paginated results
  const animations = await query
    .orderBy('created_at', 'desc')
    .limit(pageSize)
    .offset(offset);

  return {
    animations,
    total: parseInt(count as string, 10),
  };
};

export default {
  createAnimation,
  getAnimationById,
  updateAnimation,
  updateAnimationStatus,
  deleteAnimation,
  listAnimations,
};