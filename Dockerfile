FROM node:16-slim

# Install dependencies for ffmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the code
COPY . .

# Build TypeScript
RUN npm run build

# Expose the port
EXPOSE 10000

# Set the command to run
CMD ["npm", "start"]