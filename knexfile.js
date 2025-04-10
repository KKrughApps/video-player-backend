// Load environment variables
require('dotenv').config();

// Default configuration
const defaultConfig = {
  client: 'postgresql',
  connection: process.env.DATABASE_URL
    ? process.env.DATABASE_URL
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'video_narration',
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

// Configure SSL if required
if (process.env.DB_SSL === 'true') {
  if (defaultConfig.connection === process.env.DATABASE_URL) {
    // For connection string
    defaultConfig.connection = {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    };

    // Add SSL cert if available
    if (process.env.DB_SSL_CERT) {
      defaultConfig.connection.ssl.ca = process.env.DB_SSL_CERT;
    }
  } else {
    // For individual connection parameters
    defaultConfig.connection.ssl = {
      rejectUnauthorized: false,
    };

    // Add SSL cert if available
    if (process.env.DB_SSL_CERT) {
      defaultConfig.connection.ssl.ca = process.env.DB_SSL_CERT;
    }
  }
}

// Export configurations for different environments
module.exports = {
  development: defaultConfig,
  
  test: {
    ...defaultConfig,
    connection: {
      ...defaultConfig.connection,
      database: `${defaultConfig.connection.database}_test`,
    },
  },
  
  production: defaultConfig,
};