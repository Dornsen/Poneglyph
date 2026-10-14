const { BadRequestError } = require('./errors');

function parsePositiveInteger(value, defaultValue = null) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return defaultValue;
    }

    const normalizedValue = String(value).trim();
    if (!/^\d+$/.test(normalizedValue)) {
        return defaultValue;
    }

    const parsedValue = Number(normalizedValue);
    return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

function requirePositiveInteger(value, label) {
    const parsedValue = parsePositiveInteger(value);
    if (parsedValue === null) {
        throw new BadRequestError(`Invalid ${label}`);
    }
    return parsedValue;
}

function parsePagination(query, { defaultLimit = 10, maxLimit = 100 } = {}) {
    const page = query.page === undefined ? 1 : parsePositiveInteger(query.page);
    const requestedLimit = query.limit === undefined ? defaultLimit : parsePositiveInteger(query.limit);

    if (page === null || requestedLimit === null) {
        throw new BadRequestError('Parameters "page" and "limit" must be positive integers');
    }

    const limit = Math.min(requestedLimit, maxLimit);
    return { page, limit, skip: (page - 1) * limit };
}

function buildPaginationMeta(total, page, limit) {
    return { total, page, limit, totalPages: Math.ceil(total / limit) };
}

function parseSort(query, options, default_key) {
    const keys = Object.keys(options);
    const key = query.sort === undefined ? default_key : String(query.sort).trim().toLowerCase();
    if (!keys.includes(key)) {
        throw new BadRequestError(`Invalid sort. Allowed values are: ${keys.join(', ')}`);
    }

    const order = query.order === undefined ? options[key].default_order : String(query.order).trim().toLowerCase();
    if (!['asc', 'desc'].includes(order)) {
        throw new BadRequestError('Invalid order. Allowed values are: asc, desc');
    }

    return options[key].build(order);
}

function parseIdList(value, label) {
    if (value === undefined || value === null || value === '') {
        return [];
    }

    let items = value;
    if (typeof items === 'string') {
        const trimmed = items.trim();
        if (trimmed.startsWith('[')) {
            try {
                items = JSON.parse(trimmed);
            } catch (error) {
                throw new BadRequestError(`${label} must be a valid list of ids`);
            }
        } else {
            items = trimmed.split(',');
        }
    }

    if (!Array.isArray(items)) {
        items = [items];
    }

    const ids = items.map(item => parsePositiveInteger(item));
    if (ids.some(id => id === null)) {
        throw new BadRequestError(`${label} must contain only positive integers`);
    }
    return [...new Set(ids)];
}

function parseEnum(value, allowedValues, label) {
    const normalizedValue = String(value).trim().toUpperCase();
    if (!allowedValues.includes(normalizedValue)) {
        throw new BadRequestError(`Invalid ${label}. Allowed values are: ${allowedValues.join(', ')}`);
    }
    return normalizedValue;
}

function parseDate(value, label) {
    const date = new Date(value);
    if (typeof value !== 'string' || Number.isNaN(date.getTime())) {
        throw new BadRequestError(`${label} must be a valid ISO date`);
    }
    return date;
}

module.exports = {
    parsePositiveInteger,
    requirePositiveInteger,
    parsePagination,
    buildPaginationMeta,
    parseSort,
    parseIdList,
    parseEnum,
    parseDate
};
