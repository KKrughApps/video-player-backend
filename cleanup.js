// Cleanup script to remove the sample animation
const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

// Create database connection
async function connectToDatabase() {
    let dbConfig;
    if (process.env.DATABASE_URL) {
        dbConfig = parse(process.env.DATABASE_URL);
        dbConfig.ssl = { rejectUnauthorized: false };
    } else {
        dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            database: process.env.DB_NAME || 'video_player',
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
        };
    }
    
    return new Pool(dbConfig);
}

// Remove the sample animation
async function cleanupSampleAnimation() {
    const pool = await connectToDatabase();
    
    try {
        console.log('Identifying sample animations...');
        
        // Find animations with 'Sample Exercise' in the name or with placeholder.mp4 path
        const result = await pool.query(`
            SELECT id, name, videopath FROM animations 
            WHERE name = 'Sample Exercise' 
            OR videopath = 'placeholder.mp4'
            OR videopath IS NULL
        `);
        
        console.log(`Found ${result.rows.length} sample animation(s) to clean up:`);
        
        for (const row of result.rows) {
            console.log(`- ID: ${row.id}, Name: ${row.name}, Video: ${row.videopath || 'None'}`);
        }
        
        if (result.rows.length > 0) {
            // Delete the identified animations
            const ids = result.rows.map(row => row.id);
            
            // Delete animations
            const deleteResult = await pool.query(`
                DELETE FROM animations WHERE id = ANY($1)
            `, [ids]);
            
            console.log(`Deleted ${deleteResult.rowCount} sample animation(s).`);
        } else {
            console.log('No sample animations found.');
        }
        
        // Update schema to allow NULL videoPath
        console.log('Updating schema to allow NULL videoPath...');
        
        await pool.query(`
            ALTER TABLE animations ALTER COLUMN videoPath DROP NOT NULL;
        `);
        
        console.log('Schema updated successfully.');
        
        return 'Cleanup completed successfully';
    } catch (error) {
        console.error('Error cleaning up sample animations:', error);
        throw error;
    } finally {
        // Close the database connection
        await pool.end();
    }
}

// Run the cleanup if directly executed
if (require.main === module) {
    // Add a small delay to ensure environment variables are loaded
    setTimeout(() => {
        cleanupSampleAnimation()
            .then(message => {
                console.log(message);
                process.exit(0);
            })
            .catch(error => {
                console.error('Cleanup failed:', error);
                process.exit(1);
            });
    }, 100);
}

module.exports = cleanupSampleAnimation;