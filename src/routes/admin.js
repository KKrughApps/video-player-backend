const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;
const { getVideoDuration } = require('../utils/file');
const { deleteFromSpaces } = require('../utils/spaces');
const videoQueue = require('../services/jobQueue'); // Import the Bull queue

// Configure multer to use an absolute path for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use an absolute path to the videos directory
    const videosDir = path.join(__dirname, '..', '..', 'videos');
    cb(null, videosDir);
  },
  filename: (req, file, cb) => {
    const extension = file.mimetype === 'video/mp4' ? '.mp4' :
                      file.mimetype === 'video/quicktime' ? '.mov' :
                      file.mimetype === 'video/x-msvideo' ? '.avi' : '.mp4';
    cb(null, `video_${Date.now()}-${Math.round(Math.random() * 1000000)}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only MP4, MOV, and AVI files
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
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.redirect('/admin');
};

module.exports = (pool) => {
  // GET /admin - Serve the admin login page (admin.html)
  router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin.html'));
  });

  // POST /admin/login - Process the login form
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      // Example: hard-coded credentials. Update as needed.
      if (username === 'admin' && password === 'secret123') {
        req.session.authenticated = true;
        return res.redirect('/admin/dashboard');
      }
      // Invalid credentials; redirect back to login
      res.redirect('/admin');
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // GET /admin/dashboard - Admin dashboard page
  router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM animations ORDER BY id DESC');
      // Serve the dashboard.html file from the public folder
      res.sendFile(path.join(__dirname, '..', '..', 'public', 'dashboard.html'));
    } catch (error) {
      console.error('Error fetching animations:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // POST /admin/upload - Handle video uploads
  router.post('/upload', isAuthenticated, upload.single('videoFile'), async (req, res) => {
    try {
      const videoPath = req.file.path;
      const videoDuration = await getVideoDuration(videoPath);
      const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;

      // Insert animation metadata into the database
      const insertQuery = `
        INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `;
      const values = [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided === 'on', videoDuration];
      const result = await pool.query(insertQuery, values);
      const animationId = result.rows[0].id;

      // Add a job to the queue to process the video (generate narrated versions)
      videoQueue.add({
        animationId,
        videoPath,
        voiceoverText,
        originalDuration: videoDuration
      });

      res.redirect('/admin/dashboard');
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).send('Upload failed');
    }
  });

  return router;
};