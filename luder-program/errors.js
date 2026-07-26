'use strict';

class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'UNKNOWN_ERROR';
    this.cause = options.cause || null;
    this.statusCode = options.statusCode || null;
  }
}

class InvalidModelError extends AppError {
  constructor(model, provider, message) {
    super(message || `Invalid model "${model}" for provider "${provider}"`, {
      code: 'INVALID_MODEL',
      cause: { model, provider },
    });
    this.model = model;
    this.provider = provider;
  }
}

class ProviderError extends AppError {
  constructor(provider, statusCode, body, message) {
    super(message || `Provider "${provider}" returned error`, {
      code: 'PROVIDER_ERROR',
      cause: { provider, statusCode, body },
      statusCode,
    });
    this.provider = provider;
  }
}

class RouterError extends AppError {
  constructor(code, cause) {
    super(code, { code: code || 'ROUTER_ERROR', cause });
  }
}

class RateLimitError extends AppError {
  constructor(provider, resetAt) {
    super(`Rate limit exceeded for "${provider}"`, {
      code: 'RATE_LIMIT',
      cause: { provider, resetAt },
    });
    this.provider = provider;
    this.resetAt = resetAt;
  }
}

class NetworkError extends AppError {
  constructor(provider, originalError) {
    super(`Network error for "${provider}": ${originalError?.message || 'unknown'}`, {
      code: 'NETWORK_ERROR',
      cause: { provider, originalError },
    });
    this.provider = provider;
  }
}

module.exports = { AppError, InvalidModelError, ProviderError, RouterError, RateLimitError, NetworkError };
