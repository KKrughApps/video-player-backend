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

// Import the job queue and worker to ensure job processing is initialized
const videoQueue = require('./src/services/jobQueue');
require('./src/services/worker');

app.use('/admin', adminRoutes(pool));
app.use('/api', apiRoutes(pool));

app.listen(port, host, () => {
  console.log(`Server running on port ${port}`);
  initializeDatabase();
});