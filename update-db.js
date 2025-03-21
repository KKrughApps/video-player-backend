const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'animations.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database.');
});

db.serialize(() => {
    // Add new columns if they don't exist
    db.run(`
        ALTER TABLE animations ADD COLUMN setsRepsDuration TEXT
    `, (err) => {
        if (err) {
            console.log('setsRepsDuration column already exists or error:', err.message);
        } else {
            console.log('Added setsRepsDuration column.');
        }
    });

    db.run(`
        ALTER TABLE animations ADD COLUMN reminder TEXT
    `, (err) => {
        if (err) {
            console.log('reminder column already exists or error:', err.message);
        } else {
            console.log('Added reminder column.');
        }
    });

    db.run(`
        ALTER TABLE animations ADD COLUMN twoSided INTEGER DEFAULT 0
    `, (err) => {
        if (err) {
            console.log('twoSided column already exists or error:', err.message);
        } else {
            console.log('Added twoSided column.');
        }
    });

    // Update existing records with default values if needed
    db.run(`
        UPDATE animations
        SET setsRepsDuration = 'Roll for 30 seconds to 1 minute.',
            reminder = 'Keep your rolling speed slow and controlled.',
            twoSided = 0
        WHERE setsRepsDuration IS NULL OR reminder IS NULL OR twoSided IS NULL
    `, (err) => {
        if (err) {
            console.error('Error updating existing records:', err.message);
        } else {
            console.log('Updated existing records with default values.');
        }
    });
});

db.close((err) => {
    if (err) {
        console.error('Error closing database:', err.message);
    } else {
        console.log('Database connection closed.');
    }
});