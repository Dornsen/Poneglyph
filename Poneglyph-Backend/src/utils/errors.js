class AppError extends Error {
    constructor(status_code, message) {
        super(message);
        this.name = this.constructor.name;
        this.status_code = status_code;
    }
}

class BadRequestError extends AppError {
    constructor(message = 'Bad request') {
        super(400, message);
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(401, message);
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(403, message);
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Not found') {
        super(404, message);
    }
}

class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(409, message);
    }
}

class ServiceUnavailableError extends AppError {
    constructor(message = 'Service unavailable') {
        super(503, message);
    }
}

module.exports = {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    ServiceUnavailableError
};
