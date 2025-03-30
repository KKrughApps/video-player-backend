const express = require('express');
const router = express.Router();

module.exports = (pool) => {
    router.get('/animation/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const result = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Animation not found' });
            res.json(result.rows[0]);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/narration/:id/:language/full', async (req, res) => {
        const { id, language } = req.params;
        if (!['en', 'es'].includes(language)) {
            return res.status(400).json({ error: 'Invalid language. Use "en" or "es".' });
        }
        try {
            const result = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Animation not found' });

            const videoKey = `temp_video_${id}_${language}_full.mp4`;
            const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${videoKey}`;
            res.json({ videoUrl });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};