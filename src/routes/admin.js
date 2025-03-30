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
    filename: (req, file, cb) => cb(null, `video_${Date.now()}-${Math.random()}.mp4`),
});
const upload = multer({ storage });

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
        const videoPath = req.file ? req.file.path : 'videos/default.mp4';
        try {
            const originalDuration = await getVideoDuration(videoPath);
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
        const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;
        const newVideoPath = req.file ? req.file.path : null;

        try {
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) return res.status(404).send('Animation not found');

            const oldVideoPath = animation.rows[0].videoPath;
            const videoPath = newVideoPath || oldVideoPath;
            const originalDuration = newVideoPath ? await getVideoDuration(videoPath) : animation.rows[0].originalDuration;

            await pool.query(
                `UPDATE animations SET name = $1, videoPath = $2, voiceoverText = $3, setsRepsDuration = $4, reminder = $5, twoSided = $6, originalDuration = $7
                 WHERE id = $8`,
                [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided === 'on', originalDuration, id]
            );

            if (newVideoPath && oldVideoPath !== 'videos/default.mp4') {
                await fs.unlink(oldVideoPath).catch(err => console.error(`Error deleting old video: ${err.message}`));
            }

            // Queue the video generation task instead of calling it directly
            await videoQueue.add('generate-narrated-videos', {
                animationId: id,
                videoPath,
                voiceoverText,
                originalDuration
            });
            res.redirect('/admin/dashboard');
        } catch (err) {
            res.status(500).send(`Error updating animation: ${err.message}`);
        }
    });
    router.delete('/delete/:id', isAuthenticated, async (req, res) => {
        const { id } = req.params;
        try {
            const animation = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (animation.rows.length === 0) return res.status(404).json({ error: 'Animation not found' });

            const videoPath = animation.rows[0].videoPath;
            if (videoPath && videoPath !== 'videos/default.mp4') { // Add check for videoPath
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
