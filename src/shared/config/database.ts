import knex from 'knex';
import { DATABASE } from './environment';

let dbConfig: knex.Knex.Config;

// Configure database based on DATABASE_URL or individual parameters
if (DATABASE.URL) {
  dbConfig = {
    client: 'postgresql',
    connection: DATABASE.URL,
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations',
    },
    seeds: {
      directory: './seeds',
    },
  };

  // Add SSL configuration if needed
  if (DATABASE.SSL) {
    (dbConfig.connection as any).ssl = {
      rejectUnauthorized: false,
    };

    if (DATABASE.SSL_CERT) {
      (dbConfig.connection as any).ssl.ca = DATABASE.SSL_CERT;
    }
  }
} else {
  // Use individual connection parameters
  dbConfig = {
    client: 'postgresql',
    connection: {
      host: DATABASE.HOST,
      port: DATABASE.PORT,
      user: DATABASE.USER,
      password: DATABASE.PASSWORD,
      database: DATABASE.NAME,
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations',
    },
    seeds: {
      directory: './seeds',
    },
  };

  // Add SSL configuration if needed
  if (DATABASE.SSL) {
    (dbConfig.connection as any).ssl = {
      rejectUnauthorized: false,
    };

    if (DATABASE.SSL_CERT) {
      (dbConfig.connection as any).ssl.ca = DATABASE.SSL_CERT;
    }
  }
}

export const db = knex(dbConfig);

/**
 * Database initialization function to verify connection
 * and run any startup tasks.
 */
export const initializeDatabase = async () => {
  try {
    // Verify connection
    await db.raw('SELECT 1');
    console.log('Database connection established successfully');
    
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
};

export default db;