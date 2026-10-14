const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { BadRequestError } = require('../utils/errors');

const IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};

const VIDEO_TYPES = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov'
};

function createUploaders(config) {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, config.storage_dir),
        filename: (req, file, cb) => {
            const extension = IMAGE_TYPES[file.mimetype] || VIDEO_TYPES[file.mimetype] || '';
            const unique_suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
            cb(null, `${path.basename(file.fieldname)}-${unique_suffix}${extension}`);
        }
    });

    const buildFilter = (allowedTypes, errorMessage) => (req, file, cb) => {
        if (Object.prototype.hasOwnProperty.call(allowedTypes, file.mimetype)) {
            return cb(null, true);
        }
        return cb(new BadRequestError(errorMessage));
    };

    return {
        media: multer({
            storage,
            fileFilter: buildFilter(
                { ...IMAGE_TYPES, ...VIDEO_TYPES },
                'Invalid file type. Only image and video formats are allowed'
            ),
            limits: { fileSize: 100 * 1024 * 1024 }
        }),
        imageOnly: multer({
            storage,
            fileFilter: buildFilter(IMAGE_TYPES, 'Invalid file type. Only JPEG, PNG, WebP and GIF images are allowed'),
            limits: { fileSize: 10 * 1024 * 1024 }
        })
    };
}

module.exports = createUploaders;
