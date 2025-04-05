// Update database schema to add language-specific video paths
const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

// Load environment variables
require('dotenv').config();

const dbConfig = parse(process.env.DATABASE_URL);
dbConfig.ssl = { 
  rejectUnauthorized: false,
  ca: process.env.DATABASE_CA
};
const pool = new Pool(dbConfig);

// Add language-specific video fields
const updateTableSQL = `
DO $$
BEGIN
    BEGIN
        ALTER TABLE animations ADD COLUMN englishvideopath TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'Column englishvideopath already exists';
    END;
    
    BEGIN
        ALTER TABLE animations ADD COLUMN englishvideourl TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'Column englishvideourl already exists';
    END;
    
    BEGIN
        ALTER TABLE animations ADD COLUMN spanishvideopath TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'Column spanishvideopath already exists';
    END;
    
    BEGIN
        ALTER TABLE animations ADD COLUMN spanishvideourl TEXT;
    EXCEPTION
        WHEN duplicate_column THEN RAISE NOTICE 'Column spanishvideourl already exists';
    END;
END
$$;
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