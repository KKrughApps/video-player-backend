# Video Narration Service

## Last Updated: 2025-04-10

A microservice-based application that adds narration to silent videos in multiple languages.

## Features

- Upload silent videos with voiceover text
- Automatic generation of narrated versions in multiple languages (English, Spanish, French, German, Italian, Portuguese)
- RESTful API for managing videos
- Embedding support for easy integration with language switching
- Robust error handling and job processing
- Admin interface for managing videos

## Implementation Status

The core functionality is now fully implemented (as of 2025-04-10):

- ✅ Upload Service: Video upload and validation
- ✅ Processing Service: Translation, text-to-speech, and video processing
- ✅ Storage Service: File management with local and cloud options
- ✅ Delivery Service: Video streaming with language selection
- ✅ Admin Interface: Simple UI for uploading and managing videos

## Deployment Status

- ✅ Environment configuration for Digital Ocean
- ✅ GitHub repository created: video-narration-service (private)
- 🔄 Project restructuring (removing nested directories)
- 🔄 Digital Ocean App Platform deployment setup

For detailed progress information, see the [Progress Tracker](./PROGRESS.md).

## Architecture

This application is built with a microservices-like architecture:

- **Upload Service**: Handles video uploads and metadata
- **Processing Service**: Generates narration and combines with video
- **Storage Service**: Manages file storage and retrieval
- **Delivery Service**: Serves videos to users

For more details, see the [Architecture Documentation](./ARCHITECTURE.md).

## Prerequisites

- Node.js 16+
- PostgreSQL 13+
- Redis 6+
- FFmpeg
- Google Translate API key
- ElevenLabs API key
- DigitalOcean Spaces account (or compatible S3 storage) for production

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/username/video-narration-service.git
   cd video-narration-service
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment variables:
   ```
   cp .env.example .env
   # Edit .env with your configurations
   ```

4. Set up the database:
   ```
   npm run migration:latest
   ```

5. Start the development server:
   ```
   npm run dev
   ```

6. Access the admin interface:
   ```
   http://localhost:3000
   ```

## Project Structure

```
video-narration-service/    # Root directory (with nested structure fixed)
├── src/                    # Source code
│   ├── index.ts            # Main application entry point
│   ├── services/           # Service implementations
│   │   ├── upload/         # Upload service
│   │   ├── processor/      # Video processing service
│   │   ├── storage/        # Storage management
│   │   └── delivery/       # Video delivery API
│   └── shared/             # Shared code
│       ├── config/         # Configuration
│       ├── models/         # Database models
│       ├── utils/          # Utilities
│       └── types/          # TypeScript types
├── public/                 # Static files for the admin interface
│   └── index.html          # Admin UI for video upload and management
├── migrations/             # Database migrations
│   └── 20250405_initial_schema.js  # Initial schema creation
├── .env.example            # Example environment configuration
├── knexfile.js             # Database configuration for migrations
├── package.json            # Project dependencies
├── tsconfig.json           # TypeScript configuration
├── ARCHITECTURE.md         # Architecture documentation
├── PROGRESS.md             # Progress tracking
└── README.md               # Project overview
```

### Digital Ocean Resources

```
Digital Ocean/
├── App Platform/
│   └── video-player-backend             # Main application
├── Databases/
│   ├── video-player-db                  # PostgreSQL database
│   └── db-redis-nyc3-video-player       # Redis database
└── Spaces/
    └── video-player-narrations          # File storage
```

## API Endpoints

### Upload Service (Port 3000)
- `POST /api/upload`: Upload a new video with narration text
- `GET /api/upload/:id`: Get status of an uploaded video

### Delivery Service (Port 3001)
- `GET /api/videos`: List all videos
- `GET /api/videos/:id`: Get a specific video with optional language parameter
- `GET /api/videos/:id/embed`: Get embed code for a video
- `GET /embed/:id`: Embeddable video player with language switching

## Development

### Running in Development Mode

```
npm run dev
```

### Building for Production

```
npm run build
```

### Running Tests (To be implemented)

```
npm test
```

## Next Steps

1. Implement integration tests
2. Create deployment scripts for cloud environments
3. Implement analytics and usage tracking
4. Add user authentication and permissions
5. Enhance the admin interface with more features

## License

This project is licensed under the MIT License - see the LICENSE file for details.