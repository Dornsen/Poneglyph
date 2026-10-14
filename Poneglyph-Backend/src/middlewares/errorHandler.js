const multer = require('multer');
const { AppError, NotFoundError } = require('../utils/errors');

const MULTER_MESSAGES = {
    LIMIT_FILE_SIZE: 'Uploaded file is too large',
    LIMIT_FILE_COUNT: 'Too many files uploaded',
    LIMIT_UNEXPECTED_FILE: 'Unexpected file field or too many files'
};

function collectUploadedFiles(req) {
    if (req.file) {
        return [req.file];
    }
    if (Array.isArray(req.files)) {
        return req.files;
    }
    if (req.files && typeof req.files === 'object') {
        return Object.values(req.files).flat();
    }
    return [];
}

function createErrorHandler({ fileStorage }) {
    return async (error, req, res, next) => {
        await fileStorage.deleteUploadedFilesAsync(collectUploadedFiles(req));

        if (error instanceof AppError) {
            return res.status(error.status_code).json({ message: error.message });
        }
        if (error instanceof multer.MulterError) {
            return res.status(400).json({ message: MULTER_MESSAGES[error.code] || error.message });
        }
        if (error.type === 'entity.parse.failed') {
            return res.status(400).json({ message: 'Request body contains invalid JSON' });
        }
        if (error.type === 'entity.too.large') {
            return res.status(413).json({ message: 'Request body is too large' });
        }

        console.error('Unhandled error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    };
}

function notFoundHandler(req, res, next) {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}

function ensureBody(req, res, next) {
    if (req.body === undefined || req.body === null) {
        req.body = {};
    }
    next();
}

module.exports = { createErrorHandler, notFoundHandler, ensureBody };
