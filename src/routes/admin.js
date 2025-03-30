const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { getVideoDuration } = require('../utils/file');
const { deleteFromSpaces } = require('../utils/spaces');
const videoQueue = require('../services/jobQueue'); // Import the Bull queue

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'videos/'),
    filename: (req, file, cb) => {
        const extension = file.mimetype === 'video/mp4' ? '.mp4' : 
                          file.mimetype === 'video/quicktime' ? '.mov' : 
                          file.mimetype === 'video/x-msvideo' ? '.avi' : '.mp4';
        
        cb(null, `video_${Date.now()}-${Math.round(Math.random() * 1000000)}${extension}`);
    }
});

// Filter function to validate video files
const fileFilter = (req, file, cb) => {
    // Accept mp4, mov and avi
    if (file.mimetype === 'video/mp4' || 
        file.mimetype === 'video/quicktime' || 
        file.mimetype === 'video/x-msvideo') {
        cb(null, true);
    } else {
        cb(new Error('Unsupported file format. Only MP4, MOV, and AVI files are allowed.'), false);
    }
};

const upload = multer({ 
    storage,
    fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

const isAuthenticated = (req, res, next) => {
    if (req.session.authenticated) return next();
    res.redirect('/admin');
};

module.exports = (pool) => {
    router.get('/', (req, res) => res.sendFile(path.join(__dirname, '../../public', 'admin.html')));
    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (username === 'admin' && password === 'yourpassword') {
            req.session.authenticated = true;
            res.redirect('/admin/dashboard');
        } else {
            res.redirect('/admin');
        }
    });
    router.get('/dashboard', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, '../../public', 'dashboard.html')));
    router.get('/list', isAuthenticated, async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM animations');
            res.json({ animations: result.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    router.get('/edit/:id', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, '../../public', 'edit.html')));
    router.post('/add', isAuthenticated, upload.single('video'), async (req, res) => {
        const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;
        console.log('File upload request received:', { 
            body: req.body,
            file: req.file ? {
                filename: req.file.filename,
                mimetype: req.file.mimetype,
                size: req.file.size
            } : null,
            fieldname: req.file ? req.file.fieldname : null,
            hasFile: !!req.file 
        });
        
        // For debugging form data
        console.log('Form data submitted:', req.body);
        console.log('Files submitted:', req.files || 'No files array');
        console.log('Single file:', req.file || 'No single file');
        
        // Require video file
        if (!req.file) {
            return res.status(400).send('Error: Video file is required');
        }
        
        const videoPath = req.file.path;
        console.log('Video path:', videoPath);
        
        let originalDuration = 30.0; // Default duration
        try {
            originalDuration = await getVideoDuration(videoPath);
            console.log('Video duration:', originalDuration);
        } catch (durationError) {
            console.error('Error getting video duration:', durationError);
            // Continue with default duration
        }
        
        try {
            
            const result = await pool.query(
                `INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided === 'on', originalDuration]
            );
            const animationId = result.rows[0].id;
            // Queue the video generation task instead of calling it directly
            await videoQueue.add('generate-narrated-videos', {
                animationId,
                videoPath,
                voiceoverText,
                originalDuration
            });
            res.redirect('/admin/dashboard');
        } catch (err) {
            res.status(500).send(`Error adding animation: ${err.message}`);
        }
    });
    router.post('/update/:id', isAuthenticated, upload.single('video'), async (req, res) => {
        const { id } = req.params;
        const { name, voiceoverText, setsRepsDuration, reminder, twoSided, currentVideoPath } = req.body;
        const newVideoPath = req.file ? req.file.path : null;

        try {
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) return res.status(404).send('Animation not found');

            const oldVideoPath = animation.rows[0].videopath;
            
            // Use currentVideoPath from form if no new file is uploaded
            const videoPath = newVideoPath || currentVideoPath || oldVideoPath;
            
            if (!videoPath) {
                return res.status(400).send('Error: No video path available');
            }
            
            // Only get new duration if a new video is uploaded
            const originalDuration = newVideoPath ? 
                await getVideoDuration(videoPath) : 
                animation.rows[0].originalduration;

            console.log('Update animation:', {
                id,
                name,
                videoPath,
                oldVideoPath,
                currentVideoPath,
                newVideoPath
            });

            await pool.query(
                `UPDATE animations SET name = $1, videopath = $2, voiceovertext = $3, setsrepsduration = $4, reminder = $5, twosided = $6, originalduration = $7
                 WHERE id = $8`,
                [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided === 'on', originalDuration, id]
            );

            // Delete old video file if a new one was uploaded
            if (newVideoPath && oldVideoPath) {
                await fs.unlink(oldVideoPath).catch(err => console.error(`Error deleting old video: ${err.message}`));
            }

            // Queue the video generation task
            await videoQueue.add('generate-narrated-videos', {
                animationId: id,
                videoPath,
                voiceoverText,
                originalDuration
            });
            res.redirect('/admin/dashboard');
        } catch (err) {
            console.error('Error in update route:', err);
            res.status(500).send(`Error updating animation: ${err.message}`);
        }
    });
    router.delete('/delete/:id', isAuthenticated, async (req, res) => {
        const { id } = req.params;
        try {
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) return res.status(404).json({ error: 'Animation not found' });

            const videoPath = animation.rows[0].videopath;
            if (videoPath) {
                await fs.unlink(videoPath).catch(err => console.error(`Error deleting video file: ${err.message}`));
            }

            const languages = ['en', 'es'];
            for (const language of languages) {
                const videoKey = `temp_video_${id}_${language}_full.mp4`;
                await deleteFromSpaces(videoKey).catch(err => console.error(`Error deleting from Spaces: ${err.message}`));
            }

            await pool.query('DELETE FROM animations WHERE id = $1', [id]);
            res.json({ message: 'Animation deleted successfully' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
