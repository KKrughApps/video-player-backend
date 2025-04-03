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
    videoPath TEXT NOT NULL,
    voiceoverText TEXT,
    setsRepsDuration TEXT,
    reminder TEXT,
    twoSided BOOLEAN DEFAULT FALSE,
    originalDuration REAL,
    paired_animation_id INTEGER
);`;

// No default animations - database will start empty

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

        // Removed sample animation insertion to start with a clean database
        
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