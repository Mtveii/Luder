'use strict';

const { AppError, InvalidModelError, ProviderError, RouterError, RateLimitError, NetworkError } = require('./errors');

const ERROR_MAP = [
  {
    check: (err) => err instanceof InvalidModelError,
    message: (err) =>
      `Некорректная модель "${err.model}" для ${err.provider}. Попробуйте выбрать другую модель в настройках.`,
  },
  {
    check: (err) => err instanceof RateLimitError,
    message: () => `Превышен лимит запросов. Попробуйте позже.`,
  },
  {
    check: (err) => err instanceof NetworkError,
    message: () => `Нет соединения с сервером AI-провайдера. Проверьте интернет.`,
  },
  {
    check: (err) => err instanceof RouterError && err.code === 'ALL_MODELS_FAILED',
    message: (err) => {
      const cause = err.cause;
      if (cause instanceof AppError) return cause.message;
      if (cause instanceof Error) {
        const m = cause.message || '';
        if (m.includes('400') || m.includes('Invalid model')) {
          return `Ошибка конфигурации: неверная модель отправлена провайдеру. Попробуйте перезапустить приложение или выбрать модель заново.`;
        }
        return `Не удалось получить ответ ни от одного провайдера: ${m.slice(0, 200)}`;
      }
      return `Не удалось получить ответ ни от одного провайдера. Проверьте ключи API в настройках.`;
    },
  },
  {
    check: (err) => err instanceof ProviderError,
    message: (err) => {
      const body = err.cause?.body || '';
      if (body.includes('rate limit') || body.includes('Rate limit') || err.statusCode === 429) {
        return `Превышен лимит запросов для ${err.provider}. Попробуйте позже.`;
      }
      if (body.includes('Invalid model') || body.includes('invalid_model')) {
        return `Ошибка модели у ${err.provider}: отправлено неверное имя модели. Попробуйте выбрать модель заново.`;
      }
      if (err.statusCode === 401 || err.statusCode === 403) {
        return `Ошибка авторизации у ${err.provider}. Проверьте API-ключ в настройках.`;
      }
      if (err.statusCode >= 500) {
        return `${err.provider} временно недоступен (ошибка ${err.statusCode}). Попробуйте позже.`;
      }
      return `${err.provider} вернул ошибку (${err.statusCode}): ${body.slice(0, 100)}`;
    },
  },
  {
    check: (err) => err instanceof AppError,
    message: (err) => err.message,
  },
];

function mapError(err) {
  if (!err) return 'Произошла неизвестная ошибка.';

  for (const entry of ERROR_MAP) {
    if (entry.check(err)) {
      return entry.message(err);
    }
  }

  if (err instanceof Error) {
    const msg = err.message || '';
    if (msg.includes('timeout')) {
      return 'Превышено время ожидания ответа от провайдера. Попробуйте ещё раз.';
    }
    if (msg.includes('fetch') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
      return 'Нет соединения с сервером AI-провайдера. Проверьте интернет.';
    }
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return 'Ошибка авторизации. Проверьте API-ключ в настройках.';
    }
    if (msg.includes('429')) {
      return 'Превышен лимит запросов. Попробуйте позже.';
    }
    return msg;
  }

  return String(err);
}

module.exports = { mapError };
