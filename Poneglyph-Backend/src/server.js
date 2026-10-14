require('dotenv').config();

const prisma = require('./config/db');
const { loadConfig } = require('./config');
const { createSmtpMailer } = require('./config/mailer');
const createApp = require('./app');

const config = loadConfig();
if (!config.jwt_secret) {
    console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in');
    process.exit(1);
}

const app = createApp({ prisma, mailer: createSmtpMailer(config), config });

app.listen(config.port, () => {
    console.log(`Server is running: http://localhost:${config.port}`);
});
