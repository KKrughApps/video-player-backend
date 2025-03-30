const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

const dbConfig = parse(process.env.DATABASE_URL);
dbConfig.ssl = { rejectUnauthorized: false };
const pool = new Pool(dbConfig);

module.exports = pool;