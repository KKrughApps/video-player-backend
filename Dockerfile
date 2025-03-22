# Use the official Node.js 18 image based on Debian Bullseye
FROM node:18-bullseye

# Install FFmpeg and verify it's installed
RUN apt-get update && apt-get install -y ffmpeg && ffmpeg -version

# Set the working directory
WORKDIR /workspace

# Copy package.json and package-lock.json (if it exists)
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Verify FFmpeg is in the PATH at runtime
RUN which ffmpeg

# Expose the port the app runs on
EXPOSE 10000

# Define the command to run the app
CMD ["npm", "start"]