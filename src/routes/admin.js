const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;
const { getVideoDuration } = require('../utils/file');
const videoQueue = require('../services/jobQueue'); // Import the Bull queue

module.exports = (pool) => {
  // Serve the admin login page at GET /admin
  router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin.html'));
  });

  // Process login at POST /admin/login (using hard-coded credentials: admin / secret123)
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (username === 'admin' && password === 'secret123') {
        req.session.authenticated = true;
        return res.redirect('/admin/dashboard');
      }
      res.redirect('/admin');
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Serve the dashboard page at GET /admin/dashboard
  router.get('/dashboard', (req, res) => {
    // Assuming dashboard.html is a static file in the public folder.
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'dashboard.html'));
  });

  // New API endpoint to return animations as JSON
  router.get('/animations', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM animations ORDER BY id DESC');
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching animations:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Configure multer for video uploads using an absolute path
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const videosDir = path.join(__dirname, '..', '..', 'videos');
      cb(null, videosDir);
    },
    filename: (req, file, cb) => {
      const extension =
        file.mimetype === 'video/mp4'
          ? '.mp4'
          : file.mimetype === 'video/quicktime'
          ? '.mov'
          : file.mimetype === 'video/x-msvideo'
          ? '.avi'
          : '.mp4';
      cb(null, `video_${Date.now()}-${Math.round(Math.random() * 1000000)}${extension}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    if (
      file.mimetype === 'video/mp4' ||
      file.mimetype === 'video/quicktime' ||
      file.mimetype === 'video/x-msvideo'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Only MP4, MOV, and AVI files are allowed.'), false);
    }
  };

  const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
  });

  // Handle video upload at POST /admin/upload
  router.post('/upload', async (req, res) => {
    if (!req.session.authenticated) return res.redirect('/admin');
    try {
      // Use multer to handle file upload
      upload.single('videoFile')(req, res, async function (err) {
        if (err) {
          console.error('Upload error:', err);
          return res.status(500).send('Upload failed');
        }
        const videoPath = req.file.path;
        const videoDuration = await getVideoDuration(videoPath);
        const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;
        const insertQuery = `
          INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `;
        const values = [
          name,
          videoPath,
          voiceoverText,
          setsRepsDuration,
          reminder,
          twoSided === 'on',
          videoDuration
        ];
        const result = await pool.query(insertQuery, values);
        const animationId = result.rows[0].id;

        // Add a job to the Bull queue to process the video (generate narrated versions, etc.)
        videoQueue.add({
          animationId,
          videoPath,
          voiceoverText,
          originalDuration: videoDuration
        });

        res.redirect('/admin/dashboard');
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).send('Upload failed');
    }
  });

  return router;
};