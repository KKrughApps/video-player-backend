#!/bin/bash

# This script ensures both services run on the same port
# for compatibility with DigitalOcean App Platform

# Run database migrations
echo "Running database migrations..."
npm run migration:latest

# Start the application
echo "Starting application..."
npm start