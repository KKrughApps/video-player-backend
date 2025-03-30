const AWS = require('aws-sdk');
const fetch = require('node-fetch');
const fs = require('fs').promises;

const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT);
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
});

async function uploadToSpaces(filePath, key) {
    const fileContent = await fs.readFile(filePath);
    const uploadResult = await s3.upload({
        Bucket: process.env.SPACES_BUCKET,
        Key: key,
        Body: fileContent,
        ACL: 'public-read',
        ContentType: 'video/mp4',
    }).promise();
    const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${key}`;
    const response = await fetch(videoUrl, { method: 'HEAD' });
    if (!response.ok) throw new Error(`File is not publicly accessible: ${videoUrl}`);
    return videoUrl;
}

async function fileExistsInSpaces(key) {
    try {
        await s3.headObject({ Bucket: process.env.SPACES_BUCKET, Key: key }).promise();
        return true;
    } catch (err) {
        return false;
    }
}

async function deleteFromSpaces(key) {
    await s3.deleteObject({ Bucket: process.env.SPACES_BUCKET, Key: key }).promise();
}

module.exports = { uploadToSpaces, fileExistsInSpaces, deleteFromSpaces };