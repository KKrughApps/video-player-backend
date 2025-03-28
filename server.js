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
        console.log(`Uploading file ${filePath} to Spaces with key ${key}`);
        const uploadResult = await s3.upload({
            Bucket: process.env.SPACES_BUCKET,
            Key: key,
            Body: fileContent,
            ACL: 'public-read',
            ContentType: 'video/mp4' // Ensure correct MIME type
        }).promise();
        const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${key}`;
        console.log(`Successfully uploaded to Spaces: ${videoUrl}`);

        // Verify the file is publicly accessible
        console.log(`Verifying public accessibility of ${videoUrl}`);
        const response = await fetch(videoUrl, { method: 'HEAD' });
        if (response.ok) {
            console.log(`File is publicly accessible: ${videoUrl}`);
        } else {
            console.error(`File is not publicly accessible: ${videoUrl} (Status: ${response.status})`);
            throw new Error(`File is not publicly accessible: ${videoUrl}`);
        }

        return videoUrl;
    } catch (err) {
        console.error(`Error uploading to Spaces: ${err.message}`);
        console.error(err.stack);
        throw err;
    }
}

// Helper function to check if file exists in Spaces
async function fileExistsInSpaces(key) {
    try {
        console.log(`Checking if file exists in Spaces: ${key}`);
        await s3.headObject({
            Bucket: process.env.SPACES_BUCKET,
            Key: key
        }).promise();
        console.log(`File exists in Spaces: ${key}`);
        return true;
    } catch (err) {
        console.log(`File does not exist in Spaces: ${key} (${err.message})`);
        return false;
    }
}

// Helper function to delete a file from Spaces
async function deleteFromSpaces(key) {
    try {
        console.log(`Deleting file from Spaces: ${key}`);
        await s3.deleteObject({
            Bucket: process.env.SPACES_BUCKET,
            Key: key
        }).promise();
        console.log(`Successfully deleted from Spaces: ${key}`);
    } catch (err) {
        console.error(`Error deleting from Spaces: ${err.message}`);
        throw err;
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
                console.error(`Error getting video duration for ${videoPath}: ${err.message}`);
                reject(err);
            } else {
                const duration = metadata.format.duration;
                console.log(`Video duration for ${videoPath}: ${duration} seconds`);
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
                console.error(`Error getting audio duration for ${audioPath}: ${err.message}`);
                reject(err);
            } else {
                const duration = metadata.format.duration;
                console.log(`Audio duration for ${audioPath}: ${duration} seconds`);
                resolve(duration);
            }
        });
    });
}

// Helper function to pad narration with silence to match target duration
async function adjustNarrationDuration(inputPath, outputPath, videoDuration) {
    try {
        const audioDuration = await getAudioDuration(inputPath);
        console.log(`Original narration duration: ${audioDuration} seconds`);

        // Target duration for the spoken content (including 1-second delay, ending 2 seconds before video ends)
        const targetSpokenDuration = videoDuration - 2; // End 2 seconds before video ends
        const spokenDurationWithDelay = targetSpokenDuration - 1; // Subtract 1 second for the delay
        const paddingDuration = (spokenDurationWithDelay - audioDuration); // Duration to pad in seconds
        console.log(`Target spoken duration (including 1-second delay): ${targetSpokenDuration} seconds`);
        console.log(`Padding duration for spoken content: ${paddingDuration} seconds`);

        return new Promise((resolve, reject) => {
            const ffmpegCommand = ffmpeg(inputPath)
                .audioFilters([
                    'adelay=1000|1000' // 1-second delay at the start
                ]);

            // Add padding if necessary
            if (paddingDuration > 0) {
                ffmpegCommand.audioFilters(`apad=pad_dur=${paddingDuration}`); // Pad with silence
            }

            ffmpegCommand
                .output(outputPath)
                .on('end', async () => {
                    console.log(`Adjusted narration to target duration ${targetSpokenDuration} seconds (including 1-second delay): ${outputPath}`);
                    try {
                        const adjustedDuration = await getAudioDuration(outputPath);
                        console.log(`Adjusted narration duration: ${adjustedDuration} seconds`);
                        if (Math.abs(adjustedDuration - targetSpokenDuration) > 0.5) {
                            console.error(`Adjusted narration duration (${adjustedDuration}) does not match target (${targetSpokenDuration})`);
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

// Helper function to translate text using Google Translate API
async function translateText(text, language) {
    console.log(`Translating voiceoverText to ${language}: ${text}`);
    try {
        const [translation] = await translate.translate(text, language);
        console.log(`Translated text for ${language}: ${translation}`);
        return translation;
    } catch (error) {
        console.error(`Error translating text to ${language}: ${error.message}`);
        console.error(error.stack);
        throw error; // Throw the error to be caught by the caller
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
        console.error(error.stack);
        throw error;
    }
}

// Helper function to combine video and audio using ffmpeg
async function combineVideoAndAudio(videoPath, audioPath, outputPath, videoDuration) {
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
                        const finalDuration = await getVideoDuration(outputPath);
                        console.log(`Generated video duration: ${finalDuration} seconds`);
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
                    console.error(`Database error fetching animation ${id}: ${err.message}`);
                    reject(err);
                }
                if (!row) {
                    console.error(`Animation ${id} not found`);
                    reject(new Error('Animation not found'));
                }
                resolve(row);
            });
        });

        const languages = ['en', 'es']; // English and Spanish
        const originalVideoPath = path.join(__dirname, animation.videoPath);
        const videoDuration = animation.originalDuration || 38;

        for (const language of languages) {
            console.log(`Starting pre-generation for animation ${id} in language ${language}`);
            const videoKey = `temp_video_${id}_${language}_full.mp4`;
            const videoExists = await fileExistsInSpaces(videoKey);
            if (videoExists) {
                console.log(`Video already exists for animation ${id} in language ${language}: ${videoKey}, skipping pre-generation.`);
                continue;
            }

            try {
                // Step 1: Translate the voiceover text
                console.log(`Translating voiceover text for animation ${id} to ${language}`);
                const translatedText = await translateText(animation.voiceoverText, language);
                console.log(`Successfully translated voiceover text for animation ${id} to ${language}`);

                // Step 2: Fetch narration from ElevenLabs
                console.log(`Fetching narration for animation ${id} in ${language}`);
                const narrationPath = await fetchNarration(translatedText, language);
                console.log(`Successfully fetched narration for animation ${id} in ${language}`);

                // Step 3: Adjust narration duration
                console.log(`Adjusting narration duration for animation ${id} in ${language}`);
                const adjustedNarrationPath = path.join(__dirname, `narration_adjusted_${language}.mp3`);
                await adjustNarrationDuration(narrationPath, adjustedNarrationPath, videoDuration);
                console.log(`Successfully adjusted narration duration for animation ${id} in ${language}`);

                // Step 4: Combine video and narration
                console.log(`Combining video and narration for animation ${id} in ${language}`);
                const combinedOutputPath = path.join(__dirname, `combined_${id}_${language}.mp4`);
                await combineVideoAndAudio(originalVideoPath, adjustedNarrationPath, combinedOutputPath, videoDuration);
                console.log(`Successfully combined video and narration for animation ${id} in ${language}`);

                // Step 5: Upload to DigitalOcean Spaces
                console.log(`Uploading video to Spaces for animation ${id} in ${language}`);
                await uploadToSpaces(combinedOutputPath, videoKey);
                console.log(`Successfully uploaded video to Spaces for animation ${id} in ${language}: ${videoKey}`);

                // Clean up temporary files
                await fs.unlink(narrationPath).catch(err => console.error(`Error deleting narration file ${narrationPath}: ${err.message}`));
                await fs.unlink(adjustedNarrationPath).catch(err => console.error(`Error deleting adjusted narration file ${adjustedNarrationPath}: ${err.message}`));
                await fs.unlink(combinedOutputPath).catch(err => console.error(`Error deleting combined file ${combinedOutputPath}: ${err.message}`));
            } catch (err) {
                console.error(`Failed to pre-generate video for animation ${id} in language ${language}: ${err.message}`);
                console.error(err.stack);
                continue; // Continue with the next language
            }
        }
        console.log(`Completed pre-generation for animation ${id}`);
    } catch (error) {
        console.error(`Error pre-generating narrated videos for animation ${id}: ${error.message}`);
        console.error(error.stack);
        throw error;
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
                    try {
                        await pregenerateNarratedVideos(defaultAnimationId);
                    } catch (err) {
                        console.error(`Error pre-generating narrated videos for default animation ${defaultAnimationId}: ${err.message}`);
                    }
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
                            // Check if videos already exist for this animation
                            const enVideoExists = await fileExistsInSpaces(`temp_video_${row.id}_en_full.mp4`);
                            const esVideoExists = await fileExistsInSpaces(`temp_video_${row.id}_es_full.mp4`);
                            if (enVideoExists && esVideoExists) {
                                console.log(`Videos already exist for animation ${row.id}, skipping pre-generation.`);
                                continue;
                            }
                            try {
                                await pregenerateNarratedVideos(row.id);
                            } catch (err) {
                                console.error(`Error pre-generating narrated videos for animation ${row.id} on startup: ${err.message}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error during pre-generation on startup:', error.message);
                }
            }, 2000); // Increased delay to ensure DB operations are complete
        });
    });
};

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
        console.log(`Starting upload for animation: ${name}`);
        const originalDuration = await getVideoDuration(videoPath);
        console.log(`Original duration for ${videoPath}: ${originalDuration} seconds`);

        const insertAnimation = (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration) => {
            return new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided ? 1 : 0, originalDuration], function(err) {
                    if (err) {
                        console.error(`Error inserting animation ${name}: ${err.message}`);
                        reject(err);
                    } else {
                        console.log(`Successfully inserted animation ${name} with ID ${this.lastID}`);
                        resolve(this.lastID);
                    }
                });
            });
        };

        const originalId = await insertAnimation(name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
        console.log(`Pre-generating narrated videos for original animation ID ${originalId}`);
        await pregenerateNarratedVideos(originalId);

        if (twoSided) {
            console.log(`Animation ${name} is two-sided, generating mirrored version`);
            const mirroredName = name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredVoiceoverText = voiceoverText.replace(/left/i, 'right').replace(/right/i, 'left');
            const mirroredVideoPath = videoPath.replace('.mp4', '_mirrored.mp4');
            await flipVideo(videoPath, mirroredVideoPath);
            console.log(`Mirrored video generated at ${mirroredVideoPath}`);

            const mirroredId = await insertAnimation(mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
            console.log(`Pre-generating narrated videos for mirrored animation ID ${mirroredId}`);
            await pregenerateNarratedVideos(mirroredId);
        }

        console.log(`Successfully added animation ${name} and its narrated videos`);
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error(`Error adding animation ${name}: ${error.message}`);
        console.error(error.stack);
        res.status(500).send('Error adding animation');
    }
});

// Admin update animation
app.post('/admin/update/:id', isAuthenticated, upload.single('video'), async (req, res) => {
    const { id } = req.params;
    const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;
    const videoPath = req.file ? req.file.path : null;

    try {
        console.log(`Starting update for animation ID ${id}`);
        const animation = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
                if (err) {
                    console.error(`Error fetching animation ${id}: ${err.message}`);
                    reject(err);
                }
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
                    if (err) {
                        console.error(`Error updating animation ${id}: ${err.message}`);
                        reject(err);
                    } else {
                        console.log(`Successfully updated animation ${id}`);
                        resolve();
                    }
                });
            });
        };

        await updateAnimation(id, name, videoPath || animation.videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
        console.log(`Pre-generating narrated videos for updated animation ID ${id}`);
        await pregenerateNarratedVideos(id);

        if (twoSided) {
            console.log(`Animation ${name} is two-sided, updating mirrored version`);
            const mirroredName = name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredVoiceoverText = voiceoverText.replace(/left/i, 'right').replace(/right/i, 'left');
            const mirroredVideoPath = videoPath ? videoPath.replace('.mp4', '_mirrored.mp4') : animation.videoPath.replace('.mp4', '_mirrored.mp4');

            if (videoPath) {
                await flipVideo(videoPath, mirroredVideoPath);
                console.log(`Mirrored video updated at ${mirroredVideoPath}`);
            }

            const mirroredAnimation = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM animations WHERE name = ?', [mirroredName], (err, row) => {
                    if (err) {
                        console.error(`Error fetching mirrored animation for ${mirroredName}: ${err.message}`);
                        reject(err);
                    }
                    resolve(row);
                });
            });

            if (mirroredAnimation) {
                await updateAnimation(mirroredAnimation.id, mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, twoSided, originalDuration);
                console.log(`Pre-generating narrated videos for updated mirrored animation ID ${mirroredAnimation.id}`);
                await pregenerateNarratedVideos(mirroredAnimation.id);
            } else {
                const mirroredId = await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, 1, originalDuration], function(err) {
                        if (err) {
                            console.error(`Error inserting mirrored animation ${mirroredName}: ${err.message}`);
                            reject(err);
                        } else {
                            console.log(`Successfully inserted mirrored animation ${mirroredName} with ID ${this.lastID}`);
                            resolve(this.lastID);
                        }
                    });
                });
                console.log(`Pre-generating narrated videos for new mirrored animation ID ${mirroredId}`);
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

        console.log(`Successfully updated animation ${id} and its narrated videos`);
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error(`Error updating animation ${id}: ${error.message}`);
        console.error(error.stack);
        res.status(500).send('Error updating animation');
    }
});

// Admin delete animation
app.delete('/admin/delete/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;

    try {
        // Fetch the animation to get the video path
        const animation = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM animations WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (!animation) {
            return res.status(404).json({ error: 'Animation not found' });
        }

        // Delete the animation from the database
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM animations WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                resolve();
            });
        });

        // Delete the associated video file from the videos directory
        if (animation.videoPath && animation.videoPath !== 'videos/default.mp4') {
            await fs.unlink(animation.videoPath).catch(err => console.error(`Error deleting video file: ${err.message}`));
        }

        // Delete narrated videos from DigitalOcean Spaces
        const languages = ['en', 'es'];
        for (const language of languages) {
            const videoKey = `temp_video_${id}_${language}_full.mp4`;
            if (await fileExistsInSpaces(videoKey)) {
                await deleteFromSpaces(videoKey);
            }
        }

        // If the animation is two-sided, delete the mirrored version as well
        if (animation.twoSided) {
            const mirroredName = animation.name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredAnimation = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM animations WHERE name = ?', [mirroredName], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (mirroredAnimation) {
                // Delete the mirrored animation from the database
                await new Promise((resolve, reject) => {
                    db.run('DELETE FROM animations WHERE id = ?', [mirroredAnimation.id], function(err) {
                        if (err) reject(err);
                        resolve();
                    });
                });

                // Delete the mirrored video file
                if (mirroredAnimation.videoPath && mirroredAnimation.videoPath !== 'videos/default.mp4') {
                    await fs.unlink(mirroredAnimation.videoPath).catch(err => console.error(`Error deleting mirrored video file: ${err.message}`));
                }

                // Delete narrated videos for the mirrored animation
                for (const language of languages) {
                    const mirroredVideoKey = `temp_video_${mirroredAnimation.id}_${language}_full.mp4`;
                    if (await fileExistsInSpaces(mirroredVideoKey)) {
                        await deleteFromSpaces(mirroredVideoKey);
                    }
                }
            }
        }

        res.status(200).json({ message: 'Animation deleted successfully' });
    } catch (error) {
        console.error('Error deleting animation:', error);
        res.status(500).json({ error: 'Error deleting animation' });
    }
});

// Embed route for animations
app.get('/embed/:id', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>Animation Player</title>
            <style>
                html {
                    height: 100%;
                    margin: 0;
                }
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 10px;
                    background-color: transparent;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100%;
                    box-sizing: border-box;
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    overflow: hidden;
                }
                .modal-content {
                    background-color: #fff;
                    padding: 10px;
                    padding-bottom: 15px;
                    border-radius: 15px;
                    width: 420px;
                    max-height: 90vh;
                    overflow-y: auto;
                    position: relative;
                    text-align: center;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                }
                .video-container {
                    position: relative;
                    width: 400px;
                    height: 400px;
                    margin: 0 auto;
                    border-radius: 10px;
                }
                .video-container video {
                    width: 400px;
                    height: 400px;
                    border-radius: 10px;
                }
                .loading-spinner {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #3498db;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: translate(-50%, -50%) rotate(0deg); }
                    100% { transform: translate(-50%, -50%) rotate(360deg); }
                }
                .metadata {
                    background-color: #f0f8ff;
                    padding: 20px;
                    border-radius: 10px;
                    margin-top: 0;
                    width: 100%;
                    max-width: 400px;
                    box-sizing: border-box;
                    margin-left: auto;
                    margin-right: auto;
                }
                .metadata h2 {
                    margin-top: 0;
                    font-size: 1.5em;
                    color: #333;
                }
                .metadata p {
                    margin: 10px 0;
                    color: #666;
                }
                .metadata p strong {
                    color: #333;
                }
                .metadata p.reminder {
                    color: #666;
                }
                .language-dropdown {
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    z-index: 1000;
                }
                .language-button {
                    background-color: #D3D3D3;
                    color: white;
                    border: none;
                    padding: 8px 15px;
                    cursor: pointer;
                    font-size: 16px;
                    font-family: Arial, sans-serif;
                    border-radius: 5px;
                }
                .language-button:hover {
                    background-color: #B0B0B0;
                }
                .language-menu {
                    display: none;
                    position: absolute;
                    top: 100%;
                    right: 0;
                    background-color: #D3D3D3;
                    border: none;
                    border-radius: 5px;
                    z-index: 1000;
                    list-style: none;
                    margin: 0;
                    padding: 5px 0;
                    padding-right: 5px;
                    width: 180px;
                    box-sizing: border-box;
                }
                .language-menu.visible {
                    display: block;
                }
                .language-item {
                    color: white;
                    padding: 5px 3px;
                    cursor: pointer;
                    font-family: Arial, sans-serif;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .language-item:first-child {
                    border-top-left-radius: 5px;
                    border-top-right-radius: 5px;
                }
                .language-item:last-child {
                    border-bottom-left-radius: 5px;
                    border-bottom-right-radius: 5px;
                }
                .language-item:hover {
                    background-color: #B0B0B0;
                }
                .language-item.selected {
                    background-color: #B0B0B0;
                }
                /* Mobile adjustments */
                @media (max-width: 600px) {
                    .modal-content {
                        width: 90%;
                        min-width: 300px;
                        max-width: 420px;
                    }
                    .video-container {
                        width: 100%;
                        height: auto;
                        min-height: 300px;
                    }
                    .video-container video {
                        width: 100%;
                        height: auto;
                        min-height: 300px;
                    }
                    .metadata {
                        width: 100%;
                        max-width: 100%;
                    }
                }
            </style>
        </head>
        <body>
            <div class="modal-content">
                <div class="video-container">
                    <video id="animationVideo" controls playsinline webkit-playsinline preload="metadata" style="width: 100%; height: auto;"></video>
                    <div id="loadingSpinner" class="loading-spinner"></div>
                </div>
                <div id="errorMessage" style="display: none; color: red;"></div>
                <div class="metadata" id="animationDetails"></div>
                <div class="language-dropdown">
                    <button class="language-button">Language</button>
                    <ul id="languageMenu" class="language-menu">
                        <li class="language-item selected" data-lang="en">English</li>
                        <li class="language-item" data-lang="es">Spanish</li>
                    </ul>
                </div>
            </div>
            <script>
                const id = window.location.pathname.split('/').pop();
                fetch(\`/api/animation/\${id}\`)
                    .then(response => response.json())
                    .then(data => {
                        const details = document.getElementById('animationDetails');
                        details.innerHTML = \`
                            <h2>\${data.name}</h2>
                            <p><strong>Repetitions:</strong> \${data.setsRepsDuration}</p>
                            <p class="reminder"><strong>Reminder:</strong> \${data.reminder}</p>
                        \`;

                        const video = document.getElementById('animationVideo');
                        const languageMenu = document.getElementById('languageMenu');
                        const loadingSpinner = document.getElementById('loadingSpinner');
                        const errorMessage = document.getElementById('errorMessage');

                        const loadVideo = (lang) => {
                            video.style.display = 'none';
                            loadingSpinner.style.display = 'block';
                            errorMessage.style.display = 'none';

                            fetch(\`/api/narration/\${id}/\${lang}/full\`)
                                .then(response => response.json())
                                .then(data => {
                                    video.src = data.videoUrl;
                                    video.style.display = 'block';
                                    loadingSpinner.style.display = 'none';
                                    // Force the browser to render the first frame
                                    video.addEventListener('loadedmetadata', () => {
                                        video.currentTime = 0.1; // Seek to 0.1 seconds to force rendering
                                    }, { once: true });
                                })
                                .catch(err => {
                                    errorMessage.textContent = 'Error loading video: The narrated video for this language is not available. Please try another language or contact support.';
                                    errorMessage.style.display = 'block';
                                    loadingSpinner.style.display = 'none';
                                });
                        };

                        const languageItems = languageMenu.querySelectorAll('.language-item');
                        languageItems.forEach(item => {
                            item.onclick = () => {
                                const lang = item.getAttribute('data-lang');
                                languageItems.forEach(i => i.classList.remove('selected'));
                                item.classList.add('selected');
                                loadVideo(lang);
                                languageMenu.classList.remove('visible');
                            };
                        });

                        document.querySelector('.language-button').onclick = () => {
                            languageMenu.classList.toggle('visible');
                        };

                        loadVideo('en');
                    })
                    .catch(err => {
                        console.error('Error fetching animation data:', err);
                        document.getElementById('errorMessage').textContent = 'Error loading animation data: ' + err.message;
                        document.getElementById('errorMessage').style.display = 'block';
                        document.getElementById('loadingSpinner').style.display = 'none';
                    });
            </script>
        </body>
        </html>
    `);
});

// Landing page route for TKA recovery exercises
app.get('/tka-recovery', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="description" content="3D-guided exercises for Total Knee Replacement (TKA) recovery, designed to help patients regain strength and mobility.">
            <meta property="og:title" content="3D-Guided TKA Recovery Exercises">
            <meta property="og:description" content="Explore 3D-guided exercises for Total Knee Replacement (TKA) recovery, designed to help patients regain strength and mobility.">
            <meta property="og:type" content="website">
            <title>3D-Guided TKA Recovery Exercises</title>
            <style>
                /* Reset default styles */
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }

                body {
                    font-family: 'Roboto', sans-serif;
                    background-color: #FFFFFF; /* Brighter white background */
                    color: #333333;
                    line-height: 1.6;
                }

                /* Header Styling */
                header {
                    position: relative;
                    text-align: center;
                    padding: 50px 20px;
                    background-color: #FFFFFF;
                    border-bottom: 1px solid #E0E0E0;
                }

                header h1 {
                    font-size: 36px;
                    font-weight: 700;
                    color: #003087;
                }

                .logo-placeholder {
                    position: absolute;
                    top: 20px;
                    left: 20px;
                    width: 150px;
                    height: 50px;
                    background-color: #E0E0E0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                    color: #666666;
                    border-radius: 5px;
                }

                /* Animation Section Styling */
                .animation-section {
                    padding: 40px 20px 80px 20px; /* Reduced top padding */
                    text-align: center;
                }

                .animation-section h2 {
                    font-size: 24px;
                    font-weight: 600;
                    color: #003087;
                    margin-bottom: 20px;
                }

                .animation-container {
                    max-width: 600px;
                    margin: 0 auto 50px auto; /* Reduced bottom margin */
                    background-color: #E6F0FA; /* Light blue background for medical feel */
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
                }

                .animation-container iframe {
                    width: 420px;
                    height: 510px;
                    border: 1px solid #E0E0E0;
                    border-radius: 5px;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                }

                .caption {
                    font-size: 14px;
                    color: #555555; /* Slightly darker for better contrast */
                    margin-top: 10px;
                }

                /* Contact Button Styling */
                .contact-section {
                    text-align: center;
                    padding: 50px 20px;
                }

                .contact-button {
                    display: inline-block;
                    padding: 15px 40px;
                    background-color: #00C4B4;
                    color: #FFFFFF;
                    text-decoration: none;
                    font-size: 18px;
                    font-weight: 600;
                    border-radius: 25px;
                    transition: transform 0.2s, background-color 0.2s;
                }

                .contact-button:hover {
                    transform: scale(1.05);
                    background-color: #00A89A;
                }

                /* Responsive Design */
                @media (max-width: 768px) {
                    header h1 {
                        font-size: 28px;
                    }

                    .animation-section h2 {
                        font-size: 20px;
                    }

                    .animation-container iframe {
                        width: 100%;
                        height: 400px;
                    }

                    .contact-button {
                        padding: 12px 30px;
                        font-size: 16px;
                    }

                    .logo-placeholder {
                        width: 120px;
                        height: 40px;
                        font-size: 12px;
                    }
                }
            </style>
        </head>
        <body>
            <!-- Header -->
            <header>
                <div class="logo-placeholder">Your Logo Here</div>
                <h1>3D-Guided Total Knee Replacement (TKA) Recovery Exercises</h1>
            </header>

            <!-- Animation Sections -->
            <div class="animation-section">
                <div class="animation-container">
                    <h2>Week 1: Foundational Exercises</h2>
                    <iframe src="/embed/1" title="Week 1 TKA Recovery Exercise" frameborder="0" allowfullscreen></iframe>
                    <p class="caption">Heel Slides – 10–15 reps, 5 sec hold</p>
                </div>

                <div class="animation-container">
                    <h2>Week 2: Stability Building</h2>
                    <iframe src="/embed/1" title="Week 2 TKA Recovery Exercise" frameborder="0" allowfullscreen></iframe>
                    <p class="caption">Straight Leg Raise Prep – 10 reps, 2–3 sec hold</p>
                </div>

                <div class="animation-container">
                    <h2>Week 3: Strength Development</h2>
                    <iframe src="/embed/1" title="Week 3 TKA Recovery Exercise" frameborder="0" allowfullscreen></iframe>
                    <p class="caption">Side-Lying Straight Leg Raise – 10–12 reps, 2–5 sec hold</p>
                </div>
            </div>

            <!-- Contact Button -->
            <div class="contact-section">
                <a href="mailto:your-email@example.com" class="contact-button" aria-label="Contact us to bring TKA recovery exercises to your patients">Bring This to Your Patients – Contact Us</a>
            </div>
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
            const videoDuration = animation.originalDuration || 38;
            await adjustNarrationDuration(narrationPath, adjustedNarrationPath, videoDuration);
            await combineVideoAndAudio(originalVideoPath, adjustedNarrationPath, combinedOutputPath, videoDuration);
            await uploadToSpaces(combinedOutputPath, videoKey);
            console.log(`Generated video: ${videoKey}`);
        }

        const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${videoKey}`;
        console.log(`Serving video URL: ${videoUrl}`);
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