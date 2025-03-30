const express = require('express');
const router = express.Router();
const path = require('path');

module.exports = (pool) => {
    router.get('/video/:id', async (req, res) => {
        const { id } = req.params;
        const { lang = 'en' } = req.query;
        try {
            console.log(`Getting video for animation ${id} in language ${lang}`);
            
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) {
                console.log(`Animation ${id} not found`);
                return res.status(404).json({ error: 'Animation not found' });
            }

            // Try to find the processed video first
            const { fileExistsInSpaces } = require('../utils/spaces');
            const spacesKey = `videos/temp_video_${id}_${lang}_full.mp4`;
            
            console.log(`Checking for processed video in Spaces: ${spacesKey}`);
            let processedVideoExists = false;
            
            try {
                // First check if the processed video exists in Spaces
                processedVideoExists = await fileExistsInSpaces(spacesKey);
                console.log(`Processed video exists in Spaces: ${processedVideoExists}`);
            } catch (checkError) {
                console.error(`Error checking if processed video exists: ${checkError.message}`);
                // Continue with the function, treating it as if the file doesn't exist
            }
            
            let videoUrl;
            
            if (processedVideoExists) {
                // Use the processed video from Spaces
                videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${spacesKey}`;
                console.log(`Serving processed video from Spaces: ${videoUrl}`);
            } else {
                // Try to use the original uploaded video
                console.log('Processed video not found, checking for original video');
                
                // The column name may be lowercase in Postgres
                const originalVideo = animation.rows[0].videopath || animation.rows[0].videoPath;
                
                console.log(`Original video path: ${originalVideo}`);
                
                if (!originalVideo) {
                    // No video available
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
                console.log(`Serving original video: ${videoUrl}`);
                
                // For debugging - check if file actually exists
                const fs = require('fs');
                const path = require('path');
                if (originalVideo.startsWith('videos/') || originalVideo.startsWith('/videos/')) {
                    const localPath = path.join(__dirname, '../../', originalVideo.startsWith('/') ? originalVideo.substring(1) : originalVideo);
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
            
            // Add a cache-busting parameter to avoid browser caching
            const timestamp = Date.now();
            const urlWithCacheBusting = videoUrl.includes('?') 
                ? `${videoUrl}&_t=${timestamp}` 
                : `${videoUrl}?_t=${timestamp}`;
                
            res.json({ url: urlWithCacheBusting });
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