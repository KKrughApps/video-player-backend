# Video Narration Service Architecture

## Last Updated: 2025-04-10

## Overview

This service processes silent videos by adding narration in multiple languages. The system is designed with a clear separation of concerns, well-defined interfaces, and robust error handling to ensure stability and maintainability.

## Core Principles

1. **Simplicity**: Each component has a single responsibility
2. **Reliability**: Extensive error handling and fallback mechanisms
3. **Extensibility**: Easy to add new languages or features
4. **Observability**: Comprehensive logging and monitoring

## System Components

### 1. Upload Service (Implemented)

**Purpose**: Handles video uploads and metadata storage

**Key Features**:
- Validates video formats and sizes
- Stores videos in a consistent location
- Creates database entries for processing
- Triggers processing jobs

**Technologies**:
- Fastify for API handling
- Multipart for file uploads
- PostgreSQL for metadata storage
- Bull/Redis for job queue

**Implementation Details**:
- REST API at `/api/upload` for video upload
- Video validation for formats and size limits
- Job creation in Bull queue
- Admin interface for uploading and managing videos

### 2. Processing Service (Implemented)

**Purpose**: Generates narration audio and combines with video

**Key Features**:
- Translates text to multiple languages
- Generates speech from text
- Adjusts video timing if needed
- Combines video with audio

**Technologies**:
- Bull/Redis for job queue
- Google Translate API
- ElevenLabs Text-to-Speech API
- FFmpeg for video processing

**Implementation Details**:
- Worker process handles jobs from the queue
- Translation module communicates with Google Translate API
- TTS module generates audio with ElevenLabs voices
- FFmpeg wrapper combines video and audio

### 3. Storage Service (Implemented)

**Purpose**: Manages file storage and retrieval

**Key Features**:
- Consistent naming conventions
- Abstraction over storage provider
- Handles temporary and permanent storage

**Technologies**:
- DigitalOcean Spaces (S3-compatible)
- Configurable for local storage during development

**Implementation Details**:
- Provider-based abstraction layer
- Local filesystem provider for development
- DigitalOcean Spaces provider for production
- Consistent file naming and organization

### 4. Delivery Service (Implemented)

**Purpose**: Serves videos to users

**Key Features**:
- Serves videos with proper headers and caching
- Supports embedding in other sites
- Handles language selection

**Technologies**:
- Fastify for API
- Video.js for playback

**Implementation Details**:
- REST API at `/api/videos` for video access
- Embed code generation at `/api/videos/:id/embed`
- Video player with language switching at `/embed/:id`
- Video.js for playback with responsive design

## Data Model

### Animations

Stores information about original uploaded videos.

```
animations {
  id: SERIAL PRIMARY KEY,
  name: VARCHAR(255) NOT NULL,
  voiceover_text: TEXT NOT NULL,
  original_video_key: VARCHAR(255) NOT NULL,
  status: VARCHAR(50) DEFAULT 'pending',
  created_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
}
```

### Processed Videos

Stores information about processed videos with narration.

```
processed_videos {
  id: SERIAL PRIMARY KEY,
  animation_id: INTEGER REFERENCES animations(id),
  language: VARCHAR(10) NOT NULL,
  video_key: VARCHAR(255) NOT NULL,
  status: VARCHAR(50) DEFAULT 'pending',
  created_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(animation_id, language)
}
```

## Processing Flow

1. User uploads video with voiceover text
2. Upload service stores the video and creates database entries
3. Processing service picks up the job:
   - Translates text (if needed)
   - Generates audio narration
   - Combines audio with video
   - Stores processed video
4. Delivery service serves the processed video to users

## Implementation Status (2025-04-10)

The core architecture has been fully implemented. All four main services (Upload, Processing, Storage, and Delivery) are working together as designed. The system can now handle the entire process from upload to delivery with language switching.

## Error Handling Strategy

- All operations have timeout limits
- Failed jobs are retried with exponential backoff
- Permanent failures update database status
- All errors are logged with context and correlation IDs

## Extension Points

- Additional languages can be added via configuration (in types/index.ts)
- Alternative storage providers via abstraction layer (in services/storage/providers)
- Additional video processing options (e.g., text overlays)

## Infrastructure Requirements

- PostgreSQL database
- Redis instance
- DigitalOcean Spaces bucket (or local storage for development)
- Node.js runtime environment
- FFmpeg installed on processing servers

## Digital Ocean Resources

The project is configured to use the following Digital Ocean resources:

- **App**: video-player-backend
- **Database**: video-player-db (PostgreSQL)
- **Redis**: db-redis-nyc3-video-player
- **Spaces**: video-player-narrations

## Development and Testing

To run the system in development mode:
1. Copy .env.example to .env and configure with your API keys
2. Run `npm run migration:latest` to set up the database
3. Run `npm run dev` to start all services
4. Access the admin interface at http://localhost:3000

## Deployment

The project is deployed to Digital Ocean App Platform:

1. GitHub Integration:
   - Repository: https://github.com/KKrughApps/video-player-backend
   - Branch: main
   - Auto-deployment on push: Enabled

2. Environment Configuration:
   - Production environment variables are set directly in Digital Ocean
   - Refer to .env.example for required variables
   - Docker environment setup via docker.env

3. App Configuration:
   - Single containerized application (via Dockerfile)
   - Dedicated health check endpoint on port 10000 (/health)
   - Combined services (upload, processor, delivery) in a single container
   - Instance Size: Basic-XXS (512MB RAM / 1 vCPU)

4. Resource Configuration:
   - Database connection to video-player-db (PostgreSQL)
   - Redis connection to db-redis-nyc3-video-player
   - Storage connection to video-player-narrations Spaces bucket
   - Built-in SSL/TLS support via Digital Ocean

## Next Architecture Improvements

- Add a dedicated authentication and authorization service
- Implement a metrics collection and monitoring system
- Create a CDN integration for improved video delivery
- Add a session management system for the admin interface