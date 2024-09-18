const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('pg');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(bodyParser.json());

// PostgreSQL connection settings for the default "postgres" database
const postgresClient = new Client({
    user: process.env.DB_USER || 'your_superuser',
    host: process.env.DB_HOST || 'localhost',
    database: 'postgres',  // Connect to the default "postgres" database
    password: process.env.DB_PASSWORD || 'your_password',
    port: process.env.DB_PORT || 5432,
});

// Application database name
const applicationDatabaseName = 'auth_db';

// Function to create the application database if it doesn't exist
async function createDatabaseIfNotExists() {
    await postgresClient.connect();
    console.log('Connected to the postgres database to check/create application database');
    
    const createDatabaseQuery = `SELECT 1 FROM pg_database WHERE datname = '${applicationDatabaseName}'`;
    const result = await postgresClient.query(createDatabaseQuery);
    
    if (result.rowCount === 0) {
        console.log(`Database ${applicationDatabaseName} does not exist, creating it...`);
        await postgresClient.query(`CREATE DATABASE ${applicationDatabaseName}`);
        console.log(`Database ${applicationDatabaseName} created successfully.`);
    } else {
        console.log(`Database ${applicationDatabaseName} already exists.`);
    }
    
    await postgresClient.end();
}

// Connect to the application database and create the table if it doesn't exist
async function createTableIfNotExists() {
    const client = new Client({
        user: process.env.DB_USER || 'your_username',
        host: process.env.DB_HOST || 'localhost',
        database: applicationDatabaseName,
        password: process.env.DB_PASSWORD || 'your_password',
        port: process.env.DB_PORT || 5432,
    });
    
    await client.connect();
    console.log(`Connected to the ${applicationDatabaseName} database to check/create table`);
    
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS auth_codes (
            id SERIAL PRIMARY KEY,
            auth_code VARCHAR(6) NOT NULL,
            public_ip VARCHAR(45) NOT NULL,
            twinversion_id VARCHAR(100),
            requested_at TIMESTAMPTZ DEFAULT NOW()
        );
    `;
    await client.query(createTableQuery);
    console.log('Table "auth_codes" is ready.');
    
    return client;
}

// Function to generate an alphanumeric code with uppercase letters and numbers
function generateAuthCode(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let authCode = '';
    for (let i = 0; i < length; i++) {
        authCode += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return authCode;
}

// Main server logic to handle requests
(async () => {
    // Ensure database is created if not already
    await createDatabaseIfNotExists();
    
    // Ensure table is created, then use the client for queries
    const client = await createTableIfNotExists();

    // Endpoint to request authentication code
    app.post('/request-auth-code', async (req, res) => {
        const publicIP = req.body.publicIP;
        const twinversionId = req.body.twinversionId || null; // Optional twinversion ID
        if (!publicIP) {
            return res.status(400).send('Public IP is required');
        }

        // Generate a 6-character alphanumeric authentication code
        const authCode = generateAuthCode(6);

        try {
            // Insert the auth code, public IP, and twinversion ID into the database
            const insertQuery = `
                INSERT INTO auth_codes (auth_code, public_ip, twinversion_id)
                VALUES ($1, $2, $3)
                RETURNING auth_code;
            `;
            const values = [authCode, publicIP, twinversionId];
            const result = await client.query(insertQuery, values);

            res.json({ authCode: result.rows[0].auth_code });
        } catch (error) {
            console.error('Error inserting data into PostgreSQL', error);
            res.status(500).send('Server error');
        }
    });

    // Endpoint to retrieve IP based on the auth code
    app.post('/get-ip', async (req, res) => {
        const authCode = req.body.authCode;
        if (!authCode) {
            return res.status(400).send('Auth Code is required');
        }

        try {
            // Retrieve the public IP and twinversion ID based on the auth code
            const selectQuery = `
                SELECT public_ip, twinversion_id, requested_at
                FROM auth_codes
                WHERE auth_code = $1;
            `;
            const result = await client.query(selectQuery, [authCode]);

            if (result.rows.length === 0) {
                return res.status(404).send('Invalid auth code');
            }

            const { public_ip, twinversion_id, requested_at } = result.rows[0];
            res.json({
                publicIP: public_ip,
                twinversionId: twinversion_id,
                requestedAt: requested_at,
            });
        } catch (error) {
            console.error('Error retrieving data from PostgreSQL', error);
            res.status(500).send('Server error');
        }
    });

    // Start the server
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
})();