const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const port = process.env.PORT || 3000;
const host = '0.0.0.0'; // Explicitly bind to all interfaces

// Use the ELEVENLABS_API_KEY environment variable
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/videos', express.static(path.join(__dirname, 'videos')));
app.use('/temp', express.static(path.join(__dirname, 'temp')));

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

// Initialize the database if it doesn't exist
const initializeDatabase = () => {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS animations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                repetitions TEXT,
                reminder TEXT,
                voiceoverText TEXT
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
                    INSERT INTO animations (title, repetitions, reminder, voiceoverText)
                    VALUES (?, ?, ?, ?)
                `, [
                    'Foam Roller Front of Thighs Left',
                    'Roll for 30 seconds to 1 minute.',
                    'Keep your rolling speed slow and controlled.',
                    'Start, by lying face down, with your forearms and elbows, on the floor. The roller is positioned, at mid thigh level. Keeping your legs relaxed, and your knees comfortably straight, distribute your weight slightly more, to your left thigh, while still keeping your hips level. This will put the majority of the pressure, into your left thigh. From this position, roll from just above your knee, to just below your hip, and back and forth slowly. Continue keeping your legs relaxed, your back flat, and your vision on the floor, to maintain your neck and back alignment, throughout the movement.'
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

// Health check endpoint for Render
app.get('/health', (req, res) => {
    console.log('Received request for /health endpoint');
    res.status(200).json({ status: 'OK' });
});

// Root route to handle HEAD and GET requests
app.get('/', (req, res) => {
    console.log('Received request for / endpoint');
    res.json({ message: 'Server is running' });
});

// Test endpoint to confirm the server is handling requests
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

        const videoPath = path.join(__dirname, `videos/video_${id}.mp4`);
        const outputPath = path.join(__dirname, `temp/temp_video_${id}_${language}_full.mp4`);
        await combineVideoAndAudio(videoPath, narrationPath, outputPath);

        console.log(`Successfully created ${outputPath}`);

        res.json({ videoUrl: `/temp/temp_video_${id}_${language}_full.mp4` });
    } catch (error) {
        console.error('Error processing narration:', error);
        res.status(500).json({ error: error.message });
    }
});

// Catch-all route to log and respond to all unmatched requests
app.use('*', (req, res) => {
    console.log(`Unmatched request: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
});

// Start the server with explicit host and port binding
const server = app.listen(port, host, async () => {
    console.log(`Server running on port ${port}`);
    console.log(`Server address: ${server.address().address}:${server.address().port}`);
    await ensureDirectories();
    initializeDatabase();
});