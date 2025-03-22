const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 10000; // Changed from 3000 to 10000
const host = '0.0.0.0';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/videos', express.static(path.join(__dirname, 'videos')));
app.use('/temp', express.static(path.join(__dirname, 'temp')));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware for authentication
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'videos/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `video_${uniqueSuffix}.mp4`);
    }
});
const upload = multer({ storage: storage });

// Log all incoming requests
app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    next();
});

// Ensure the videos and temp directories exist
const ensureDirectories = async () => {
    await fs.mkdir(path.join(__dirname, 'videos'), { recursive: true }).catch(err => console.error('Error creating videos directory:', err));
    await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true }).catch(err => console.error('Error creating temp directory:', err));
};

// SQLite Database Setup
const dbPath = path.join(__dirname, 'animations.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Initialize the database
const initializeDatabase = () => {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS animations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                videoPath TEXT NOT NULL,
                voiceoverText TEXT,
                setsRepsDuration TEXT,
                reminder TEXT,
                twoSided INTEGER DEFAULT 0
            )
        `, (err) => {
            if (err) {
                console.error('Error creating animations table:', err.message);
            } else {
                console.log('Animations table created or already exists.');
            }
        });

        db.get('SELECT COUNT(*) as count FROM animations', (err, row) => {
            if (err) {
                console.error('Error checking animations table:', err.message);
                return;
            }
            if (row.count === 0) {
                console.log('Inserting default animation data...');
                db.run(`
                    INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    'Foam Roller Front of Thighs Left',
                    'videos/default.mp4',
                    'Start, by lying face down, with your forearms and elbows, on the floor. The roller is positioned, at mid thigh level. Keeping your legs relaxed, and your knees comfortably straight, distribute your weight slightly more, to your left thigh, while still keeping your hips level. This will put the majority of the pressure, into your left thigh. From this position, roll from just above your knee, to just below your hip, and back and forth slowly. Continue keeping your legs relaxed, your back flat, and your vision on the floor, to maintain your neck and back alignment, throughout the movement.',
                    'Roll for 30 seconds to 1 minute.',
                    'Keep your rolling speed slow and controlled.',
                    0
                ], (err) => {
                    if (err) {
                        console.error('Error inserting default animation:', err.message);
                    } else {
                        console.log('Default animation inserted successfully.');
                    }
                });
            } else {
                console.log('Animations table already contains data.');
            }
        });
    });
};

// Helper function to translate text (mock implementation)
async function translateText(text, language) {
    console.log(`Calling translateText with voiceoverText: ${text}`);
    return text;
}

// Helper function to fetch narration from ElevenLabs
async function fetchNarration(text, language) {
    console.log(`Calling ElevenLabs API with text: ${text}`);
    const voiceId = 'pNInz6obpgDQGcFmaJgB';
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
            text: text,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.5,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    const narrationPath = path.join(__dirname, `narration_${language}.mp3`);
    const buffer = await response.buffer();
    await fs.writeFile(narrationPath, buffer);
    console.log(`Narration path: ${narrationPath}`);
    return narrationPath;
}

// Helper function to combine video and audio using ffmpeg
async function combineVideoAndAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(videoPath)
            .input(audioPath)
            .outputOptions('-c:v copy')
            .outputOptions('-c:a aac')
            .outputOptions('-map 0:v:0')
            .outputOptions('-map 1:a:0')
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

// Helper function to flip video horizontally using ffmpeg
async function flipVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(inputPath)
            .videoFilter('hflip')
            .outputOptions('-c:a copy')
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.authenticated) {
        return next();
    }
    res.redirect('/admin');
};

// Admin login page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin login handler
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'yourpassword') {
        req.session.authenticated = true;
        res.redirect('/admin/dashboard');
    } else {
        res.redirect('/admin');
    }
});

// Admin dashboard
app.get('/admin/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Admin list animations
app.get('/admin/list', isAuthenticated, (req, res) => {
    db.all('SELECT * FROM animations', (err, rows) => {
        if (err) {
            console.error('Error fetching animations:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ animations: rows });
    });
});

// Admin edit animation page
app.get('/admin/edit/:id', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'edit.html'));
});

// Admin add animation
app.post('/admin/add', isAuthenticated, upload.single('video'), async (req, res) => {
    const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;
    const videoPath = req.file ? req.file.path : 'videos/default.mp4';

    try {
        // Insert the original animation
        const insertAnimation = (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided) => {
            return new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided ? 1 : 0], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                });
            });
        };

        const originalId = await insertAnimation(name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided);

        // If two-sided, create a mirrored animation
        if (twoSided) {
            const mirroredName = name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredVoiceoverText = voiceoverText.replace(/left/i, 'right').replace(/right/i, 'left');
            const mirroredVideoPath = videoPath.replace('.mp4', '_mirrored.mp4');
            await flipVideo(videoPath, mirroredVideoPath);
            await insertAnimation(mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, twoSided);
        }

        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error adding animation:', error);
        res.status(500).send('Error adding animation');
    }
});

// Admin update animation
app.post('/admin/update/:id', isAuthenticated, upload.single('video'), async (req, res) => {
    const { id } = req.params;
    const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;
    const videoPath = req.file ? req.file.path : null;

    try {
        // Fetch the current animation
        const animation = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        // Update the original animation
        const updateAnimation = (id, name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided) => {
            return new Promise((resolve, reject) => {
                const query = videoPath
                    ? `UPDATE animations SET name = ?, videoPath = ?, voiceoverText = ?, setsRepsDuration = ?, reminder = ?, twoSided = ? WHERE id = ?`
                    : `UPDATE animations SET name = ?, voiceoverText = ?, setsRepsDuration = ?, reminder = ?, twoSided = ? WHERE id = ?`;
                const params = videoPath
                    ? [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided ? 1 : 0, id]
                    : [name, voiceoverText, setsRepsDuration, reminder, twoSided ? 1 : 0, id];
                db.run(query, params, function(err) {
                    if (err) reject(err);
                    resolve();
                });
            });
        };

        await updateAnimation(id, name, videoPath || animation.videoPath, voiceoverText, setsRepsDuration, reminder, twoSided);

        // If two-sided, update or create the mirrored animation
        if (twoSided) {
            const mirroredName = name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredVoiceoverText = voiceoverText.replace(/left/i, 'right').replace(/right/i, 'left');
            const mirroredVideoPath = videoPath ? videoPath.replace('.mp4', '_mirrored.mp4') : animation.videoPath.replace('.mp4', '_mirrored.mp4');

            if (videoPath) {
                await flipVideo(videoPath, mirroredVideoPath);
            }

            const mirroredAnimation = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM animations WHERE name = ?', [mirroredName], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (mirroredAnimation) {
                await updateAnimation(mirroredAnimation.id, mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, twoSided);
            } else {
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, 1], (err) => {
                        if (err) reject(err);
                        resolve();
                    });
                });
            }
        }

        // Clear cached narrated videos
        const tempDir = path.join(__dirname, 'temp');
        const files = await fs.readdir(tempDir);
        for (const file of files) {
            if (file.includes(`temp_video_${id}_`)) {
                await fs.unlink(path.join(tempDir, file));
            }
        }

        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error updating animation:', error);
        res.status(500).send('Error updating animation');
    }
});

// Embed route for animations
app.get('/embed/:id', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Animation Player</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background-color: #f0f0f0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                }
                .player-container {
                    background-color: white;
                    padding: 20px;
                    border-radius: 5px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    max-width: 600px;
                    width: 100%;
                    text-align: center;
                }
                video {
                    width: 100%;
                    margin-bottom: 20px;
                }
            </style>
        </head>
        <body>
            <div class="player-container">
                <div id="animationDetails"></div>
                <video id="animationVideo" controls></video>
                <label for="languageSelect">Select Language:</label>
                <select id="languageSelect">
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                </select>
            </div>
            <script>
                const id = window.location.pathname.split('/').pop();
                fetch(\`/api/animation/\${id}\`)
                    .then(response => response.json())
                    .then(data => {
                        const details = document.getElementById('animationDetails');
                        details.innerHTML = \`
                            <p><strong>Name:</strong> \${data.name}</p>
                            <p><strong>Sets/Reps/Duration:</strong> \${data.setsRepsDuration}</p>
                            <p><strong>Reminder:</strong> \${data.reminder}</p>
                        \`;

                        const video = document.getElementById('animationVideo');
                        const languageSelect = document.getElementById('languageSelect');

                        const loadVideo = (lang) => {
                            fetch(\`/api/narration/\${id}/\${lang}/full\`)
                                .then(response => response.json())
                                .then(data => {
                                    video.src = data.videoUrl;
                                });
                        };

                        languageSelect.onchange = () => loadVideo(languageSelect.value);
                        loadVideo('en');
                    });
            </script>
        </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    console.log('Received request for /health endpoint');
    res.status(200).json({ status: 'OK' });
});

// Root route
app.get('/', (req, res) => {
    console.log('Received request for / endpoint');
    res.json({ message: 'Server is running' });
});

// Test endpoint
app.get('/test', (req, res) => {
    console.log('Received request for /test endpoint');
    res.json({ message: 'Test endpoint is working!' });
});

// API to get animation metadata
app.get('/api/animation/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request

 for /api/animation/${id}`);
    db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Error fetching animation:', err.message);
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            console.log(`Animation with ID ${id} not found`);
            return res.status(404).json({ error: 'Animation not found' });
        }
        console.log(`Found animation with ID ${id}:`, row);
        res.json(row);
    });
});

// API to generate narration and combine with video
app.post('/api/narration/:id/:language/full', async (req, res) => {
    const { id, language } = req.params;

    try {
        console.log(`Received request for /api/narration/${id}/${language}/full`);

        const animation = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                if (!row) reject(new Error('Animation not found'));
                resolve(row);
            });
        });

        console.log('Processing animation:', animation);

        const translatedText = await translateText(animation.voiceoverText, language);
        console.log('Translated text:', translatedText);

        const narrationPath = await fetchNarration(translatedText, language);

        const videoPath = path.join(__dirname, animation.videoPath);
        const outputPath = path.join(__dirname, `temp/temp_video_${id}_${language}_full.mp4`);
        await combineVideoAndAudio(videoPath, narrationPath, outputPath);

        console.log(`Successfully created ${outputPath}`);

        res.json({ videoUrl: `/temp/temp_video_${id}_${language}_full.mp4` });
    } catch (error) {
        console.error('Error processing narration:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
const server = app.listen(port, host, async () => {
    console.log(`Server running on port ${port}`);
    await ensureDirectories();
    initializeDatabase();
});