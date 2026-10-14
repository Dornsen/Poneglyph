const { BadRequestError } = require('./errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOGIN_PATTERN = /^[A-Za-z0-9_.-]{3,30}$/;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

function requireString(value, label, { max = 255, min = 1 } = {}) {
    if (typeof value !== 'string' || value.trim().length < min) {
        throw new BadRequestError(`${label} is required`);
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
        throw new BadRequestError(`${label} must be ${max} characters or less`);
    }
    return trimmed;
}

function optionalString(value, label, { max = 255 } = {}) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new BadRequestError(`${label} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
        throw new BadRequestError(`${label} must be ${max} characters or less`);
    }
    return trimmed;
}

function validateEmail(value) {
    const email = requireString(value, 'Email').toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
        throw new BadRequestError('Email is not valid');
    }
    return email;
}

function validateLogin(value) {
    const login = requireString(value, 'Login');
    if (!LOGIN_PATTERN.test(login)) {
        throw new BadRequestError('Login must be 3-30 characters: letters, digits, dot, dash or underscore');
    }
    return login;
}

function validateFullName(value) {
    return requireString(value, 'Full name', { max: 100, min: 2 });
}

function validatePassword(value, label = 'Password') {
    if (typeof value !== 'string' || !value) {
        throw new BadRequestError(`${label} is required`);
    }
    if (value.length < MIN_PASSWORD_LENGTH) {
        throw new BadRequestError(`${label} must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (value.length > MAX_PASSWORD_LENGTH) {
        throw new BadRequestError(`${label} must be ${MAX_PASSWORD_LENGTH} characters or less`);
    }
    return value;
}

function validatePasswordConfirmation(password, confirmation) {
    if (confirmation !== password) {
        throw new BadRequestError('Passwords do not match');
    }
}

module.exports = {
    requireString,
    optionalString,
    validateEmail,
    validateLogin,
    validateFullName,
    validatePassword,
    validatePasswordConfirmation
};
