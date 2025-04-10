import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Server configuration
export const SERVER = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

// Database configuration
export const DATABASE = {
  URL: process.env.DATABASE_URL,
  HOST: process.env.DB_HOST || 'localhost',
  PORT: parseInt(process.env.DB_PORT || '5432', 10),
  USER: process.env.DB_USER || 'postgres',
  PASSWORD: process.env.DB_PASSWORD || 'postgres',
  NAME: process.env.DB_NAME || 'video_narration',
  SSL: process.env.DB_SSL === 'true',
  SSL_CERT: process.env.DB_SSL_CERT,
};

// Redis configuration
export const REDIS = {
  HOST: process.env.REDIS_HOST || 'localhost',
  PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  PASSWORD: process.env.REDIS_PASSWORD || '',
  TLS: process.env.REDIS_TLS === 'true',
};

// Storage configuration
export const STORAGE = {
  TYPE: process.env.STORAGE_TYPE || 'local', // 'spaces' or 'local'
  BASE_URL: process.env.STORAGE_BASE_URL || '',
};

// DigitalOcean Spaces configuration
export const SPACES = {
  ENDPOINT: process.env.SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com',
  REGION: process.env.SPACES_REGION || 'nyc3',
  KEY: process.env.SPACES_KEY || '',
  SECRET: process.env.SPACES_SECRET || '',
  BUCKET: process.env.SPACES_BUCKET || '',
};

// Local storage configuration
export const LOCAL_STORAGE = {
  PATH: process.env.LOCAL_STORAGE_PATH || './storage',
};

// API keys
export const API_KEYS = {
  GOOGLE: process.env.GOOGLE_API_KEY || '',
  ELEVENLABS: process.env.ELEVENLABS_API_KEY || '',
};

// Processing configuration
export const PROCESSING = {
  CONCURRENT_JOBS: parseInt(process.env.CONCURRENT_JOBS || '2', 10),
  MAX_RETRY_ATTEMPTS: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10),
  JOB_TIMEOUT: parseInt(process.env.JOB_TIMEOUT || '300000', 10), // 5 minutes
};

// Video configuration
export const VIDEO = {
  MAX_SIZE: parseInt(process.env.MAX_VIDEO_SIZE || '104857600', 10), // 100MB
  ALLOWED_TYPES: (process.env.ALLOWED_VIDEO_TYPES || 'video/mp4,video/quicktime').split(','),
};

// Security configuration
export const SECURITY = {
  SESSION_SECRET: process.env.SESSION_SECRET || 'change_this_to_a_random_string',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
};