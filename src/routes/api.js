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

            const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/videos/temp_video_${id}_${lang}_full.mp4`;
            res.json({ url: videoUrl });
        } catch (err) {
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