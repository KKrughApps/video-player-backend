const express = require('express');
const router = express.Router();
const path = require('path');

module.exports = (pool) => {
    router.get('/video/:id', async (req, res) => {
        const { id } = req.params;
        const { lang = 'en' } = req.query;
        try {
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) return res.status(404).json({ error: 'Animation not found' });

            // Try to find the processed video first
            const { fileExistsInSpaces } = require('../utils/spaces');
            const spacesKey = `videos/temp_video_${id}_${lang}_full.mp4`;
            
            // First check if the processed video exists in Spaces
            const processedVideoExists = await fileExistsInSpaces(spacesKey).catch(err => {
                console.error(`Error checking if processed video exists: ${err.message}`);
                return false;
            });
            
            let videoUrl;
            
            if (processedVideoExists) {
                // Use the processed video from Spaces
                videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${spacesKey}`;
                console.log(`Serving processed video from Spaces: ${videoUrl}`);
            } else {
                // Try to use the original uploaded video
                const originalVideo = animation.rows[0].videopath;
                if (originalVideo) {
                    // If the video is stored locally, serve it directly
                    if (originalVideo.startsWith('videos/')) {
                        videoUrl = `/${originalVideo}`;
                    } else {
                        videoUrl = originalVideo;
                    }
                    console.log(`Serving original video: ${videoUrl}`);
                } else {
                    // No video available
                    return res.status(404).json({ 
                        error: 'Video not found. Either no video has been uploaded or it is still processing.',
                        status: 'PROCESSING'
                    });
                }
            }
            
            res.json({ url: videoUrl });
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