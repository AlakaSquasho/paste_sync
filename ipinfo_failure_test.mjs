const BASE_URL = 'https://ipinfo.dkly.net/api/';
const TIMEOUT_MS = 5000;

const [apiKeyArg, ipArg] = process.argv.slice(2);
const apiKey = apiKeyArg || process.env.IPINFO_API_KEY || '';
const ip = ipArg || process.env.IP || '';

if (!apiKey || !ip) {
  console.error('Usage: node ipinfo_failure_test.mjs <apiKey> <ip>');
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

const result = await (async () => {
  try {
    const res = await fetch(
      `${BASE_URL}?key=${encodeURIComponent(apiKey)}&ip=${encodeURIComponent(ip)}`,
      {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );

    const httpCode = res.status;
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const errorCode =
        data && typeof data === 'object' && 'code' in data ? data.code : 'UNKNOWN_ERROR';
      const message =
        data && typeof data === 'object' && 'message' in data ? data.message : '';
      const resolution =
        data && typeof data === 'object' && 'resolution' in data ? data.resolution : '';
      return {
        ok: false,
        httpCode,
        errorCode,
        message,
        resolution,
      };
    }

    return { ok: true, httpCode };
  } catch (err) {
    const isAbort =
      err instanceof DOMException
        ? err.name === 'AbortError'
        : (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError');
    return {
      ok: false,
      httpCode: 0,
      errorCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: isAbort ? 'Request timed out' : 'Network error',
      resolution: 'Check network connectivity or try again later',
    };
  } finally {
    clearTimeout(timeout);
  }
})();

if (result.ok) {
  console.log(`OK http_code=${result.httpCode}`);
  process.exit(0);
}

console.log(
  [
    `FAIL http_code=${result.httpCode}`,
    `code=${result.errorCode}`,
    `message=${result.message}`,
    `resolution=${result.resolution}`,
  ].join(' ')
);

process.exit(1);
