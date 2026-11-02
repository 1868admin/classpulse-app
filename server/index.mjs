import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFirstAdmin,
  getActor,
  getTokenFromRequest,
  isInitialAdminSetupAvailable,
  isFirstRun,
  revokeSession,
  recoverInitialAdmin,
  signIn,
} from './auth.mjs';
import {
  createRecord,
  database,
  deleteRecord,
  entityDefinitions,
  getRecord,
  isPostgresMode,
  updateRecord,
  withRequestDatabase,
  withTransaction,
} from './database.mjs';
import { paginate, queryRecords } from './query.mjs';
import { invokeFunction } from './functions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(root, 'dist');
const host = process.env.CLASSPULSE_HOST || '127.0.0.1';
const port = Number(process.env.CLASSPULSE_PORT || 4400);
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const requestBodyCache = new WeakMap();

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function respond(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  response.end(value === null ? '' : JSON.stringify(value));
}

function cookieHeader(token, request) {
  const req = request || {};
  const headers = req.headers || {};
  const forwardedProtocol = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const socket = req.socket;
  const isEncrypted = socket ? Boolean(socket.encrypted) : false;
  const secure = isEncrypted || process.env.VERCEL === '1' || forwardedProtocol === 'https'
    ? '; Secure'
    : '';
  return `classpulse_session=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearCookieHeader() {
  return 'classpulse_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
}

async function readJson(request) {
  if (requestBodyCache.has(request)) return structuredClone(requestBodyCache.get(request));
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body is too large'), { status: 413 });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    requestBodyCache.set(request, {});
    return {};
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requestBodyCache.set(request, body);
    return body;
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 });
  }
}

function requireActor(actor) {
  if (!actor) throw Object.assign(new Error('Authentication required'), { status: 401 });
  return actor;
}

function requireEntity(entity) {
  if (!entityDefinitions.has(entity)) {
    throw Object.assign(new Error(`Unknown entity: ${entity}`), { status: 404 });
  }
}

function ensureRecordAccess(entity, record, actor) {
  if (entity === 'User') {
    if (record.id !== actor.user.id) throw Object.assign(new Error('Record not found'), { status: 404 });
    return;
  }
  if (actor.user.role === 'admin') return;
  const allowed = entity === 'School'
    ? record.id === actor.schoolId
    : !!actor.schoolId && record.school_id === actor.schoolId;
  if (!allowed) throw Object.assign(new Error('Record not found'), { status: 404 });
}

function ensureWritePermission(entity, record, actor, operation) {
  if (['AuditLog', 'AttendanceRecord', 'AttendanceSession', 'ImportJob', 'User', 'SchoolMember'].includes(entity)) {
    throw Object.assign(new Error(`${entity} records can only be changed through the local app workflows`), { status: 403 });
  }
  if (entity === 'School') {
    if (operation === 'create' && actor.user.role !== 'admin') {
      throw Object.assign(new Error('Only the local administrator can create a school'), { status: 403 });
    }
    if (operation !== 'create' && actor.user.role !== 'admin' && actor.member?.role !== 'school_admin') {
      throw Object.assign(new Error('Only a school administrator can change school settings'), { status: 403 });
    }
    if (operation !== 'create') ensureRecordAccess(entity, record, actor);
    return;
  }
  if (entity === 'Student' && operation === 'create') {
    throw Object.assign(new Error('Create students through the student management workflow'), { status: 403 });
  }
  if (entity === 'Student' && !['school_admin', 'it_admin'].includes(actor.member?.role)
    && actor.user.role !== 'admin') {
    throw Object.assign(new Error('Only school administrators and IT administrators can edit student records'), { status: 403 });
  }
  if (actor.user.role === 'admin') return;
  if (!actor.schoolId) throw Object.assign(new Error('You are not attached to an active school'), { status: 403 });
  const schoolId = record?.school_id;
  if (schoolId !== actor.schoolId) {
    throw Object.assign(new Error('You cannot change records outside your school'), { status: 403 });
  }
  if (entity === 'SchoolMember' && !['school_admin', 'it_admin'].includes(actor.member?.role)) {
    throw Object.assign(new Error('Only school administrators can manage staff accounts'), { status: 403 });
  }
}

function applyQuery(entity, actor, query) {
  const rows = queryRecords(entity, actor, query);
  return rows;
}

async function handleAuth(request, response, parts) {
  const method = request.method;
  if (parts[2] === 'setup-status' && method === 'GET') {
    respond(response, 200, {
      needs_setup: isFirstRun(),
      setup_available: isInitialAdminSetupAvailable(),
      requires_setup_token: process.env.VERCEL === '1' || Boolean(process.env.INITIAL_ADMIN_SETUP_TOKEN),
    });
    return true;
  }
  if (parts[2] === 'setup' && method === 'POST') {
    const body = await readJson(request);
    const result = createFirstAdmin(body);
    respond(response, 201, { user: result.user }, { 'Set-Cookie': cookieHeader(result.session.token, request) });
    return true;
  }
  if (parts[2] === 'recover-admin' && method === 'POST') {
    const body = await readJson(request);
    const result = recoverInitialAdmin(body);
    respond(response, 200, result);
    return true;
  }
  if (parts[2] === 'login' && method === 'POST') {
    const body = await readJson(request);
    const session = signIn(body.username, body.password, request.socket?.remoteAddress || '');
    respond(response, 200, { ok: true }, { 'Set-Cookie': cookieHeader(session.token, request) });
    return true;
  }
  if (parts[2] === 'logout' && method === 'POST') {
    revokeSession(getTokenFromRequest(request));
    respond(response, 200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
    return true;
  }
  if (parts[2] === 'me' && method === 'GET') {
    const actor = requireActor(getActor(request));
    respond(response, 200, actor.user);
    return true;
  }
  return false;
}

function pathParts(url) {
  return url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

async function handleEntity(request, response, parts) {
  const entity = parts[2];
  requireEntity(entity);
  const actor = requireActor(getActor(request));
  const action = parts[3];
  const method = request.method;

  if (action === 'filter' && method === 'POST') {
    const { query = {}, options = {} } = await readJson(request);
    const result = paginate(applyQuery(entity, actor, query), options);
    respond(response, 200, result);
    return true;
  }
  if (action === 'count' && method === 'POST') {
    const { query = {} } = await readJson(request);
    respond(response, 200, applyQuery(entity, actor, query).length);
    return true;
  }
  if (action === 'bulk' && method === 'POST') {
    const incoming = await readJson(request);
    if (!Array.isArray(incoming) || incoming.length > 2000) {
      throw Object.assign(new Error('Bulk create expects an array of no more than 2,000 records'), { status: 400 });
    }
    const created = withTransaction(() => incoming.map((record) => {
      ensureWritePermission(entity, record, actor, 'create');
      return createRecord(entity, record);
    }));
    respond(response, 201, created);
    return true;
  }
  if (action === 'update-many' && method === 'PATCH') {
    const { query = {}, update = {} } = await readJson(request);
    const patch = update.$set || update;
    if (entity === 'Student' && !['school_admin', 'it_admin'].includes(actor.member?.role)
      && actor.user.role !== 'admin') {
      throw Object.assign(new Error('Only school administrators and IT administrators can edit student records'), { status: 403 });
    }
    if (entity === 'Student' && patch.student_id_no !== undefined) {
      throw Object.assign(new Error('Student IDs cannot be changed through bulk updates'), { status: 403 });
    }
    if (entity === 'Student' && Object.hasOwn(patch, 'birth_paper_no')
      && !['school_admin', 'it_admin'].includes(actor.member?.role) && actor.user.role !== 'admin') {
      throw Object.assign(new Error('Only school administrators and IT administrators can manage birth paper numbers'), { status: 403 });
    }
    const matches = applyQuery(entity, actor, query);
    const updated = withTransaction(() => matches.map((record) => {
      ensureWritePermission(entity, record, actor, 'update');
      return updateRecord(entity, record.id, patch);
    }));
    respond(response, 200, { updated: updated.length });
    return true;
  }
  if (action === 'delete-many' && method === 'POST') {
    const { query = {} } = await readJson(request);
    const matches = applyQuery(entity, actor, query);
    const deleted = withTransaction(() => matches.filter((record) => {
      ensureWritePermission(entity, record, actor, 'delete');
      return deleteRecord(entity, record.id);
    }).length);
    respond(response, 200, { deleted });
    return true;
  }
  if (!action && method === 'POST') {
    const record = await readJson(request);
    ensureWritePermission(entity, record, actor, 'create');
    respond(response, 201, createRecord(entity, record));
    return true;
  }
  if (!action || action === 'bulk' || action === 'filter' || action === 'count') return false;

  const recordId = action;
  if (method === 'GET') {
    const record = getRecord(entity, recordId);
    if (!record) throw Object.assign(new Error('Record not found'), { status: 404 });
    ensureRecordAccess(entity, record, actor);
    if (entity === 'Student' && !['school_admin', 'it_admin'].includes(actor.member?.role) && actor.user.role !== 'admin') {
      const { birth_paper_no, ...visibleRecord } = record;
      respond(response, 200, visibleRecord);
    } else {
      respond(response, 200, record);
    }
    return true;
  }
  if (method === 'PATCH') {
    const record = getRecord(entity, recordId);
    if (!record) throw Object.assign(new Error('Record not found'), { status: 404 });
    ensureWritePermission(entity, record, actor, 'update');
    const patch = await readJson(request);
    if (entity === 'Student' && patch.student_id_no !== undefined && patch.student_id_no !== record.student_id_no) {
      throw Object.assign(new Error('Student IDs cannot be changed while editing a student'), { status: 403 });
    }
    if (entity === 'Student' && Object.hasOwn(patch, 'birth_paper_no')
      && !['school_admin', 'it_admin'].includes(actor.member?.role) && actor.user.role !== 'admin') {
      throw Object.assign(new Error('Only school administrators and IT administrators can manage birth paper numbers'), { status: 403 });
    }
    if (patch.school_id !== undefined && actor.user.role !== 'admin' && patch.school_id !== actor.schoolId) {
      throw Object.assign(new Error('You cannot move records outside your school'), { status: 403 });
    }
    respond(response, 200, updateRecord(entity, recordId, patch));
    return true;
  }
  if (method === 'DELETE') {
    const record = getRecord(entity, recordId);
    if (!record) throw Object.assign(new Error('Record not found'), { status: 404 });
    ensureWritePermission(entity, record, actor, 'delete');
    deleteRecord(entity, recordId);
    respond(response, 200, { ok: true });
    return true;
  }
  return false;
}

async function handleFunction(request, response, parts) {
  if (parts.length !== 3 || request.method !== 'POST') return false;
  const actor = getActor(request);
  const body = await readJson(request);
  const result = invokeFunction(parts[2], actor, body);
  respond(response, 200, result);
  return true;
}

function serveFile(request, response, pathname) {
  if (!existsSync(distDirectory)) return false;
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.resolve(distDirectory, relativePath);
  if (file !== distDirectory && !file.startsWith(`${distDirectory}${path.sep}`)) return false;
  const target = existsSync(file) && statSync(file).isFile() ? file : path.join(distDirectory, 'index.html');
  if (!existsSync(target)) return false;
  const extension = path.extname(target);
  response.writeHead(200, {
    'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(target).pipe(response);
  return true;
}

async function handleRequestCore(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  const parts = pathParts(url);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');

  try {
    if (request.method === 'OPTIONS') {
      respond(response, 204, null);
      return;
    }
    if (url.pathname === '/api/health' && request.method === 'GET') {
      respond(response, 200, { ok: true, mode: isPostgresMode ? 'postgres' : 'local', needs_setup: isFirstRun() });
      return;
    }
    if (parts[0] === 'api' && parts[1] === 'auth' && await handleAuth(request, response, parts)) return;
    if (parts[0] === 'api' && parts[1] === 'entities' && await handleEntity(request, response, parts)) return;
    if (parts[0] === 'api' && parts[1] === 'functions' && await handleFunction(request, response, parts)) return;
    if (parts[0] === 'api') {
      respond(response, 404, { error: 'API route not found' });
      return;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && serveFile(request, response, url.pathname)) return;
    respond(response, 404, { error: 'Page not found. Run npm run build before starting the production server.' });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('Local request failed:', error);
    respond(response, status, {
      error: status >= 500 && !error.expose ? 'A local server error occurred' : error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
}

function createDeferredResponse(response) {
  let status = 200;
  let body = '';
  let ended = false;
  const headers = {};
  return {
    setHeader(name, value) {
      headers[name] = value;
      return this;
    },
    writeHead(statusCode, responseHeaders = {}) {
      status = statusCode;
      Object.assign(headers, responseHeaders);
      return this;
    },
    end(value = '') {
      body = value;
      ended = true;
      return this;
    },
    reset() {
      status = 200;
      body = '';
      ended = false;
      for (const header of Object.keys(headers)) delete headers[header];
    },
    flush() {
      if (!ended) throw new Error('API handler did not produce a response');
      response.writeHead(status, headers);
      response.end(body);
    },
  };
}

export async function handleApiRequest(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  if (!isPostgresMode || !url.pathname.startsWith('/api/')) {
    await handleRequestCore(request, response);
    return;
  }

  const deferredResponse = createDeferredResponse(response);
  try {
    await withRequestDatabase(async () => {
      deferredResponse.reset();
      await handleRequestCore(request, deferredResponse);
    });
    deferredResponse.flush();
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('Cloud request failed:', error);
    respond(response, status, {
      error: status >= 500 && !error.expose ? 'A server error occurred' : error.message,
    });
  }
}

const server = createServer(handleApiRequest);

function shutdown() {
  server.close(() => {
    if (!isPostgresMode) database.close();
    process.exit(0);
  });
}

if (process.env.VERCEL !== '1') {
  server.listen(port, host, () => {
    console.log(`ClassPulse local server: http://${host}:${port}`);
    console.log(`Persistent database: ${database.name || 'data/classpulse.sqlite'}`);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
