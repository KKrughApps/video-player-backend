const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { getVideoDuration } = require('../utils/file');
const { deleteFromSpaces } = require('../utils/spaces');
const videoQueue = require('../services/jobQueue'); // Import the Bull queue

// Use an absolute path for the upload destination
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
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

// Simple authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.redirect('/admin');
};

module.exports = (pool) => {
  // Dashboard route: lists animations
  router.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM animations ORDER BY id DESC');
      res.render('dashboard', { animations: result.rows });
    } catch (error) {
      console.error('Error fetching animations:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Route to handle video upload
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

  // Additional admin routes (update, delete, etc.) can be added here

  return router;
};