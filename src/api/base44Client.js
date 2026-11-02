async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = response.status === 204 ? null : await response.json();
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
      filter: (query = {}, options = {}) => request(`${path}/filter`, { method: 'POST', body: { query, options } }),
      count: (query = {}) => request(`${path}/count`, { method: 'POST', body: { query } }),
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

export const base44 = {
  entities,
  functions: {
    invoke: async (name, payload = {}) => ({
      data: await request(`/functions/${encodeURIComponent(name)}`, { method: 'POST', body: payload }),
    }),
  },
  auth: {
    loginViaEmailPassword: (username, password) =>
      request('/auth/login', { method: 'POST', body: { username, password } }),
    me: () => request('/auth/me'),
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
    redirectToLogin: (returnTo) => {
      const path = returnTo && new URL(returnTo, window.location.origin).origin === window.location.origin
        ? `${window.location.pathname}${window.location.search}`
        : '/';
      window.location.assign(`/login?returnTo=${encodeURIComponent(path)}`);
    },
  },
};
