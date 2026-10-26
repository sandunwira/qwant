# qwant

An unofficial, dependency-free Node.js ESM client for the Qwant search API.

## Requirements

Node.js 18 or newer.

## Installation

```bash
npm install qwant-search
```

## Usage

```js
import Qwant from 'qwant-search';

const qwant = new Qwant();

const web = await qwant.web('wikipedia');
const images = await qwant.images('wikipedia', { count: 20 });
const videos = await qwant.videos('javascript');
const news = await qwant.news('technology', { freshness: 'week' });
const suggestions = await qwant.suggest('wikip');
```

All methods return the complete JSON response from Qwant. The response shape
is the native Qwant response shape; results are not normalized or discarded.

### Search methods

- `web(query, options)` - web results at `/v3/search/web`
- `images(query, options)` - image results at `/v3/search/images`
- `videos(query, options)` - video results at `/v3/search/videos`
- `news(query, options)` - news results at `/v3/search/news`
- `suggest(query, options)` - autocomplete suggestions at `/v3/suggest`
- `search(type, query, options)` - generic method for `web`, `images`,
  `videos`, or `news`

For example:

```js
const webResponse = await qwant.web('wikipedia');
const webSections = webResponse.data?.result?.items?.mainline ?? [];

for (const section of webSections) {
  if (section.type !== 'web') continue;

  for (const item of section.items ?? []) {
    console.log(item.title, item.url);
  }
}

const imageResponse = await qwant.images('cats');
for (const item of imageResponse.data?.result?.items ?? []) {
  console.log(item.title, item.media, item.thumbnail, item.url);
}

const videoResponse = await qwant.videos('javascript');
for (const item of videoResponse.data?.result?.items ?? []) {
  console.log(item.title, item.url, item.channel);
}

const newsResponse = await qwant.news('technology');
for (const item of newsResponse.data?.result?.items ?? []) {
  console.log(item.title, item.url, item.domain);
}

const suggestionResponse = await qwant.suggest('wikip');
for (const item of suggestionResponse.data?.items ?? []) {
  console.log(item.value);
}
```

## Configuring options

Every property in the `options` object becomes a query parameter. This makes
all Qwant filters configurable, including options added by Qwant in the
future:

```js
const response = await qwant.web('cats', {
  count: 25,
  locale: 'fr_FR',
  offset: 4,
  device: 'mobile',
  tgp: 1,
  safesearch: 0,
  displayed: false,
  llm: false,
  freshness: 'week',
});
```

The query is always taken from the `query` argument. An option named `q`
cannot replace it.

Common configurable parameters include:

| Endpoint | Parameters |
| --- | --- |
| Web | `count`, `locale`, `offset`, `device`, `tgp`, `safesearch`, `displayed`, `llm`, `freshness` |
| Images | `t`, `count`, `locale`, `offset`, `device`, `tgp`, `safesearch`, `size`, `license`, `freshness`, `color`, `imagetype` |
| Videos | `t`, `count`, `locale`, `offset`, `device`, `tgp`, `safesearch`, `order`, `source` |
| News | `t`, `count`, `locale`, `offset`, `device`, `tgp`, `safesearch`, `order`, `freshness`, `source` |
| Suggestions | `locale` |

Additional properties are forwarded unchanged, which keeps the client
compatible with new Qwant API parameters.

The `locale`, `count`, `offset`, `device`, `tgp`, and `safesearch` defaults
match the endpoints described in the API examples. Pass an option to override
one. `baseUrl`, `timeout` (milliseconds; `0` disables it), `maxRetries`,
`retryDelay` (milliseconds), and a custom `fetch` implementation can be
supplied to the constructor.

```js
const qwant = new Qwant({
  timeout: 10_000,
  maxRetries: 2,
  retryDelay: 500,
});
```

Transient network failures and HTTP `408`, `429`, `500`, `502`, `503`, and
`504` responses are retried with exponential backoff. CAPTCHA responses are
never retried. When Qwant blocks a request, the promise rejects with
`QwantApiError` having `code: 'ECAPTCHA'` and a `captchaUrl` property:

```js
try {
  await qwant.web('wikipedia');
} catch (error) {
  if (error.code === 'ECAPTCHA') {
    console.error('Qwant requires CAPTCHA verification:', error.captchaUrl);
  }
}
```

HTTP, network, timeout, invalid JSON, and API-level failures reject with
`QwantApiError`. The error exposes details such as `status`, `body`, `url`, and
`code` where available.

## CAPTCHA and temporary failures

Qwant may return an anti-bot CAPTCHA for one endpoint while other endpoints
continue to work. CAPTCHA responses are never retried. They reject with
`error.code === 'ECAPTCHA'` and expose the temporary challenge URL as
`error.captchaUrl`.

Do not repeatedly retry or automatically solve CAPTCHA challenges. Handle the
error as a temporary service limitation:

```js
try {
  const response = await qwant.web('wikipedia');
  console.dir(response, { depth: null });
} catch (error) {
  if (error.code === 'ECAPTCHA') {
    console.error(
      'Qwant requires CAPTCHA verification. Try again later or use another network.',
    );
  } else {
    console.error('Qwant request failed:', error.message);
  }
}
```

If several endpoint calls should be attempted independently, use separate
`try`/`catch` blocks so one CAPTCHA response does not prevent other endpoint
calls:

```js
async function runEndpoint(name, request) {
  try {
    return await request();
  } catch (error) {
    if (error.code === 'ECAPTCHA') {
      console.error(`[${name}] CAPTCHA required`);
    } else {
      console.error(`[${name}] ${error.message}`);
    }
    return undefined;
  }
}

await runEndpoint('web', () => qwant.web('wikipedia'));
await runEndpoint('images', () => qwant.images('wikipedia'));
await runEndpoint('videos', () => qwant.videos('wikipedia'));
await runEndpoint('news', () => qwant.news('wikipedia'));
await runEndpoint('suggestions', () => qwant.suggest('wikipedia'));
```

## Testing from another project

To test a local package installation:

```powershell
cd "D:\Projects\npm Packages\qwant"
npm pack

cd "D:\Projects\npm Packages\qwant-test"
npm init -y
npm install "D:\Projects\npm Packages\qwant\qwant-1.0.0.tgz"
npm pkg set type=module
```

Then create `index.js` in the test project:

```js
import Qwant from 'qwant-search';

const qwant = new Qwant();
console.dir(await qwant.videos('wikipedia'), { depth: null });
```

Run it with:

```powershell
node index.js
```

The test project's `package.json` must contain `"type": "module"` when using
ESM syntax in `.js` files.
