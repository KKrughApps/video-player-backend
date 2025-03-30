const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const pool = require('./src/db/index');
const adminRoutes = require('./src/routes/admin');
const apiRoutes = require('./src/routes/api');
const initializeDatabase = require('./init-db');

const app = express();
const port = process.env.PORT || 10000;
const host = '0.0.0.0';

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/videos', express.static(path.join(__dirname, 'videos')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'your-secret-key', resave: false, saveUninitialized: false, cookie: { secure: false } }));

app.use('/admin', adminRoutes(pool));
app.use('/api', apiRoutes(pool));

// Add a direct route for /embed/:id to handle the embed page directly
app.get('/embed/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'embed.html'));
});

const videoQueue = require('./src/services/jobQueue');
videoQueue.isReady().then(() => {
    console.log('Redis connection successful');
}).catch(err => {
    console.error('Redis connection failed:', err);
});

require('./src/services/worker');

// Initialize database before starting the server
initializeDatabase().then((result) => {
    // Start the server regardless of database initialization result
    app.listen(port, host, () => console.log(`Server running on port ${port}`));
}).catch(err => {
    console.error('Failed to initialize database:', err);
    // Start the server despite database error - it may work with existing data
    app.listen(port, host, () => console.log(`Server running on port ${port} (despite database initialization error)`));
});