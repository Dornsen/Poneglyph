const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
    secure: process.env.SMTP_SECURE === 'true', 
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const frontend_url = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`;

const mailer = { 
    sendWelcomeEmail: async (toEmail, fullName) => {
        try {
            await transporter.sendMail({
                from: process.env.SMTP_FROM || '"Poneglyph Team" <ThePoneglyphTeam@gmail.com>',
                to: toEmail,
                subject: 'Welcome to Poneglyph! 🚀',
                text: `Hello, ${fullName}! You have successfully registered in our system.`,
                html: `<h2>Hello, ${fullName}! 🎉</h2><p>You have successfully registered in our cool Poneglyph system.</p>`
            });
            console.log(`Email successfully sent to ${toEmail}`);
        } catch (error) {
            console.error('Error sending welcome email:', error.message);
            throw new Error(`Failed to send welcome email: ${error.message}`); 
        }
    },

    sendVerificationEmail: async (toEmail, fullName, token) => {
        try {
            const verificationUrl = `${frontend_url}/auth/verify?token=${token}`;
            
            await transporter.sendMail({
                from: process.env.SMTP_FROM || '"Poneglyph Team" <ThePoneglyphTeam@gmail.com>',
                to: toEmail,
                subject: 'Verify your Poneglyph account 🛡️',
                text: `Hello, ${fullName}! Please verify your account by clicking this link: ${verificationUrl}`,
                html: `<h2>Hello, ${fullName}! 🎉</h2><p>Click the button below to verify your Poneglyph account:</p><a href="${verificationUrl}" style="padding: 10px 20px; background: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Verify Email</a>`
            });
            console.log(`Verification email sent to ${toEmail}`);
        } catch (error) {
            console.error('Error sending verification email:', error.message);
            throw new Error(`Failed to send verification email: ${error.message}`); 
        }
    },

    sendPasswordResetEmail: async (toEmail, fullName, token) => {
        try {
            const resetUrl = `${frontend_url}/auth/reset-password?token=${token}`;
            await transporter.sendMail({
                from: process.env.SMTP_FROM || '"Poneglyph Team" <ThePoneglyphTeam@gmail.com>',
                to: toEmail,
                subject: 'Reset your Poneglyph password 🔄',
                text: `Hello, ${fullName}! Please reset your password by clicking this link: ${resetUrl}`,
                html: `<h2>Hello, ${fullName}! 🎉</h2><p>Click the button below to reset your Poneglyph password:</p><a href="${resetUrl}" style="padding: 10px 20px; background: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Reset Password</a>`
            });
            console.log(`Password reset email sent to ${toEmail}`);
        } catch (error) {
            console.error('Error sending password reset email:', error.message);
            throw new Error(`Failed to send password reset email: ${error.message}`);
        }
    }
};

module.exports = { mailer };