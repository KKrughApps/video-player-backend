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
  
  // Delete a specific animation
  router.delete('/delete/:id', async (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
      const { id } = req.params;
      
      // First get the animation details to delete the video file
      const getQuery = 'SELECT videoPath FROM animations WHERE id = $1';
      const getResult = await pool.query(getQuery, [id]);
      
      if (getResult.rows.length === 0) {
        return res.status(404).json({ error: 'Animation not found' });
      }
      
      const videoPath = getResult.rows[0].videopath || getResult.rows[0].videoPath;
      
      // Delete the animation from the database
      const deleteQuery = 'DELETE FROM animations WHERE id = $1 RETURNING id';
      const deleteResult = await pool.query(deleteQuery, [id]);
      
      // Attempt to delete the video file if it exists
      if (videoPath) {
        try {
          await fs.access(videoPath);
          await fs.unlink(videoPath);
          console.log(`Deleted video file: ${videoPath}`);
        } catch (fileError) {
          console.warn(`Could not delete video file: ${videoPath}`, fileError.message);
          // Continue even if file deletion fails
        }
      }
      
      // Delete any processed videos from temp directory if they exist
      const tempDir = path.join(__dirname, '..', '..', 'temp');
      try {
        const files = await fs.readdir(tempDir);
        const relatedFiles = files.filter(file => file.includes(`_${id}_`));
        
        for (const file of relatedFiles) {
          try {
            await fs.unlink(path.join(tempDir, file));
            console.log(`Deleted temp file: ${file}`);
          } catch (err) {
            console.warn(`Could not delete temp file: ${file}`, err.message);
          }
        }
      } catch (dirError) {
        console.warn(`Could not access temp directory: ${tempDir}`, dirError.message);
      }
      
      return res.json({ 
        message: `Animation #${id} deleted successfully`,
        id: parseInt(id)
      });
    } catch (error) {
      console.error('Error deleting animation:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  // Clear all animations (for testing/admin purposes)
  router.delete('/clear-all', async (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
      // Get all animations to delete their video files
      const getQuery = 'SELECT id, videoPath FROM animations';
      const getResult = await pool.query(getQuery);
      
      // Delete all files
      for (const row of getResult.rows) {
        const videoPath = row.videopath || row.videoPath;
        const id = row.id;
        
        if (videoPath) {
          try {
            await fs.access(videoPath);
            await fs.unlink(videoPath);
            console.log(`Deleted video file: ${videoPath}`);
          } catch (fileError) {
            console.warn(`Could not delete video file: ${videoPath}`, fileError.message);
          }
        }
        
        // Clean temp files for this animation
        const tempDir = path.join(__dirname, '..', '..', 'temp');
        try {
          const files = await fs.readdir(tempDir);
          const relatedFiles = files.filter(file => file.includes(`_${id}_`));
          
          for (const file of relatedFiles) {
            try {
              await fs.unlink(path.join(tempDir, file));
              console.log(`Deleted temp file: ${file}`);
            } catch (err) {
              console.warn(`Could not delete temp file: ${file}`, err.message);
            }
          }
        } catch (dirError) {
          console.warn(`Could not access temp directory: ${tempDir}`, dirError.message);
        }
      }
      
      // Delete all animations from the database
      const deleteQuery = 'DELETE FROM animations RETURNING id';
      const deleteResult = await pool.query(deleteQuery);
      
      return res.json({ 
        message: `${deleteResult.rows.length} animations deleted successfully`,
        count: deleteResult.rows.length
      });
    } catch (error) {
      console.error('Error clearing animations:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
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
        }, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          }
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