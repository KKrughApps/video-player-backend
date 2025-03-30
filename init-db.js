const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

const dbConfig = parse(process.env.DATABASE_URL);
dbConfig.ssl = { rejectUnauthorized: false };
const pool = new Pool(dbConfig);

// Create animations table if it doesn't exist
const createTableSQL = `
CREATE TABLE IF NOT EXISTS animations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    videoPath TEXT,
    voiceoverText TEXT,
    setsRepsDuration TEXT,
    reminder TEXT,
    twoSided BOOLEAN DEFAULT FALSE,
    originalDuration REAL,
    paired_animation_id INTEGER
);`;

// Sample animation for initial database
const animation = {
    name: 'Foam Roller Front of Thighs Left',
    setsRepsDuration: 'Roll for 30 seconds to 1 minute.',
    reminder: 'Keep your rolling speed slow and controlled.',
    voiceoverText: 'Start, by lying face down, with your forearms and elbows, on the floor. The roller is positioned, at mid thigh level. Keeping your legs relaxed, and your knees comfortably straight, distribute your weight slightly more, to your left thigh, while still keeping your hips level. This will put the majority of the pressure, into your left thigh. From this position, roll from just above your knee, to just below your hip, and back and forth slowly. Continue keeping your legs relaxed, your back flat, and your vision on the floor, to maintain your neck and back alignment, throughout the movement.',
    videoPath: 'videos/default.mp4',
    twoSided: true,
    originalDuration: 30.0
};

async function initializeDatabase() {
    try {
        // Create the table
        await pool.query(createTableSQL);
        console.log('Animations table created or verified');

        // Check if we have any existing animations
        const existingResult = await pool.query('SELECT COUNT(*) FROM animations');
        if (parseInt(existingResult.rows[0].count) > 0) {
            console.log('Database already has animations, skipping sample insertion');
            return;
        }

        // Insert sample animation
        const result = await pool.query(
            `INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [animation.name, animation.videoPath, animation.voiceoverText, animation.setsRepsDuration, animation.reminder, animation.twoSided, animation.originalDuration]
        );
        const originalId = result.rows[0].id;

        // If two-sided, create the opposite side
        if (animation.twoSided) {
            const flippedName = animation.name.replace(/left/i, 'right').replace(/Left/i, 'Right');
            const flippedVoiceoverText = animation.voiceoverText
                .replace(/left/ig, 'RIGHT_TEMP')
                .replace(/right/ig, 'left')
                .replace(/RIGHT_TEMP/g, 'right')
                .replace(/Left/ig, 'RIGHT_TEMP')
                .replace(/Right/ig, 'Left')
                .replace(/RIGHT_TEMP/g, 'Right');

            const flippedResult = await pool.query(
                `INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration, paired_animation_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
                [flippedName, animation.videoPath, flippedVoiceoverText, animation.setsRepsDuration, animation.reminder, animation.twoSided, animation.originalDuration, originalId]
            );
            const flippedId = flippedResult.rows[0].id;

            // Update the original to reference the flipped version
            await pool.query('UPDATE animations SET paired_animation_id = $1 WHERE id = $2', [flippedId, originalId]);

            console.log('Animations inserted successfully:', { originalId, flippedId });
        } else {
            console.log('Animation inserted successfully:', { id: originalId });
        }
    } catch (err) {
        console.error('Error initializing database:', err);
    } finally {
        // Don't close the pool as it might be used by the app
    }
}

// Export the function to be called from server.js
module.exports = initializeDatabase;

// If script is run directly, execute and exit
if (require.main === module) {
    initializeDatabase().then(() => {
        console.log('Database initialization complete');
        process.exit(0);
    }).catch(err => {
        console.error('Database initialization failed:', err);
        process.exit(1);
    });
}