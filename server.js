const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const session = require('express-session');
const { Translate } = require('@google-cloud/translate').v2;
const AWS = require('aws-sdk');

const app = express();
const port = process.env.PORT || 10000;
const host = '0.0.0.0';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const translate = new Translate({ key: GOOGLE_API_KEY });

// Configure DigitalOcean Spaces
const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT);
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET
});

// Helper function to upload to Spaces
async function uploadToSpaces(filePath, key) {
    try {
        const fileContent = await fs.readFile(filePath);
        await s3.upload({
            Bucket: process.env.SPACES_BUCKET,
            Key: key,
            Body: fileContent,
            ACL: 'public-read'
        }).promise();
        return `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${key}`;
    } catch (err) {
        console.error(`Error uploading to Spaces: ${err.message}`);
        throw err;
    }
}

// Helper function to check if file exists in Spaces
async function fileExistsInSpaces(key) {
    try {
        await s3.headObject({
            Bucket: process.env.SPACES_BUCKET,
            Key: key
        }).promise();
        return true;
    } catch (err) {
        return false;
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/videos', express.static(path.join(__dirname, 'videos')));
app.use('/temp', express.static(path.join(__dirname, 'temp'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.mp4')) {
            res.setHeader('Content-Type', 'video/mp4');
        }
    }
}));
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

// Helper function to pad narration with silence to match target duration
async function adjustNarrationDuration(inputPath, outputPath, targetDuration) {
    try {
        const audioDuration = await getAudioDuration(inputPath);
        console.log(`Original narration duration: ${audioDuration} seconds`);
        
        // Target duration for the narration itself (excluding the 1-second delay)
        const narrationTargetDuration = targetDuration - 1; // 38 - 1 = 37 seconds
        const paddingDuration = (narrationTargetDuration - audioDuration) * 1000; // Convert to milliseconds for FFmpeg
        console.log(`Padding duration: ${paddingDuration} ms`);

        if (paddingDuration <= 0) {
            // If the audio is already longer than the target, just add the 1-second delay
            return new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .audioFilters('adelay=1000|1000') // 1-second delay at the start
                    .output(outputPath)
                    .on('end', async () => {
                        console.log(`Added 1-second delay to narration: ${outputPath}`);
                        // Validate the output file
                        try {
                            const adjustedDuration = await getAudioDuration(outputPath);
                            console.log(`Adjusted narration duration: ${adjustedDuration} seconds`);
                            resolve(outputPath);
                        } catch (err) {
                            console.error(`Validation failed for adjusted narration: ${err.message}`);
                            reject(err);
                        }
                    })
                    .on('error', (err) => {
                        console.error(`Error adding delay to narration: ${err.message}`);
                        reject(err);
                    })
                    .run();
            });
        }

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .audioFilters([
                    'adelay=1000|1000', // 1-second delay at the start
                    `apad=pad_dur=${paddingDuration / 1000}` // Pad with silence at the end
                ])
                .output(outputPath)
                .on('end', async () => {
                    console.log(`Padded narration duration to ${targetDuration} seconds (including 1-second delay): ${outputPath}`);
                    // Validate the output file
                    try {
                        const adjustedDuration = await getAudioDuration(outputPath);
                        console.log(`Adjusted narration duration: ${adjustedDuration} seconds`);
                        if (Math.abs(adjustedDuration - targetDuration) > 1) {
                            console.error(`Adjusted narration duration (${adjustedDuration}) does not match target (${targetDuration})`);
                            reject(new Error('Adjusted narration duration does not match target'));
                        } else {
                            resolve(outputPath);
                        }
                    } catch (err) {
                        console.error(`Validation failed for adjusted narration: ${err.message}`);
                        reject(err);
                    }
                })
                .on('error', (err) => {
                    console.error(`Error padding narration duration: ${err.message}`);
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

            let defaultAnimationId = null;
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
                await new Promise((resolve, reject) => {
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
                    ], function(err) {
                        if (err) {
                            console.error('Error inserting default animation:', err.message);
                            reject(err);
                        } else {
                            console.log('Default animation inserted successfully.');
                            defaultAnimationId = this.lastID;
                            resolve();
                        }
                    });
                });
                // Pre-generate for the default animation immediately after insertion
                if (defaultAnimationId) {
                    await pregenerateNarratedVideos(defaultAnimationId);
                }
            }

            // Pre-generate narrated videos for all existing animations on startup
            setTimeout(async () => {
                try {
                    const rows = await new Promise((resolve, reject) => {
                        db.all('SELECT id FROM animations', (err, rows) => {
                            if (err) {
                                console.error('Error fetching animations for pre-generation:', err.message);
                                reject(err);
                            } else {
                                resolve(rows);
                            }
                        });
                    });
                    for (const row of rows) {
                        if (row.id) {
                            await pregenerateNarratedVideos(row.id);
                        }
                    }
                } catch (error) {
                    console.error('Error during pre-generation on startup:', error.message);
                }
            }, 2000); // Increased delay to ensure DB operations are complete
        });
    });
};

// Helper function to translate text using Google Translate API
async function translateText(text, language) {
    console.log(`Translating voiceoverText to ${language}: ${text}`);
    try {
        const [translation] = await translate.translate(text, language);
        console.log(`Translated text for ${language}: ${translation}`);
        return translation;
    } catch (error) {
        console.error(`Error translating text to ${language}: ${error.message}`);
        return text; // Fallback to original text
    }
}

// Helper function to fetch narration from ElevenLabs
async function fetchNarration(text, language) {
    console.log(`Calling ElevenLabs API with text: ${text}, language: ${language}`);
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
            console.error(`ElevenLabs API error for language ${language}: ${errorText}`);
            throw new Error(`ElevenLabs API error: ${errorText}`);
        }

        const narrationPath = path.join(__dirname, `narration_${language}.mp3`);
        const arrayBuffer = await response.arrayBuffer();
        await fs.writeFile(narrationPath, Buffer.from(arrayBuffer));
        console.log(`Narration path for language ${language}: ${narrationPath}`);
        return narrationPath;
    } catch (error) {
        console.error(`Error in fetchNarration for language ${language}: ${error.message}`);
        throw error;
    }
}

// Helper function to combine video and audio using ffmpeg
async function combineVideoAndAudio(videoPath, audioPath, outputPath) {
    try {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions('-c:v copy')
                .outputOptions('-c:a aac')
                .outputOptions('-map 0:v:0')
                .outputOptions('-map 1:a:0')
                .output(outputPath)
                .on('end', async () => {
                    console.log(`FFmpeg combine completed: ${outputPath}`);
                    // Validate the output video file
                    try {
                        const videoDuration = await getVideoDuration(outputPath);
                        console.log(`Generated video duration: ${videoDuration} seconds`);
                        resolve(outputPath);
                    } catch (err) {
                        console.error(`Validation failed for generated video: ${err.message}`);
                        reject(err);
                    }
                })
                .on('error', (err) => {
                    console.error(`FFmpeg combine error: ${err.message}`);
                    reject(err);
                })
                .run();
        });
    } catch (error) {
        console.error(`Error in combineVideoAndAudio: ${error.message}`);
        throw error;
    }
}

// Helper function to flip video horizontally using ffmpeg
async function flipVideo(inputPath, outputPath) {
    try {
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
    } catch (error) {
        console.error(`Error in flipVideo: ${error.message}`);
        throw error;
    }
}

// Helper function to pre-generate narrated videos for English and Spanish
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

        const languages = ['en', 'es']; // Only English and Spanish
        const originalVideoPath = path.join(__dirname, animation.videoPath);
        const targetDuration = animation.originalDuration || 38;

        for (const language of languages) {
            console.log(`Pre-generating narrated video for animation ${id} in language ${language}`);
            const videoKey = `temp_video_${id}_${language}_full.mp4`;
            const videoExists = await fileExistsInSpaces(videoKey);
            if (!videoExists) {
                try {
                    const translatedText = await translateText(animation.voiceoverText, language);
                    const narrationPath = await fetchNarration(translatedText, language);
                    const adjustedNarrationPath = path.join(__dirname, `narration_adjusted_${language}.mp3`);
                    const combinedOutputPath = path.join(__dirname, `combined_${id}_${language}.mp4`);
                    await adjustNarrationDuration(narrationPath, adjustedNarrationPath, targetDuration);
                    await combineVideoAndAudio(originalVideoPath, adjustedNarrationPath, combinedOutputPath);
                    await uploadToSpaces(combinedOutputPath, videoKey);
                    console.log(`Pre-generated video: ${videoKey}`);
                } catch (err) {
                    console.error(`Failed to pre-generate video for language ${language}: ${err.message}`);
                    continue;
                }
            } else {
                console.log(`Video already exists for animation ${id} in language ${language}: ${videoKey}`);
            }
        }
    } catch (error) {
        console.error(`Error pre-generating narrated videos for animation ${id}: ${error.message}`);
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

// API to serve narrated videos from Spaces
app.get('/api/narration/:id/:language/full', async (req, res) => {
    const { id, language } = req.params;

    // Restrict to supported languages
    if (!['en', 'es'].includes(language)) {
        return res.status(400).json({ error: 'Unsupported language' });
    }

    try {
        console.log(`Received request for /api/narration/${id}/${language}/full`);

        const videoKey = `temp_video_${id}_${language}_full.mp4`;
        const videoExists = await fileExistsInSpaces(videoKey);

        if (!videoExists) {
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
            const combinedOutputPath = path.join(__dirname, `combined_${id}_${language}.mp4`);
            const targetDuration = animation.originalDuration || 38;
            await adjustNarrationDuration(narrationPath, adjustedNarrationPath, targetDuration);
            await combineVideoAndAudio(originalVideoPath, adjustedNarrationPath, combinedOutputPath);
            await uploadToSpaces(combinedOutputPath, videoKey);
            console.log(`Generated video: ${videoKey}`);
        }

        const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${videoKey}`;
        res.json({ videoUrl });
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