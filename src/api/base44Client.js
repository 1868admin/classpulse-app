const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only read-only calls are retried; a failed write is never silently repeated.
async function request(path, { method = 'GET', body, retries = method === 'GET' ? 2 : 0 } = {}) {
  let response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch (networkError) {
      if (attempt < retries) { await wait(400 * (attempt + 1)); continue; }
      throw Object.assign(new Error('Could not reach the ClassPulse server. Check your connection and try again.'), { cause: networkError });
    }
    if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
      await wait(400 * (attempt + 1));
      continue;
    }
    break;
  }
  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { error: 'The ClassPulse server returned an unexpected response. Check the deployment configuration.' };
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.response = { status: response.status, data };
    throw error;
  }
  return data;
}

const entities = new Proxy({}, {
  get(_target, entity) {
    if (typeof entity !== 'string') return undefined;
    const path = `/entities/${encodeURIComponent(entity)}`;
    return {
      filter: (query = {}, options = {}) => request(`${path}/filter`, { method: 'POST', body: { query, options }, retries: 2 }),
      count: (query = {}) => request(`${path}/count`, { method: 'POST', body: { query }, retries: 2 }),
      get: (id) => request(`${path}/${encodeURIComponent(id)}`),
      create: (record) => request(path, { method: 'POST', body: record }),
      bulkCreate: (records) => request(`${path}/bulk`, { method: 'POST', body: records }),
      update: (id, patch) => request(`${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      updateMany: (query, update) => request(`${path}/update-many`, { method: 'PATCH', body: { query, update } }),
      delete: (id) => request(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      deleteMany: (query) => request(`${path}/delete-many`, { method: 'POST', body: { query } }),
    };
  },
});

// Runs several read queries in one request so hosted pages load with a single database round trip.
async function queryBatch(queries) {
  const data = await request('/functions/queryBatch', { method: 'POST', body: { queries }, retries: 2 });
  return data.results;
}

export const base44 = {
  entities,
  queryBatch,
  functions: {
    invoke: async (name, payload = {}) => ({
      data: await request(`/functions/${encodeURIComponent(name)}`, { method: 'POST', body: payload }),
    }),
  },
  auth: {
    loginViaEmailPassword: (username, password) =>
      request('/auth/login', { method: 'POST', body: { username, password } }),
    linkInfo: (token) => request('/auth/link-info', { method: 'POST', body: { token } }),
    loginViaLink: (token, password) => request('/auth/link-login', { method: 'POST', body: { token, password } }),
    createFirstAdmin: (details) => request('/auth/setup', { method: 'POST', body: details }),
    recoverInitialAdmin: (details) => request('/auth/recover-admin', { method: 'POST', body: details }),
    me: () => request('/auth/me'),
    setupStatus: () => request('/auth/setup-status'),
    isAuthenticated: async () => {
      try {
        await request('/auth/me');
        return true;
      } catch (error) {
        if (error.status === 401) return false;
        throw error;
      }
    },
    logout: async (returnTo) => {
      await request('/auth/logout', { method: 'POST', body: {} });
      if (returnTo) window.location.assign('/login');
    },
    redirectToLogin: () => {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    },
  },
};
