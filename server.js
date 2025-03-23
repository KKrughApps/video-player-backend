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
const port = process.env.PORT || 10000;
const host = '0.0.0.0';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
    try {
        await fs.mkdir(path.join(__dirname, 'videos'), { recursive: true });
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
    } catch (err) {
        console.error('Error creating directories:', err.message);
    }
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

// Helper function to get video duration using ffmpeg
async function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                console.error(`Error getting video duration: ${err.message}`);
                reject(err);
            } else {
                const duration = metadata.format.duration;
                resolve(duration);
            }
        });
    });
}

// Helper function to get audio duration using ffmpeg
async function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                console.error(`Error getting audio duration: ${err.message}`);
                reject(err);
            } else {
                const duration = metadata.format.duration;
                resolve(duration);
            }
        });
    });
}

// Helper function to adjust narration duration using ffmpeg
async function adjustNarrationDuration(inputPath, outputPath, targetDuration) {
    try {
        const audioDuration = await getAudioDuration(inputPath);
        let tempo = targetDuration / audioDuration;
        // Constrain tempo to reasonable limits (0.5 to 2.0) to avoid extreme speed changes
        if (tempo < 0.5) tempo = 0.5;
        if (tempo > 2.0) tempo = 2.0;
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .audioFilters(`atempo=${tempo}`)
                .output(outputPath)
                .on('end', () => {
                    console.log(`Adjusted narration duration: ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error(`Error adjusting narration duration: ${err.message}`);
                    reject(err);
                })
                .run();
        });
    } catch (err) {
        console.error(`Error in adjustNarrationDuration: ${err.message}`);
        throw err;
    }
}

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
                twoSided INTEGER DEFAULT 0,
                originalDuration REAL DEFAULT 0
            )
        `, (err) => {
            if (err) {
                console.error('Error creating animations table:', err.message);
            } else {
                console.log('Animations table created or already exists.');
            }
        });

        db.get('SELECT COUNT(*) as count FROM animations', async (err, row) => {
            if (err) {
                console.error('Error checking animations table:', err.message);
                return;
            }
            if (row.count === 0) {
                console.log('Inserting default animation data...');
                const defaultVideoPath = 'videos/default.mp4';
                let originalDuration = 0;
                try {
                    originalDuration = await getVideoDuration(defaultVideoPath);
                } catch (err) {
                    console.error('Error getting default video duration:', err.message);
                    originalDuration = 38; // Fallback to expected duration
                }
                db.run(`
                    INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    'Foam Roller Front of Thighs Left',
                    defaultVideoPath,
                    'Start, by lying face down, with your forearms and elbows, on the floor. The roller is positioned, at mid thigh level. Keeping your legs relaxed, and your knees comfortably straight, distribute your weight slightly more, to your left thigh, while still keeping your hips level. This will put the majority of the pressure, into your left thigh. From this position, roll from just above your knee, to just below your hip, and back and forth slowly. Continue keeping your legs relaxed, your back flat, and your vision on the floor, to maintain your neck and back alignment, throughout the movement.',
                    'Roll for 30 seconds to 1 minute.',
                    'Keep your rolling speed slow and controlled.',
                    0,
                    originalDuration
                ], async (err) => {
                    if (err) {
                        console.error('Error inserting default animation:', err.message);
                    } else {
                        console.log('Default animation inserted successfully.');
                        const animationId = this.lastID;
                        await pregenerateNarratedVideos(animationId);
                    }
                });
            }
            // Pre-generate narrated videos for all existing animations on startup
            db.all('SELECT id FROM animations', async (err, rows) => {
                if (err) {
                    console.error('Error fetching animations for pre-generation:', err.message);
                    return;
                }
                for (const row of rows) {
                    await pregenerateNarratedVideos(row.id);
                }
            });
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
    console.log(`Using API key: ${ELEVENLABS_API_KEY}`);
    const voiceId = 'TX3LPaxmHKxFdv7VOQHJ'; // Liam's correct voice ID
    try {
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

        console.log(`ElevenLabs API response status: ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`ElevenLabs API error: ${errorText}`);
            throw new Error(`ElevenLabs API error: ${errorText}`);
        }

        const narrationPath = path.join(__dirname, `narration_${language}.mp3`);
        const arrayBuffer = await response.arrayBuffer();
        await fs.writeFile(narrationPath, Buffer.from(arrayBuffer));
        console.log(`Narration path: ${narrationPath}`);
        return narrationPath;
    } catch (error) {
        console.error(`Error in fetchNarration: ${error.message}`);
        throw error;
    }
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
            .on('end', () => {
                console.log(`FFmpeg combine completed: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`FFmpeg combine error: ${err.message}`);
                reject(err);
            })
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
            .on('end', () => {
                console.log(`FFmpeg flip completed: ${outputPath}`);
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error(`FFmpeg flip error: ${err.message}`);
                reject(err);
            })
            .run();
    });
}

// Helper function to pre-generate narrated videos for all languages
async function pregenerateNarratedVideos(id) {
    try {
        const animation = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
                if (err) {
                    console.error(`Database error: ${err.message}`);
                    reject(err);
                }
                if (!row) {
                    console.error('Animation not found');
                    reject(new Error('Animation not found'));
                }
                resolve(row);
            });
        });

        const languages = ['en', 'es', 'fr', 'de', 'it', 'ja', 'ko'];
        const originalVideoPath = path.join(__dirname, animation.videoPath);
        const targetDuration = animation.originalDuration || 38; // Fallback to 38 seconds if not set

        for (const language of languages) {
            console.log(`Pre-generating narrated video for animation ${id} in language ${language}`);
            const videoPath = path.join(__dirname, `temp/temp_video_${id}_${language}_full.mp4`);
            const fileExists = await fs.access(videoPath).then(() => true).catch(() => false);

            if (!fileExists) {
                const translatedText = await translateText(animation.voiceoverText, language);
                const narrationPath = await fetchNarration(translatedText, language);
                const adjustedNarrationPath = path.join(__dirname, `narration_adjusted_${language}.mp3`);
                await adjustNarrationDuration(narrationPath, adjustedNarrationPath, targetDuration);
                await combineVideoAndAudio(originalVideoPath, adjustedNarrationPath, videoPath);
                console.log(`Pre-generated video: ${videoPath}`);
            } else {
                console.log(`Video already exists for animation ${id} in language ${language}: ${videoPath}`);
            }
        }
    } catch (error) {
        console.error(`Error pre-generating narrated videos for animation ${id}:`, error.message);
    }
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
        const originalDuration = await getVideoDuration(videoPath);
        const insertAnimation = (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration) => {
            return new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided ? 1 : 0, originalDuration], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                });
            });
        };

        const originalId = await insertAnimation(name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
        await pregenerateNarratedVideos(originalId);

        if (twoSided) {
            const mirroredName = name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredVoiceoverText = voiceoverText.replace(/left/i, 'right').replace(/right/i, 'left');
            const mirroredVideoPath = videoPath.replace('.mp4', '_mirrored.mp4');
            await flipVideo(videoPath, mirroredVideoPath);
            const mirroredId = await insertAnimation(mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
            await pregenerateNarratedVideos(mirroredId);
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
        const animation = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        const originalDuration = videoPath ? await getVideoDuration(videoPath) : animation.originalDuration;

        const updateAnimation = (id, name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration) => {
            return new Promise((resolve, reject) => {
                const query = videoPath
                    ? `UPDATE animations SET name = ?, videoPath = ?, voiceoverText = ?, setsRepsDuration = ?, reminder = ?, twoSided = ?, originalDuration = ? WHERE id = ?`
                    : `UPDATE animations SET name = ?, voiceoverText = ?, setsRepsDuration = ?, reminder = ?, twoSided = ? WHERE id = ?`;
                const params = videoPath
                    ? [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided ? 1 : 0, originalDuration, id]
                    : [name, voiceoverText, setsRepsDuration, reminder, twoSided ? 1 : 0, id];
                db.run(query, params, function(err) {
                    if (err) reject(err);
                    resolve();
                });
            });
        };

        await updateAnimation(id, name, videoPath || animation.videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
        await pregenerateNarratedVideos(id);

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
                await updateAnimation(mirroredAnimation.id, mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
                await pregenerateNarratedVideos(mirroredAnimation.id);
            } else {
                const mirroredId = await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, 1, originalDuration], function(err) {
                        if (err) reject(err);
                        resolve(this.lastID);
                    });
                });
                await pregenerateNarratedVideos(mirroredId);
            }
        }

        const tempDir = path.join(__dirname, 'temp');
        const files = await fs.readdir(tempDir);
        for (const file of files) {
            if (file.includes(`temp_video_${id}_`)) {
                await fs.unlink(path.join(tempDir, file)).catch(err => console.error(`Error deleting file: ${err.message}`));
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
    console.log(`Received request for /api/animation/${id}`);
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

// API to serve pre-generated narrated videos
app.get('/api/narration/:id/:language/full', async (req, res) => {
    const { id, language } = req.params;

    try {
        console.log(`Received request for /api/narration/${id}/${language}/full`);

        const videoPath = path.join(__dirname, `temp/temp_video_${id}_${language}_full.mp4`);
        const fileExists = await fs.access(videoPath).then(() => true).catch(() => false);

        if (!fileExists) {
            console.log(`Pre-generated video not found for ${id}/${language}, generating now...`);
            const animation = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
                    if (err) {
                        console.error(`Database error: ${err.message}`);
                        reject(err);
                    }
                    if (!row) {
                        console.error('Animation not found');
                        reject(new Error('Animation not found'));
                    }
                    resolve(row);
                });
            });

            const translatedText = await translateText(animation.voiceoverText, language);
            const narrationPath = await fetchNarration(translatedText, language);
            const originalVideoPath = path.join(__dirname, animation.videoPath);
            const adjustedNarrationPath = path.join(__dirname, `narration_adjusted_${language}.mp3`);
            const targetDuration = animation.originalDuration || 38; // Fallback to 38 seconds
            await adjustNarrationDuration(narrationPath, adjustedNarrationPath, targetDuration);
            await combineVideoAndAudio(originalVideoPath, adjustedNarrationPath, videoPath);
            console.log(`Generated video: ${videoPath}`);
        }

        res.json({ videoUrl: `/temp/temp_video_${id}_${language}_full.mp4` });
    } catch (error) {
        console.error('Error serving narrated video:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
const server = app.listen(port, host, async () => {
    console.log(`Server running on port ${port}`);
    await ensureDirectories();
    initializeDatabase();
});