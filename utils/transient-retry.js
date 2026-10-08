// Retry provider calls that fail for temporary reasons (model overloaded, dropped connection).
// Quota errors (429) are not retried: on a free tier they usually mean "not included", not "busy".
const TRANSIENT_MESSAGE = /"code":\s*50[0234]\b|UNAVAILABLE|high demand|overloaded|fetch failed|socket hang up/i;
const TRANSIENT_CAUSE = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)/;

function isTransientError(error) {
  if (!error) return false;
  if ([500, 502, 503, 504].includes(Number(error.status))) return true;
  if (TRANSIENT_MESSAGE.test(String(error.message || ''))) return true;
  return TRANSIENT_CAUSE.test(`${error.cause?.code || ''} ${error.cause?.message || ''}`);
}

function isQuotaError(error) {
  if (!error) return false;
  return Number(error.status) === 429 || /"code":\s*429\b|RESOURCE_EXHAUSTED/i.test(String(error.message || ''));
}

async function retryTransient(fn, options = {}) {
  const {
    attempts = 3,
    delaysMs = [5000, 15000],
    logger = null,
    label = 'Provider request',
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  } = options;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isTransientError(error)) throw error;
      const delay = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)];
      logger?.warn?.(`${label} failed temporarily; retrying in ${delay / 1000}s (attempt ${attempt + 1} of ${attempts})`);
      await sleep(delay);
    }
  }
}

// An AI step that could not run. Raised instead of quietly using template text.
class AiStepError extends Error {
  constructor(step, cause) {
    const reason = String(cause?.message || cause || 'unknown error').slice(0, 300);
    super(`${step} failed: ${reason}. Free Gemini limits may be used up — try again after about 1 PM.`);
    this.name = 'AiStepError';
    this.code = 'AI_STEP_FAILED';
    this.step = step;
    this.cause = cause;
  }
}

module.exports = { isTransientError, isQuotaError, retryTransient, AiStepError };
