const fs = require('fs');
const path = require('path');

const PUBLIC_PREFIX = '/storage/';

class FileStorage {
    constructor(storage_dir) {
        this.storage_dir = storage_dir;
        fs.mkdirSync(storage_dir, { recursive: true });
    }

    toUrl(filename) {
        return `${PUBLIC_PREFIX}${filename}`;
    }

    toMediaRecords(files = []) {
        return files.map(file => ({
            media_url: this.toUrl(file.filename),
            type: file.mimetype && file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE'
        }));
    }

    async deleteByUrlsAsync(urls) {
        const filenames = urls
            .filter(url => typeof url === 'string' && url.startsWith(PUBLIC_PREFIX))
            .map(url => path.basename(url));
        await Promise.all(filenames.map(filename => this.deleteFileAsync(path.join(this.storage_dir, filename))));
    }

    async deleteUploadedFilesAsync(files = []) {
        await Promise.all(files.map(file => this.deleteFileAsync(file.path)));
    }

    async deleteFileAsync(file_path) {
        try {
            await fs.promises.unlink(file_path);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn(`Could not delete file ${file_path}: ${error.message}`);
            }
        }
    }
}

module.exports = FileStorage;
