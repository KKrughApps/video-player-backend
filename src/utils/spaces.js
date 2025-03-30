const AWS = require('aws-sdk');
const fetch = require('node-fetch');
const fs = require('fs').promises;

// Initialize S3 client with proper configuration
function getS3Client() {
    try {
        if (!process.env.SPACES_ENDPOINT || !process.env.SPACES_KEY || !process.env.SPACES_SECRET) {
            console.warn('S3 credentials not properly configured. Check environment variables.');
        }
        
        const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT);
        return new AWS.S3({
            endpoint: spacesEndpoint,
            accessKeyId: process.env.SPACES_KEY,
            secretAccessKey: process.env.SPACES_SECRET,
            region: process.env.SPACES_REGION || 'nyc3',
        });
    } catch (error) {
        console.error('Error initializing S3 client:', error);
        throw error;
    }
}

// Get S3 client - create once to avoid repeated initialization
const s3 = getS3Client();

async function uploadToSpaces(filePath, key) {
    try {
        const fileContent = await fs.readFile(filePath);
        const uploadResult = await s3.upload({
            Bucket: process.env.SPACES_BUCKET,
            Key: key,
            Body: fileContent,
            ACL: 'public-read',
            ContentType: 'video/mp4',
        }).promise();
        
        const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${key}`;
        
        try {
            const response = await fetch(videoUrl, { method: 'HEAD' });
            if (!response.ok) {
                console.warn(`File uploaded but not publicly accessible: ${videoUrl}`);
            }
        } catch (fetchError) {
            console.warn(`Could not verify file accessibility: ${fetchError.message}`);
        }
        
        return videoUrl;
    } catch (error) {
        console.error(`Error uploading to Spaces: ${error.message}`);
        throw error;
    }
}

async function fileExistsInSpaces(key) {
    if (!key) {
        console.warn('No key provided to fileExistsInSpaces');
        return false;
    }
    
    try {
        await s3.headObject({ 
            Bucket: process.env.SPACES_BUCKET, 
            Key: key 
        }).promise();
        return true;
    } catch (err) {
        // If object doesn't exist, return false without throwing
        return false;
    }
}

async function deleteFromSpaces(key) {
    try {
        await s3.deleteObject({ 
            Bucket: process.env.SPACES_BUCKET, 
            Key: key 
        }).promise();
        return true;
    } catch (error) {
        console.error(`Error deleting from Spaces: ${error.message}`);
        throw error;
    }
}

module.exports = { uploadToSpaces, fileExistsInSpaces, deleteFromSpaces };