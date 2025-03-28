const express = require('express');
const { Pool } = require('pg');
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

// PostgreSQL Database Setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Helper function to upload a file to Spaces
async function uploadToSpaces(filePath, key) {
    try {
        const fileContent = await fs.readFile(filePath);
        console.log(`Uploading file ${filePath} to Spaces with key ${key}`);
        const uploadResult = await s3.upload({
            Bucket: process.env.SPACES_BUCKET,
            Key: key,
            Body: fileContent,
            ACL: 'public-read',
            ContentType: 'video/mp4'
        }).promise();
        console.log(`Successfully uploaded to Spaces: ${uploadResult.Location}`);
        const videoUrl = `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_ENDPOINT}/${key}`;
        console.log(`Verifying public accessibility of ${videoUrl}`);
        const response = await fetch(videoUrl, { method: 'HEAD' });
        if (!response.ok) {
            console.error(`File is not publicly accessible: ${videoUrl} (Status: ${response.status})`);
            throw new Error(`File is not publicly accessible: ${videoUrl}`);
        }
        return videoUrl;
    } catch (err) {
        console.error(`Error uploading to Spaces: ${err.message}`);
        throw err;
    }
}

// Helper function to check if a file exists in Spaces
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
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
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

        const targetSpokenDuration = videoDuration - 2;
        const spokenDurationWithDelay = targetSpokenDuration - 1;
        let paddingDuration = (spokenDurationWithDelay - audioDuration);
        console.log(`Target spoken duration (including 1-second delay): ${targetSpokenDuration} seconds`);
        console.log(`Initial padding duration for spoken content: ${paddingDuration} seconds`);

        let audioFilters = ['adelay=1000|1000'];
        if (paddingDuration < 0) {
            console.warn(`Audio duration (${audioDuration}) is longer than target (${spokenDurationWithDelay}), trimming to fit`);
            audioFilters.push(`atrim=end=${spokenDurationWithDelay}`);
            paddingDuration = 0;
        } else if (paddingDuration > 0) {
            audioFilters.push(`apad=pad_dur=${paddingDuration}`);
        }

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .audioFilters(audioFilters)
                .output(outputPath)
                .on('end', async () => {
                    console.log(`Adjusted narration to target duration ${targetSpokenDuration} seconds (including 1-second delay): ${outputPath}`);
                    try {
                        const adjustedDuration = await getAudioDuration(outputPath);
                        console.log(`Adjusted narration duration: ${adjustedDuration} seconds`);
                        if (Math.abs(adjustedDuration - targetSpokenDuration) > 1.0) {
                            console.warn(`Adjusted narration duration (${adjustedDuration}) does not match target (${targetSpokenDuration}), but proceeding anyway`);
                        }
                        resolve(outputPath);
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
        throw error;
    }
}

// Helper function to fetch narration from ElevenLabs
async function fetchNarration(text, language) {
    console.log(`Calling ElevenLabs API with text: ${text}, language: ${language}`);
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key is not set in environment variables');
    }
    const voiceId = language === 'es' ? 'pNInz6obpgDQGcFmaJgB' : 'TX3LPaxmHKxFdv7VOQHJ';
    const modelId = language === 'es' ? 'eleven_multilingual_v2' : 'eleven_monolingual_v1';
    try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
                text: text,
                model_id: modelId,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5,
                    speed: language === 'es' ? 1.3 : 1.0,
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
async function combineVideoAndAudio(videoPath, audioPath, outputPath, videoDuration) {
    try {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions('-c:v libx264')
                .outputOptions('-preset fast')
                .outputOptions('-c:a aac')
                .outputOptions('-map 0:v:0')
                .outputOptions('-map 1:a:0')
                .outputOptions('-movflags +faststart')
                .output(outputPath)
                .on('end', async () => {
                    console.log(`FFmpeg combine completed: ${outputPath}`);
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

// Background task to generate narrated videos
async function generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration) {
    try {
        const languages = ['en', 'es'];
        for (const language of languages) {
            console.log(`Generating video for animation ${animationId} in language ${language}`);
            const videoKey = `temp_video_${animationId}_${language}_full.mp4`;
            const videoExists = await fileExistsInSpaces(videoKey);
            if (videoExists) {
                console.log(`Video already exists for animation ${animationId} in language ${language}: ${videoKey}, skipping generation.`);
                continue;
            }

            let narrationPath, adjustedNarrationPath, combinedOutputPath;
            try {
                const translatedText = await translateText(voiceoverText, language);
                narrationPath = await fetchNarration(translatedText, language);
                adjustedNarrationPath = path.join(__dirname, `narration_adjusted_${language}.mp3`);
                await adjustNarrationDuration(narrationPath, adjustedNarrationPath, originalDuration);
                combinedOutputPath = path.join(__dirname, `combined_${animationId}_${language}.mp4`);
                await combineVideoAndAudio(videoPath, adjustedNarrationPath, combinedOutputPath, originalDuration);
                await uploadToSpaces(combinedOutputPath, videoKey);
                console.log(`Successfully generated and uploaded video for animation ${animationId} in language ${language}: ${videoKey}`);
            } finally {
                if (narrationPath) await fs.unlink(narrationPath).catch(err => console.error(`Error deleting narration file: ${err.message}`));
                if (adjustedNarrationPath) await fs.unlink(adjustedNarrationPath).catch(err => console.error(`Error deleting adjusted narration file: ${err.message}`));
                if (combinedOutputPath) await fs.unlink(combinedOutputPath).catch(err => console.error(`Error deleting combined file: ${err.message}`));
            }
        }
    } catch (error) {
        console.error(`Error generating narrated videos for animation ${animationId}: ${error.message}`);
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
app.get('/admin/list', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM animations');
        res.json({ animations: result.rows });
    } catch (err) {
        console.error('Error fetching animations:', err.message);
        res.status(500).json({ error: err.message });
    }
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

        const result = await pool.query(
            `INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided === 'on', originalDuration]
        );
        const originalId = result.rows[0].id;
        console.log(`Successfully inserted animation ${name} with ID ${originalId}`);

        // Handle two-sided animation
        if (twoSided === 'on') {
            console.log(`Animation ${name} is two-sided, generating mirrored version`);
            const mirroredName = name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredVoiceoverText = voiceoverText.replace(/left/i, 'right').replace(/right/i, 'left');
            const mirroredVideoPath = videoPath.replace('.mp4', '_mirrored.mp4');
            await flipVideo(videoPath, mirroredVideoPath);
            console.log(`Mirrored video generated at ${mirroredVideoPath}`);

            const mirroredResult = await pool.query(
                `INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, true, originalDuration]
            );
            const mirroredId = mirroredResult.rows[0].id;
            console.log(`Successfully inserted mirrored animation ${mirroredName} with ID ${mirroredId}`);

            // Generate narrated videos for mirrored animation in the background
            generateNarratedVideos(mirroredId, mirroredVideoPath, mirroredVoiceoverText, originalDuration);
        }

        // Generate narrated videos for original animation in the background
        generateNarratedVideos(originalId, videoPath, voiceoverText, originalDuration);

        console.log(`Successfully added animation ${name}`);
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error(`Error adding animation ${name}: ${error.message}`);
        res.status(500).send(`Error adding animation: ${error.message}`);
    }
});

// Admin update animation
app.post('/admin/update/:id', isAuthenticated, upload.single('video'), async (req, res) => {
    const { id } = req.params;
    const { name, voiceoverText, setsRepsDuration, reminder, twoSided } = req.body;
    const videoPath = req.file ? req.file.path : null;

    try {
        console.log(`Starting update for animation ID ${id}`);
        const animationResult = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
        const animation = animationResult.rows[0];
        if (!animation) {
            return res.status(404).send('Animation not found');
        }

        const originalDuration = videoPath ? await getVideoDuration(videoPath) : animation.originalDuration;

        await pool.query(
            videoPath
                ? `UPDATE animations SET name = $1, videoPath = $2, voiceoverText = $3, setsRepsDuration = $4, reminder = $5, twoSided = $6, originalDuration = $7 WHERE id = $8`
                : `UPDATE animations SET name = $1, voiceoverText = $2, setsRepsDuration = $3, reminder = $4, twoSided = $5 WHERE id = $6`,
            videoPath
                ? [name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided === 'on', originalDuration, id]
                : [name, voiceoverText, setsRepsDuration, reminder, twoSided === 'on', id]
        );
        console.log(`Successfully updated animation ${id}`);

        const languages = ['en', 'es'];
        for (const language of languages) {
            const videoKey = `temp_video_${id}_${language}_full.mp4`;
            if (await fileExistsInSpaces(videoKey)) {
                await deleteFromSpaces(videoKey);
                console.log(`Deleted existing video for animation ${id} in language ${language}: ${videoKey}`);
            }
        }

        if (twoSided === 'on') {
            console.log(`Animation ${name} is two-sided, updating mirrored version`);
            const mirroredName = name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredVoiceoverText = voiceoverText.replace(/left/i, 'right').replace(/right/i, 'left');
            const mirroredVideoPath = videoPath ? videoPath.replace('.mp4', '_mirrored.mp4') : animation.videoPath.replace('.mp4', '_mirrored.mp4');

            if (videoPath) {
                await flipVideo(videoPath, mirroredVideoPath);
                console.log(`Mirrored video updated at ${mirroredVideoPath}`);
            }

            const mirroredResult = await pool.query('SELECT * FROM animations WHERE name = $1', [mirroredName]);
            const mirroredAnimation = mirroredResult.rows[0];

            if (mirroredAnimation) {
                await pool.query(
                    videoPath
                        ? `UPDATE animations SET name = $1, videoPath = $2, voiceoverText = $3, setsRepsDuration = $4, reminder = $5, twoSided = $6, originalDuration = $7 WHERE id = $8`
                        : `UPDATE animations SET name = $1, voiceoverText = $2, setsRepsDuration = $3, reminder = $4, twoSided = $5 WHERE id = $6`,
                    videoPath
                        ? [mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, true, originalDuration, mirroredAnimation.id]
                        : [mirroredName, mirroredVoiceoverText, setsRepsDuration, reminder, true, mirroredAnimation.id]
                );
                console.log(`Successfully updated mirrored animation ${mirroredAnimation.id}`);

                for (const language of languages) {
                    const videoKey = `temp_video_${mirroredAnimation.id}_${language}_full.mp4`;
                    if (await fileExistsInSpaces(videoKey)) {
                        await deleteFromSpaces(videoKey);
                        console.log(`Deleted existing video for mirrored animation ${mirroredAnimation.id} in language ${language}: ${videoKey}`);
                    }
                }

                generateNarratedVideos(mirroredAnimation.id, mirroredVideoPath, mirroredVoiceoverText, originalDuration);
            } else {
                const mirroredResult = await pool.query(
                    `INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [mirroredName, mirroredVideoPath, mirroredVoiceoverText, setsRepsDuration, reminder, true, originalDuration]
                );
                const mirroredId = mirroredResult.rows[0].id;
                console.log(`Successfully inserted mirrored animation ${mirroredName} with ID ${mirroredId}`);
                generateNarratedVideos(mirroredId, mirroredVideoPath, mirroredVoiceoverText, originalDuration);
            }
        }

        generateNarratedVideos(id, videoPath || animation.videoPath, voiceoverText, originalDuration);

        console.log(`Successfully updated animation ${id}`);
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error(`Error updating animation ${id}: ${error.message}`);
        res.status(500).send(`Error updating animation: ${error.message}`);
    }
});

// Admin delete animation
app.delete('/admin/delete/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;

    try {
        const animationResult = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
        const animation = animationResult.rows[0];
        if (!animation) {
            return res.status(404).json({ error: 'Animation not found' });
        }

        await pool.query('DELETE FROM animations WHERE id = $1', [id]);

        if (animation.videoPath && animation.videoPath !== 'videos/default.mp4') {
            await fs.unlink(animation.videoPath).catch(err => console.error(`Error deleting video file: ${err.message}`));
        }

        const languages = ['en', 'es'];
        for (const language of languages) {
            const videoKey = `temp_video_${id}_${language}_full.mp4`;
            if (await fileExistsInSpaces(videoKey)) {
                await deleteFromSpaces(videoKey);
            }
        }

        if (animation.twoSided) {
            const mirroredName = animation.name.replace(/Left/i, 'Right').replace(/Right/i, 'Left');
            const mirroredResult = await pool.query('SELECT * FROM animations WHERE name = $1', [mirroredName]);
            const mirroredAnimation = mirroredResult.rows[0];

            if (mirroredAnimation) {
                await pool.query('DELETE FROM animations WHERE id = $1', [mirroredAnimation.id]);

                if (mirroredAnimation.videoPath && mirroredAnimation.videoPath !== 'videos/default.mp4') {
                    await fs.unlink(mirroredAnimation.videoPath).catch(err => console.error(`Error deleting mirrored video file: ${err.message}`));
                }

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
    const { id } = req.params;
    if (!id || id === 'undefined') {
        console.error(`Invalid ID provided for embed route: ${id}`);
        return res.status(400).send('Invalid animation ID');
    }

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
                    background-color: #000;
                }
                .video-container video {
                    width: 400px;
                    height: 400px;
                    border-radius: 10px;
                    opacity: 0;
                    transition: opacity 0.5s ease;
                }
                .video-container video.loaded {
                    opacity: 1;
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
                    opacity: 1;
                    transition: opacity 0.3s ease;
                }
                .loading-spinner.hidden {
                    opacity: 0;
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
                    <video id="animationVideo" playsinline webkit-playsinline preload="metadata" crossOrigin="anonymous" style="width: 100%; height: auto;"></video>
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
                if (!id || id === 'undefined') {
                    console.error('Invalid animation ID provided');
                    document.getElementById('errorMessage').textContent = 'Invalid animation ID';
                    document.getElementById('errorMessage').style.display = 'block';
                    document.getElementById('loadingSpinner').style.display = 'none';
                    throw new Error('Invalid animation ID');
                }

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

                        video.addEventListener('error', (e) => {
                            console.error('Video playback error:', e);
                            errorMessage.textContent = 'Error playing video: The video failed to load or play. Please try another language or contact support.';
                            errorMessage.style.display = 'block';
                            loadingSpinner.classList.add('hidden');
                        });

                        const loadVideo = (lang) => {
                            video.pause();
                            video.src = '';
                            video.style.opacity = '0';
                            video.removeAttribute('controls');
                            loadingSpinner.classList.remove('hidden');
                            errorMessage.style.display = 'none';

                            fetch(\`/api/narration/\${id}/\${lang}/full\`)
                                .then(response => response.json())
                                .then(data => {
                                    video.src = data.videoUrl;
                                    video.classList.add('loaded');
                                    video.setAttribute('controls', '');
                                    loadingSpinner.classList.add('hidden');
                                    video.addEventListener('loadedmetadata', () => {
                                        video.currentTime = 0.1;
                                        video.play().catch(err => {
                                            console.error('Video play error:', err);
                                            errorMessage.textContent = 'Error playing video: Autoplay may be blocked. Please click the play button to start.';
                                            errorMessage.style.display = 'block';
                                        });
                                    }, { once: true });
                                })
                                .catch(err => {
                                    console.error('Error fetching video:', err);
                                    errorMessage.textContent = 'Error loading video: The narrated video for this language is not available. Please try another language or contact support.';
                                    errorMessage.style.display = 'block';
                                    loadingSpinner.classList.add('hidden');
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
app.get('/tka-recovery', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM animations LIMIT 3');
        const animations = result.rows;

        const animation1 = animations[0] || { id: 0 };
        const animation2 = animations[1] || { id: 0 };
        const animation3 = animations[2] || { id: 0 };

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
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    body {
                        font-family: 'Roboto', sans-serif;
                        background-color: #FFFFFF;
                        color: #333333;
                        line-height: 1.6;
                    }
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
                    .animation-section {
                        padding: 40px 20px 80px 20px;
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
                        margin: 0 auto 50px auto;
                        background-color: #E6F0FA;
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
                        color: #555555;
                        margin-top: 10px;
                    }
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
                <header>
                    <div class="logo-placeholder">Your Logo Here</div>
                    <h1>3D-Guided Total Knee Replacement (TKA) Recovery Exercises</h1>
                </header>
                <div class="animation-section">
                    <div class="animation-container">
                        <h2>Week 1: Foundational Exercises</h2>
                        <iframe src="/embed/${animation1.id}" title="Week 1 TKA Recovery Exercise" frameborder="0" allowfullscreen></iframe>
                        <p class="caption">Heel Slides – 10–15 reps, 5 sec hold</p>
                    </div>
                    <div class="animation-container">
                        <h2>Week 2: Stability Building</h2>
                        <iframe src="/embed/${animation2.id}" title="Week 2 TKA Recovery Exercise" frameborder="0" allowfullscreen></iframe>
                        <p class="caption">Straight Leg Raise Prep – 10 reps, 2–3 sec hold</p>
                    </div>
                    <div class="animation-container">
                        <h2>Week 3: Strength Development</h2>
                        <iframe src="/embed/${animation3.id}" title="Week 3 TKA Recovery Exercise" frameborder="0" allowfullscreen></iframe>
                        <p class="caption">Side-Lying Straight Leg Raise – 10–12 reps, 2–5 sec hold</p>
                    </div>
                </div>
                <div class="contact-section">
                    <a href="mailto:your-email@example.com" class="contact-button" aria-label="Contact us to bring TKA recovery exercises to your patients">Bring This to Your Patients – Contact Us</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error rendering /tka-recovery:', error.message);
        res.status(500).send('Error loading TKA recovery page');
    }
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
    try {
        const result = await pool.query('SELECT * FROM animations WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            console.log(`Animation with ID ${id} not found`);
            return res.status(404).json({ error: 'Animation not found' });
        }
        console.log(`Found animation with ID ${id}:`, result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching animation:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// API to serve narrated videos from Spaces
app.get('/api/narration/:id/:language/full', async (req, res) => {
    const { id, language } = req.params;

    if (!['en', 'es'].includes(language)) {
        return res.status(400).json({ error: 'Unsupported language' });
    }

    try {
        console.log(`Received request for /api/narration/${id}/${language}/full`);

        const videoKey = `temp_video_${id}_${language}_full.mp4`;
        const videoExists = await fileExistsInSpaces(videoKey);

        if (!videoExists) {
            return res.status(404).json({ error: 'Video not yet generated. Please try again later.' });
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
});