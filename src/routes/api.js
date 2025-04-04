const express = require('express');
const router = express.Router();
const path = require('path');

module.exports = (pool) => {
    router.get('/video/:id', async (req, res) => {
        const { id } = req.params;
        const { lang = 'en', fallback = false } = req.query;
        try {
            console.log(`Getting video for animation ${id} in language ${lang}, fallback: ${fallback}`);
            
            // Query the database for animation, including language-specific video paths
            const animation = await pool.query(`
                SELECT 
                    *, 
                    CASE WHEN $1 = 'en' THEN englishVideoPath ELSE spanishVideoPath END as localizedVideoPath,
                    CASE WHEN $1 = 'en' THEN englishVideoUrl ELSE spanishVideoUrl END as localizedVideoUrl
                FROM animations 
                WHERE id = $2
            `, [lang, id]);
            
            if (animation.rows.length === 0) {
                console.log(`Animation ${id} not found`);
                return res.status(404).json({ error: 'Animation not found' });
            }
            
            const animationData = animation.rows[0];
            console.log(`Found animation: ${animationData.name} (ID: ${id})`);
            
            // Try different video sources in order of preference
            let videoUrl;
            let videoSource = 'unknown';
            
            // 1. First try language-specific video URL (from DO Spaces)
            if (animationData.localizedVideoUrl) {
                videoUrl = animationData.localizedVideoUrl;
                videoSource = 'spaces-localized';
                console.log(`Using localized video URL from Spaces: ${videoUrl}`);
            } 
            // 2. Then try language-specific local path
            else if (animationData.localizedVideoPath) {
                // Check if the local file exists
                const fs = require('fs');
                try {
                    const exists = fs.existsSync(animationData.localizedVideoPath);
                    if (exists) {
                        const localPath = animationData.localizedVideoPath;
                        // Convert absolute path to relative URL
                        if (localPath.includes('/videos/')) {
                            const pathParts = localPath.split('/videos/');
                            videoUrl = `/videos/${pathParts[pathParts.length - 1]}`;
                        } else {
                            videoUrl = `/${localPath}`;
                        }
                        videoSource = 'local-localized';
                        console.log(`Using localized video from local path: ${videoUrl} (original: ${localPath})`);
                    }
                } catch (fsError) {
                    console.error(`Error checking local localized file: ${fsError.message}`);
                }
            }
            
            // 3. Try to find the processed video in Spaces
            if (!videoUrl) {
                const { fileExistsInSpaces } = require('../utils/spaces');
                const spacesKey = `videos/temp_video_${id}_${lang}_full.mp4`;
                
                console.log(`Checking for processed video in Spaces: ${spacesKey}`);
                let processedVideoExists = false;
                
                try {
                    // Check if the processed video exists in Spaces
                    processedVideoExists = await fileExistsInSpaces(spacesKey);
                    console.log(`Processed video exists in Spaces: ${processedVideoExists}`);
                    
                    if (processedVideoExists) {
                        // Use the processed video from Spaces
                        videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${spacesKey}`;
                        videoSource = 'spaces-generated';
                        console.log(`Serving processed video from Spaces: ${videoUrl}`);
                        
                        // Update the database with this URL
                        if (lang === 'en') {
                            await pool.query('UPDATE animations SET englishVideoUrl = $1 WHERE id = $2', [videoUrl, id]);
                        } else {
                            await pool.query('UPDATE animations SET spanishVideoUrl = $1 WHERE id = $2', [videoUrl, id]);
                        }
                    }
                } catch (checkError) {
                    console.error(`Error checking if processed video exists in Spaces: ${checkError.message}`);
                }
            }
            
            // 4. Check for local processed video
            if (!videoUrl) {
                const fs = require('fs');
                const path = require('path');
                const rootDir = path.resolve(__dirname, '../../');
                const localProcessedPath = path.join(rootDir, 'videos', `video_${id}_${lang}_full.mp4`);
                
                console.log(`Checking for local processed video: ${localProcessedPath}`);
                
                try {
                    const exists = fs.existsSync(localProcessedPath);
                    if (exists) {
                        videoUrl = `/videos/video_${id}_${lang}_full.mp4`;
                        videoSource = 'local-generated';
                        console.log(`Using local processed video: ${videoUrl}`);
                        
                        // Update the database with this path
                        if (lang === 'en') {
                            await pool.query('UPDATE animations SET englishVideoPath = $1 WHERE id = $2', [localProcessedPath, id]);
                        } else {
                            await pool.query('UPDATE animations SET spanishVideoPath = $1 WHERE id = $2', [localProcessedPath, id]);
                        }
                    }
                } catch (fsError) {
                    console.error(`Error checking local processed file: ${fsError.message}`);
                }
            }
            
            // 5. Finally, try the original video as a fallback
            if (!videoUrl) {
                console.log('No processed video found, checking for original video');
                
                const originalVideo = animationData.videopath || animationData.videoPath;
                
                console.log(`Original video path: ${originalVideo}`);
                
                if (!originalVideo) {
                    console.log('No video path found in database');
                    return res.status(404).json({ 
                        error: 'Video not found. The video may still be processing.',
                        status: 'PROCESSING'
                    });
                }
                
                // If the video is stored locally, serve it directly
                if (originalVideo.startsWith('videos/')) {
                    videoUrl = `/${originalVideo}`;
                } else if (originalVideo.startsWith('/videos/')) {
                    videoUrl = originalVideo;
                } else {
                    videoUrl = originalVideo;
                }
                videoSource = 'original';
                console.log(`Serving original video: ${videoUrl}`);
                
                // Check if file actually exists
                const fs = require('fs');
                const path = require('path');
                if (originalVideo.startsWith('videos/') || originalVideo.startsWith('/videos/')) {
                    // Get absolute path to the project root
                    const rootDir = path.resolve(__dirname, '../../');
                    // Construct absolute path to the video file
                    const localPath = path.join(rootDir, originalVideo.startsWith('/') ? originalVideo.substring(1) : originalVideo);
                    
                    console.log(`Resolving video path: root=${rootDir}, originalPath=${originalVideo}, localPath=${localPath}`);
                    
                    try {
                        const exists = fs.existsSync(localPath);
                        console.log(`Checking if local file exists at ${localPath}: ${exists}`);
                        if (!exists) {
                            return res.status(404).json({ 
                                error: 'Video file not found on server. It may have been moved or deleted.',
                                status: 'MISSING'
                            });
                        }
                    } catch (fsError) {
                        console.error(`Error checking local file: ${fsError.message}`);
                    }
                }
            }
            
            if (!videoUrl) {
                console.error(`No valid video URL found for animation ${id} in language ${lang}`);
                return res.status(404).json({ 
                    error: 'No valid video URL found. The video may still be processing.',
                    status: 'PROCESSING'
                });
            }
            
            // Add a cache-busting parameter to avoid browser caching
            const timestamp = Date.now();
            const urlWithCacheBusting = videoUrl.includes('?') 
                ? `${videoUrl}&_t=${timestamp}` 
                : `${videoUrl}?_t=${timestamp}`;
                
            console.log(`Returning video URL: ${urlWithCacheBusting} (source: ${videoSource})`);
            res.json({ 
                url: urlWithCacheBusting,
                source: videoSource 
            });
        } catch (err) {
            console.error(`Error in /video/:id endpoint: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/embed/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) return res.status(404).send('Animation not found');
            res.sendFile(path.join(__dirname, '../../public', 'embed.html'));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/animation/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) return res.status(404).json({ error: 'Animation not found' });
            res.json(animation.rows[0]);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};