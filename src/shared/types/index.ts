/**
 * Animation status enum
 */
export enum AnimationStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

/**
 * Processed video status enum
 */
export enum ProcessedVideoStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

/**
 * Supported languages
 */
export enum SupportedLanguage {
  ENGLISH = 'en',
  SPANISH = 'es',
  FRENCH = 'fr',
  GERMAN = 'de',
  ITALIAN = 'it',
  PORTUGUESE = 'pt',
  // Add more languages as needed
}

/**
 * Animation record type
 */
export interface Animation {
  id: number;
  name: string;
  voiceover_text: string;
  original_video_key: string;
  status: AnimationStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Processed video record type
 */
export interface ProcessedVideo {
  id: number;
  animation_id: number;
  language: string;
  video_key: string;
  status: ProcessedVideoStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Upload request type
 */
export interface UploadRequest {
  name: string;
  voiceover_text: string;
  file: Buffer;
  filename: string;
  mimetype: string;
}

/**
 * Video processing job data
 */
export interface ProcessingJobData {
  animationId: number;
  languages: string[];
  originalVideoKey: string;
  voiceoverText: string;
}

/**
 * Storage provider interface
 */
export interface StorageProvider {
  upload(file: Buffer, key: string, contentType?: string): Promise<string>;
  getUrl(key: string): string;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}

/**
 * API response format
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

/**
 * Error with HTTP status
 */
export class HttpError extends Error {
  constructor(
    public message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}