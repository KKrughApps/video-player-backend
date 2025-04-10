# Digital Ocean Deployment Guide

## Last Updated: 2025-04-10

This document outlines the steps to deploy the Video Narration Service to Digital Ocean App Platform, including connections to existing resources.

## Prerequisites

- A Digital Ocean account with access to the following resources:
  - App Platform: video-player-backend
  - Database: video-player-db
  - Redis: db-redis-nyc3-video-player
  - Spaces: video-player-narrations

## Deployment Configuration

The Video Narration Service is configured to deploy to Digital Ocean App Platform with the following settings:

### 1. GitHub Repository Connection

- Repository: https://github.com/KKrughApps/video-player-backend
- Branch: main
- Deploy on Push: Enabled

### 2. App Configuration

- Type: Web Service
- Resource Type: Basic (512 MB RAM / 1 vCPU)
- HTTP Port: 10000

### 3. Environment Variables

The following environment variables are required for the application to function properly:

```
# Database Configuration
DATABASE_URL=postgres://doadmin:YOUR_DB_PASSWORD@video-player-db-do-user-20218314-0.l.db.ondigitalocean.com:25060/animations_db?sslmode=verify-ca

# Redis Configuration (with TLS)
REDIS_URL=rediss://default:YOUR_REDIS_PASSWORD@db-redis-nyc3-video-player-do-user-20218314-0.l.db.ondigitalocean.com:25061

# Storage Configuration
STORAGE_TYPE=spaces
STORAGE_BASE_URL=https://video-player-narrations.nyc3.digitaloceanspaces.com
SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
SPACES_REGION=nyc3
SPACES_KEY=YOUR_SPACES_KEY
SPACES_SECRET=YOUR_SPACES_SECRET
SPACES_BUCKET=video-player-narrations

# API Keys
GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY
ELEVENLABS_API_KEY=YOUR_ELEVENLABS_API_KEY

# Security Configuration
SESSION_SECRET=YOUR_SESSION_SECRET
CORS_ORIGINS=https://video-player-backend-xfmfy.ondigitalocean.app,http://localhost:3000
```

Replace `YOUR_*` values with the actual credentials.

### 4. Resource Connections

The application connects to the following Digital Ocean resources:

#### Database (video-player-db)

- Type: PostgreSQL
- Database Name: animations_db
- Connection String: Available in App Platform environment settings

#### Redis (db-redis-nyc3-video-player)

- Type: Redis
- Connection String: Available in App Platform environment settings
- TLS Enabled: Yes

#### Spaces (video-player-narrations)

- Region: nyc3
- Access Keys: Available in App Platform environment settings

## Deployment Steps

1. Ensure all changes are committed and pushed to the GitHub repository
2. Log into the Digital Ocean Control Panel
3. Navigate to the App Platform section
4. Select the "video-player-backend" app
5. Click "Deploy" to manually trigger a deployment (or push to GitHub to trigger automatically)
6. Monitor the deployment logs for any issues

## Post-Deployment Verification

After deployment, verify the following:

1. Navigate to the app URL: https://video-player-backend-xfmfy.ondigitalocean.app
2. Check the health endpoint: https://video-player-backend-xfmfy.ondigitalocean.app/health
3. Verify database connectivity by uploading a test video
4. Check that files are correctly stored in the Spaces bucket

## Troubleshooting

If the deployment fails, check the following:

1. Verify all environment variables are correctly set
2. Check the build logs for compilation errors
3. Verify connectivity to external resources (database, redis, spaces)
4. Check the application logs for runtime errors

## Maintenance

To update the application:

1. Make changes to the code
2. Commit and push to GitHub
3. The app will automatically deploy
4. Monitor the deployment logs for any issues