const nodemailer = require('nodemailer');

const DEFAULT_FROM = '"Poneglyph Team" <ThePoneglyphTeam@gmail.com>';

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class Mailer {
    constructor(transporter, { frontend_url, from = DEFAULT_FROM }) {
        this.transporter = transporter;
        this.frontend_url = frontend_url;
        this.from = from;
    }

    async sendMailAsync({ to, subject, text, html }) {
        await this.transporter.sendMail({ from: this.from, to, subject, text, html });
    }

    async sendVerificationEmailAsync(to_email, full_name, token) {
        const url = `${this.frontend_url}/auth/verify?token=${encodeURIComponent(token)}`;
        await this.sendMailAsync({
            to: to_email,
            subject: 'Verify your Poneglyph account',
            text: `Hello, ${full_name}! Please verify your account by opening this link: ${url}`,
            html: `<h2>Hello, ${escapeHtml(full_name)}!</h2>`
                + '<p>Click the button below to verify your Poneglyph account:</p>'
                + `<a href="${url}" style="padding: 10px 20px; background: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Verify Email</a>`
        });
    }

    async sendWelcomeEmailAsync(to_email, full_name) {
        await this.sendMailAsync({
            to: to_email,
            subject: 'Welcome to Poneglyph!',
            text: `Hello, ${full_name}! Your email is verified and your account is ready.`,
            html: `<h2>Hello, ${escapeHtml(full_name)}!</h2><p>Your email is verified and your account is ready.</p>`
        });
    }

    async sendPasswordResetEmailAsync(to_email, full_name, token) {
        const url = `${this.frontend_url}/auth/reset-password?token=${encodeURIComponent(token)}`;
        await this.sendMailAsync({
            to: to_email,
            subject: 'Reset your Poneglyph password',
            text: `Hello, ${full_name}! Reset your password by opening this link: ${url}`,
            html: `<h2>Hello, ${escapeHtml(full_name)}!</h2>`
                + '<p>Click the button below to reset your Poneglyph password:</p>'
                + `<a href="${url}" style="padding: 10px 20px; background: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Reset Password</a>`
        });
    }
}

function createSmtpMailer(config, env = process.env) {
    const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : 587,
        secure: env.SMTP_SECURE === 'true',
        auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
        }
    });

    return new Mailer(transporter, {
        frontend_url: config.frontend_url,
        from: env.SMTP_FROM || DEFAULT_FROM
    });
}

module.exports = { Mailer, createSmtpMailer };
