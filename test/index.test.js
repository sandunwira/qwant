import assert from 'node:assert/strict';
import test from 'node:test';
import QwantClient from '../index.js';

function mockFetch(payload, response = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: response.ok === undefined ? true : response.ok,
      status: response.status || 200,
      statusText: response.statusText || 'OK',
      json: async () => payload,
    };
  };
  fetch.calls = calls;
  return fetch;
}

test('builds a web search request with documented defaults', async () => {
  const fetch = mockFetch({ status: 'success', data: {} });
  const client = new QwantClient({ fetch });

  await client.web('hello world');

  const url = new URL(fetch.calls[0].url);
  assert.equal(url.pathname, '/v3/search/web');
  assert.equal(url.searchParams.get('q'), 'hello world');
  assert.equal(url.searchParams.get('count'), '10');
  assert.equal(url.searchParams.get('locale'), 'en_GB');
  assert.equal(url.searchParams.get('displayed'), 'true');
  assert.equal(url.searchParams.get('llm'), 'true');
});

test('supports image, video, news, and suggestion endpoints', async () => {
  const fetch = mockFetch({ status: 'success', data: {} });
  const client = new QwantClient({ fetch });

  await client.images('cats');
  await client.videos('cats');
  await client.news('cats');
  await client.suggest('cat');

  assert.deepEqual(
    fetch.calls.map(({ url }) => new URL(url).pathname),
    ['/v3/search/images', '/v3/search/videos', '/v3/search/news', '/v3/suggest'],
  );
  assert.equal(new URL(fetch.calls[1].url).searchParams.get('t'), 'videos');
  assert.equal(new URL(fetch.calls[3].url).searchParams.get('locale'), 'en_GB');
});

test('allows overriding endpoint parameters', async () => {
  const fetch = mockFetch({ status: 'success', data: {} });
  const client = new QwantClient({ fetch });

  await client.web('cats', {
    count: 25,
    locale: 'fr_FR',
    offset: 4,
    device: 'mobile',
    tgp: 1,
    safesearch: 0,
    displayed: false,
    llm: false,
    freshness: 'week',
    custom_filter: 'enabled',
  });

  const url = new URL(fetch.calls[0].url);
  assert.equal(url.searchParams.get('count'), '25');
  assert.equal(url.searchParams.get('locale'), 'fr_FR');
  assert.equal(url.searchParams.get('offset'), '4');
  assert.equal(url.searchParams.get('device'), 'mobile');
  assert.equal(url.searchParams.get('tgp'), '1');
  assert.equal(url.searchParams.get('safesearch'), '0');
  assert.equal(url.searchParams.get('displayed'), 'false');
  assert.equal(url.searchParams.get('llm'), 'false');
  assert.equal(url.searchParams.get('freshness'), 'week');
  assert.equal(url.searchParams.get('custom_filter'), 'enabled');
});

test('allows overriding media, news, and suggestion parameters', async () => {
  const fetch = mockFetch({ status: 'success', data: {} });
  const client = new QwantClient({ fetch });

  await client.images('cats', { t: 'images', count: 5, color: 'blue', imagetype: 'photo' });
  await client.videos('cats', { t: 'videos', count: 8, order: 'date', source: 'youtube' });
  await client.news('cats', { t: 'news', count: 7, order: 'date', source: 'wired.com' });
  await client.suggest('cat', { locale: 'fr_FR', custom: 'value' });

  const urls = fetch.calls.map(({ url }) => new URL(url));
  assert.equal(urls[0].searchParams.get('color'), 'blue');
  assert.equal(urls[0].searchParams.get('imagetype'), 'photo');
  assert.equal(urls[1].searchParams.get('order'), 'date');
  assert.equal(urls[1].searchParams.get('source'), 'youtube');
  assert.equal(urls[2].searchParams.get('source'), 'wired.com');
  assert.equal(urls[3].searchParams.get('locale'), 'fr_FR');
  assert.equal(urls[3].searchParams.get('custom'), 'value');
});

test('requires options to be plain objects', () => {
  const client = new QwantClient({ fetch: mockFetch({ status: 'success' }) });

  assert.throws(() => client.web('query', null), /options must be an object/);
  assert.throws(() => client.images('query', []), /options must be an object/);
});

test('rejects invalid queries and API errors', async () => {
  const fetch = mockFetch({ status: 'error', error: 'bad query' });
  const client = new QwantClient({ fetch });

  assert.throws(() => client.web(''), /non-empty string/);
  await assert.rejects(client.web('query'), (error) => {
    assert.equal(error.name, 'QwantApiError');
    assert.equal(error.body.status, 'error');
    return true;
  });
});

test('reports CAPTCHA blocks without retrying', async () => {
  const fetch = mockFetch({
    url: 'https://geo.captcha-delivery.com/captcha/?cid=test',
  }, { ok: false, status: 403, statusText: 'Forbidden' });
  const client = new QwantClient({ fetch, retryDelay: 0 });

  await assert.rejects(client.web('query'), (error) => {
    assert.equal(error.code, 'ECAPTCHA');
    assert.equal(error.status, 403);
    assert.equal(error.captchaUrl, 'https://geo.captcha-delivery.com/captcha/?cid=test');
    return true;
  });
  assert.equal(fetch.calls.length, 1);
});

test('retries transient HTTP failures with exponential backoff', async () => {
  let attempts = 0;
  const fetch = async () => {
    attempts += 1;
    if (attempts < 3) {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ status: 'error' }),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ status: 'success', data: {} }),
    };
  };
  const client = new QwantClient({ fetch, retryDelay: 0, maxRetries: 2 });

  await client.web('query');
  assert.equal(attempts, 3);
});
