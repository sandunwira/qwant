const DEFAULT_BASE_URL = 'https://api.qwant.com/v3';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 500;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

class QwantApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'QwantApiError';
    Object.assign(this, details);
  }
}

function assertQuery(query) {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new TypeError('query must be a non-empty string');
  }
}

function assertOptions(options) {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

function appendParams(url, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
}

function getCaptchaUrl(payload) {
  const candidate = payload && typeof payload.url === 'string' ? payload.url : '';
  return candidate.includes('captcha') ? candidate : undefined;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class QwantClient {
  constructor(options = {}) {
    if (typeof options !== 'object' || options === null) {
      throw new TypeError('options must be an object');
    }

    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.timeout = options.timeout === undefined ? DEFAULT_TIMEOUT : options.timeout;
    this.maxRetries = options.maxRetries === undefined ? DEFAULT_MAX_RETRIES : options.maxRetries;
    this.retryDelay = options.retryDelay === undefined ? DEFAULT_RETRY_DELAY : options.retryDelay;
    this.fetch = options.fetch || globalThis.fetch;

    if (typeof this.fetch !== 'function') {
      throw new Error('A fetch implementation is required (Node.js 18 or newer provides one)');
    }
    if (!Number.isFinite(this.timeout) || this.timeout < 0) {
      throw new TypeError('timeout must be a non-negative number');
    }
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new TypeError('maxRetries must be a non-negative integer');
    }
    if (!Number.isFinite(this.retryDelay) || this.retryDelay < 0) {
      throw new TypeError('retryDelay must be a non-negative number');
    }
  }

  web(query, options = {}) {
    assertOptions(options);
    return this.search('web', query, {
      count: 10,
      locale: 'en_GB',
      offset: 0,
      device: 'desktop',
      tgp: 2,
      safesearch: 1,
      displayed: true,
      llm: true,
      ...options,
    });
  }

  images(query, options = {}) {
    assertOptions(options);
    return this.search('images', query, {
      t: 'images',
      count: 50,
      locale: 'en_GB',
      offset: 0,
      device: 'desktop',
      tgp: 2,
      safesearch: 1,
      ...options,
    });
  }

  videos(query, options = {}) {
    assertOptions(options);
    return this.search('videos', query, {
      t: 'videos',
      count: 15,
      locale: 'en_GB',
      offset: 0,
      device: 'desktop',
      tgp: 2,
      safesearch: 1,
      ...options,
    });
  }

  news(query, options = {}) {
    assertOptions(options);
    return this.search('news', query, {
      t: 'news',
      count: 10,
      locale: 'en_GB',
      offset: 0,
      device: 'desktop',
      tgp: 2,
      safesearch: 1,
      ...options,
    });
  }

  search(type, query, options = {}) {
    if (!['web', 'images', 'videos', 'news'].includes(type)) {
      throw new TypeError('type must be one of: web, images, videos, news');
    }
    assertQuery(query);
    assertOptions(options);
    if (options.offset !== undefined) {
      assertNonNegativeInteger(options.offset, 'offset');
    }
    if (options.count !== undefined) {
      assertNonNegativeInteger(options.count, 'count');
    }

    return this.request(`/search/${type}`, { ...options, q: query });
  }

  suggest(query, options = {}) {
    assertQuery(query);
    assertOptions(options);
    return this.request('/suggest', {
      locale: 'en_GB',
      ...options,
      q: query,
    });
  }

  async request(path, params = {}) {
    const url = new URL(
      path.replace(/^\/+/, ''),
      `${this.baseUrl.replace(/\/+$/, '')}/`,
    );
    appendParams(url, params);

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.requestOnce(url);
      } catch (error) {
        const canRetry = attempt < this.maxRetries
          && (error.code === 'ENETWORK'
            || error.code === 'ETIMEDOUT'
            || RETRYABLE_STATUSES.has(error.status));
        if (!canRetry) {
          throw error;
        }
        await wait(this.retryDelay * (2 ** attempt));
      }
    }
  }

  async requestOnce(url) {
    const controller = new AbortController();
    const timeoutId = this.timeout > 0
      ? setTimeout(() => controller.abort(), this.timeout)
      : undefined;

    let response;
    try {
      response = await this.fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new QwantApiError(`Qwant request timed out after ${this.timeout} ms`, {
          cause: error,
          code: 'ETIMEDOUT',
          url: url.toString(),
        });
      }
      throw new QwantApiError('Qwant request failed', {
        cause: error,
        code: 'ENETWORK',
        url: url.toString(),
      });
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new QwantApiError('Qwant returned invalid JSON', {
        cause: error,
        status: response.status,
        url: url.toString(),
      });
    }

    if (!response.ok) {
      const captchaUrl = response.status === 403 ? getCaptchaUrl(payload) : undefined;
      throw new QwantApiError(
        captchaUrl ? 'Qwant blocked the request with a CAPTCHA' : `Qwant returned HTTP ${response.status}`,
        {
          status: response.status,
          statusText: response.statusText,
          body: payload,
          code: captchaUrl ? 'ECAPTCHA' : 'EHTTP',
          captchaUrl,
          url: url.toString(),
        },
      );
    }
    if (payload && payload.status && payload.status !== 'success') {
      throw new QwantApiError('Qwant rejected the request', {
        body: payload,
        code: 'EAPI',
        url: url.toString(),
      });
    }

    return payload;
  }
}

export { QwantApiError, QwantClient };
export default QwantClient;
