// Update database schema to add language-specific video paths
const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

// Load environment variables
require('dotenv').config();

const dbConfig = parse(process.env.DATABASE_URL);
dbConfig.ssl = { rejectUnauthorized: false };
const pool = new Pool(dbConfig);

// Add language-specific video fields
const updateTableSQL = `
ALTER TABLE animations 
ADD COLUMN IF NOT EXISTS englishVideoPath TEXT,
ADD COLUMN IF NOT EXISTS englishVideoUrl TEXT,
ADD COLUMN IF NOT EXISTS spanishVideoPath TEXT,
ADD COLUMN IF NOT EXISTS spanishVideoUrl TEXT;
`;

async function updateDatabase() {
    try {
        // Add new columns
        await pool.query(updateTableSQL);
        console.log('Database schema updated with language-specific video fields');
        return true;
    } catch (err) {
        console.error('Error updating database schema:', err);
        return false;
    } finally {
        await pool.end();
    }
}

// Execute when run directly
if (require.main === module) {
    updateDatabase().then(() => {
        console.log('Database update completed');
        process.exit(0);
    }).catch(err => {
        console.error('Database update failed:', err);
        process.exit(1);
    });
}

module.exports = updateDatabase;