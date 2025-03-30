const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const pool = require('./src/db/index');
const adminRoutes = require('./src/routes/admin');
const apiRoutes = require('./src/routes/api');

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

const videoQueue = require('./src/services/jobQueue');
videoQueue.isReady().then(() => {
    console.log('Redis connection successful');
}).catch(err => {
    console.error('Redis connection failed:', err);
});

app.listen(port, host, () => console.log(`Server running on port ${port}`));