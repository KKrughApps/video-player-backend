# Video Player Backend

This application handles uploading, processing, and serving exercise videos with automatically generated narration in multiple languages.

## Features

- Upload exercise animations/videos
- Automatic generation of narrated versions in multiple languages
- Admin dashboard for content management
- API endpoints for embedding videos in other applications

## Setup Instructions

### Prerequisites

- Node.js (v14+)
- PostgreSQL database
- Redis server (for job queue)
- ffmpeg installed on the server

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and configure your environment variables:
   ```
   cp .env.example .env
   ```
4. Initialize the database:
   ```
   node init-db.js
   ```
5. Start the server:
   ```
   npm start
   ```
   For development with auto-reload:
   ```
   npm run dev
   ```

## Environment Variables

Create a `.env` file in the root directory with the following variables:

- `DATABASE_URL`: Full PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis connection details
- `SPACES_ENDPOINT`, `SPACES_KEY`, `SPACES_SECRET`, `SPACES_REGION`, `SPACES_BUCKET`: DigitalOcean Spaces credentials
- `GOOGLE_API_KEY`: Google API key for translation services
- `ELEVENLABS_API_KEY`: ElevenLabs API key for text-to-speech
- `PORT`: Server port (default: 10000)

## File Structure

- `/server.js`: Main application entry point
- `/src/routes/`: API routes
- `/src/services/`: Business logic for video processing and job queue
- `/src/utils/`: Utility functions
- `/public/`: Static files and front-end code
- `/videos/`: Storage for uploaded videos

## API Endpoints

- `GET /admin`: Admin login page
- `POST /admin/login`: Process admin login
- `GET /admin/dashboard`: Dashboard to manage animations
- `POST /admin/upload`: Upload new animations
- `GET /admin/animations`: List all animations
- `GET /api/video/:id`: Get video URL for specific animation
- `GET /api/embed/:id`: Get embed page for animation
- `GET /api/animation/:id`: Get animation details

## Usage

1. Log in to the admin panel at `/admin` (default credentials: admin/secret123)
2. Upload a new animation through the dashboard
3. The system will automatically generate narrated versions
4. Use the embed URL to include the video in other applications