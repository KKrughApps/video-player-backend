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

// Sample animation for initial database - this won't be used unless database is empty
const animation = {
    name: 'Sample Exercise',
    setsRepsDuration: 'Perform 3 sets of 10 repetitions.',
    reminder: 'Maintain proper form throughout the exercise.',
    voiceoverText: 'This is a sample exercise. Please upload your own exercise videos to begin.',
    videoPath: 'placeholder.mp4', // Placeholder path - should not violate NOT NULL constraint
    twoSided: false,
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

        try {
            // Insert sample animation
            const result = await pool.query(
                `INSERT INTO animations (name, videoPath, voiceoverText, setsRepsDuration, reminder, twoSided, originalDuration)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [animation.name, animation.videoPath, animation.voiceoverText, animation.setsRepsDuration, animation.reminder, animation.twoSided, animation.originalDuration]
            );
            const originalId = result.rows[0].id;

            // No need to create a flipped version for the sample
            console.log('Sample animation inserted successfully:', { id: originalId });
        } catch (insertError) {
            console.error('Warning: Error inserting sample animation, but continuing:', insertError.message);
            // Continue without failing - the database is still usable without the sample
        }
        
        return true;
    } catch (err) {
        console.error('Error initializing database:', err);
        // Don't throw the error - let the application continue
        return false;
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