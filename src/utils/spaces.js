const AWS = require('aws-sdk');
const fetch = require('node-fetch');
const fs = require('fs').promises;

// Initialize S3 client with proper configuration
function getS3Client() {
    try {
        console.log('Initializing S3 client with the following configuration:');
        console.log('- SPACES_ENDPOINT:', process.env.SPACES_ENDPOINT ? 'set' : 'not set');
        console.log('- SPACES_KEY:', process.env.SPACES_KEY ? 'set' : 'not set');
        console.log('- SPACES_SECRET:', process.env.SPACES_SECRET ? 'set (not shown)' : 'not set');
        console.log('- SPACES_REGION:', process.env.SPACES_REGION || 'defaulting to nyc3');
        console.log('- SPACES_BUCKET:', process.env.SPACES_BUCKET || 'not set');
        
        if (!process.env.SPACES_ENDPOINT || !process.env.SPACES_KEY || !process.env.SPACES_SECRET) {
            console.warn('S3 credentials not properly configured. Check environment variables.');
        }
        
        const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT);
        const s3Client = new AWS.S3({
            endpoint: spacesEndpoint,
            accessKeyId: process.env.SPACES_KEY,
            secretAccessKey: process.env.SPACES_SECRET,
            region: process.env.SPACES_REGION || 'nyc3',
        });
        
        // Test the connection by listing buckets
        console.log('Testing S3 connection...');
        
        return s3Client;
    } catch (error) {
        console.error('Error initializing S3 client:', error);
        throw error;
    }
}

// Get S3 client - create once to avoid repeated initialization
const s3 = getS3Client();

async function uploadToSpaces(filePath, key) {
    console.log(`Starting upload to DigitalOcean Spaces: ${filePath} -> ${key}`);
    
    try {
        // Create a log entry for debugging
        const logStart = new Date().toISOString();
        const logEntry = {
            timestamp: logStart,
            action: 'upload',
            filePath,
            key,
            status: 'starting'
        };
        console.log('UPLOAD_LOG:', JSON.stringify(logEntry));
        
        // Check if environment variables are set
        if (!process.env.SPACES_BUCKET || !process.env.SPACES_ENDPOINT) {
            console.error('Missing environment variables for DigitalOcean Spaces:');
            console.error('SPACES_BUCKET:', process.env.SPACES_BUCKET ? 'set' : 'not set');
            console.error('SPACES_ENDPOINT:', process.env.SPACES_ENDPOINT ? 'set' : 'not set');
            throw new Error("Required environment variables missing: SPACES_BUCKET or SPACES_ENDPOINT");
        }
        
        // Validate that the file exists
        try {
            await fs.access(filePath, fs.constants.R_OK);
            console.log(`File exists and is readable: ${filePath}`);
        } catch (accessError) {
            console.error(`File not accessible: ${filePath}`, accessError);
            throw new Error(`File not accessible for upload: ${filePath}`);
        }
        
        // Get file info
        const fileStats = await fs.stat(filePath);
        console.log(`File stats: size=${fileStats.size} bytes, created=${fileStats.birthtime}`);
        
        // Read file content
        console.log(`Reading file content: ${filePath}`);
        const fileContent = await fs.readFile(filePath);
        console.log(`File content read successfully: ${fileContent.length} bytes`);
        
        // Set content type based on file extension
        let contentType = 'video/mp4';
        if (filePath.toLowerCase().endsWith('.mp3')) {
            contentType = 'audio/mpeg';
        }
        
        console.log(`Uploading to Spaces: bucket=${process.env.SPACES_BUCKET}, key=${key}, contentType=${contentType}`);
        
        const uploadParams = {
            Bucket: process.env.SPACES_BUCKET,
            Key: key,
            Body: fileContent,
            ACL: 'public-read',
            ContentType: contentType,
        };
        
        // Log upload attempt (exclude file content)
        console.log('Upload params:', JSON.stringify({
            Bucket: uploadParams.Bucket,
            Key: uploadParams.Key,
            ContentType: uploadParams.ContentType,
            ACL: uploadParams.ACL,
            BodySize: fileContent.length
        }, null, 2));
        
        // Test bucket access first
        try {
            console.log(`Testing bucket access to ${process.env.SPACES_BUCKET}...`);
            await s3.headBucket({ Bucket: process.env.SPACES_BUCKET }).promise();
            console.log(`Bucket ${process.env.SPACES_BUCKET} is accessible`);
        } catch (bucketError) {
            console.error(`Error accessing bucket ${process.env.SPACES_BUCKET}:`, bucketError);
            throw new Error(`Cannot access bucket ${process.env.SPACES_BUCKET}: ${bucketError.message}`);
        }
        
        console.log(`Starting S3 upload to ${uploadParams.Bucket}/${uploadParams.Key}...`);
        
        // Perform the actual upload
        const uploadResult = await s3.upload(uploadParams).promise();
        console.log('Upload successful:', JSON.stringify(uploadResult, null, 2));
        
        const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${key}`;
        console.log(`Generated public URL: ${videoUrl}`);
        
        try {
            console.log(`Verifying public access: ${videoUrl}`);
            const response = await fetch(videoUrl, { method: 'HEAD' });
            if (!response.ok) {
                console.warn(`File uploaded but not publicly accessible: ${videoUrl}, status=${response.status}`);
            } else {
                console.log(`File is publicly accessible: ${videoUrl}`);
            }
        } catch (fetchError) {
            console.warn(`Could not verify file accessibility: ${fetchError.message}`);
        }
        
        // Log success
        const logEnd = new Date().toISOString();
        const successLog = {
            ...logEntry,
            status: 'success',
            url: videoUrl,
            endTime: logEnd,
            duration: (new Date(logEnd) - new Date(logStart)) + 'ms'
        };
        console.log('UPLOAD_LOG:', JSON.stringify(successLog));
        
        return videoUrl;
    } catch (error) {
        console.error(`Error uploading to Spaces:`, error);
        
        // Log failure
        const logEnd = new Date().toISOString();
        const errorLog = {
            timestamp: logEnd,
            action: 'upload',
            filePath,
            key,
            status: 'failed',
            error: error.message
        };
        console.log('UPLOAD_LOG:', JSON.stringify(errorLog));
        
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