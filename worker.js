/**
 * EYES — Cloudflare Worker backend
 * 
 * Routes:
 *   POST /api/join         — join a session
 *   POST /api/leave        — leave a session
 *   POST /api/capture      — submit frames from phone camera
 *   POST /api/observe      — post an observation to the log
 *   GET  /api/session/:id  — get full session state
 *   POST /api/session/new  — create a new session (called automatically by join if needed)
 * 
 * KV namespace: EYES_KV (bind in Cloudflare dashboard)
 * Sessions expire after 24 hours of inactivity.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SESSION_TTL_SECONDS = 86400; // 24 hours
const MAX_LOG_ENTRIES = 100;
const MAX_FRAMES_STORED = 6; // keep only the most recent burst

// ── ENTRY POINT ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Route matching
    try {
      if (path === '/api/session/new' && request.method === 'POST') {
        return await handleNewSession(request, env);
      }
      if (path === '/api/join' && request.method === 'POST') {
        return await handleJoin(request, env);
      }
      if (path === '/api/leave' && request.method === 'POST') {
        return await handleLeave(request, env);
      }
      if (path === '/api/capture' && request.method === 'POST') {
        return await handleCapture(request, env);
      }
      if (path === '/api/observe' && request.method === 'POST') {
        return await handleObserve(request, env);
      }
      if (path.startsWith('/api/session/') && request.method === 'GET') {
        const sessionId = path.replace('/api/session/', '');
        return await handleGetSession(sessionId, env);
      }
      if (path === '/api/health') {
        return json({ ok: true, ts: Date.now() });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error', detail: err.message }, 500);
    }
  }
};

// ── HANDLERS ─────────────────────────────────────────────────────────────────

async function handleNewSession(request, env) {
  const body = await request.json().catch(() => ({}));
  const sessionId = generateId();
  const now = Date.now();

  const session = {
    id: sessionId,
    created_at: now,
    updated_at: now,
    narrator: body.narrator || null,
    passengers: body.narrator ? [body.narrator] : [],
    log: [],
    frames: [],
  };

  await saveSession(env, sessionId, session);

  return json({ ok: true, session_id: sessionId, session });
}

async function handleJoin(request, env) {
  const body = await request.json();
  const { name, session_id } = body;

  if (!name) return json({ error: 'name required' }, 400);

  let sessionId = session_id;
  let session;

  if (sessionId) {
    session = await getSession(env, sessionId);
    if (!session) return json({ error: 'session not found' }, 404);
  } else {
    // Create a new session
    sessionId = generateId();
    session = {
      id: sessionId,
      created_at: Date.now(),
      updated_at: Date.now(),
      narrator: name, // first to join becomes narrator
      passengers: [],
      log: [],
      frames: [],
    };
  }

  // Add passenger if not already present
  if (!session.passengers.includes(name)) {
    session.passengers.push(name);
  }

  // First passenger becomes narrator
  if (!session.narrator) {
    session.narrator = name;
  }

  addLogEntry(session, {
    type: 'system',
    author: 'EYES',
    content: `${name} joined the session.`,
  });

  session.updated_at = Date.now();
  await saveSession(env, sessionId, session);

  return json({
    ok: true,
    session_id: sessionId,
    narrator: session.narrator,
    passengers: session.passengers,
  });
}

async function handleLeave(request, env) {
  const body = await request.json();
  const { session_id, name } = body;

  if (!session_id || !name) return json({ error: 'session_id and name required' }, 400);

  const session = await getSession(env, session_id);
  if (!session) return json({ error: 'session not found' }, 404);

  session.passengers = session.passengers.filter(p => p !== name);

  // If narrator left, assign to next passenger
  if (session.narrator === name) {
    session.narrator = session.passengers[0] || null;
  }

  addLogEntry(session, {
    type: 'system',
    author: 'EYES',
    content: `${name} left the session.`,
  });

  session.updated_at = Date.now();
  await saveSession(env, session_id, session);

  return json({ ok: true, session_id, passengers: session.passengers, narrator: session.narrator });
}

async function handleCapture(request, env) {
  const body = await request.json();
  const { session_id, author, frames, mode } = body;

  if (!session_id || !author || !frames?.length) {
    return json({ error: 'session_id, author, and frames required' }, 400);
  }

  const session = await getSession(env, session_id);
  if (!session) return json({ error: 'session not found' }, 404);

  // Store frames (keep only most recent burst to avoid KV bloat)
  session.frames = frames.slice(-MAX_FRAMES_STORED);

  const frameCount = frames.length;
  const modeLabel = mode === 'burst' ? `burst of ${frameCount} frames` : '1 frame';
  const thumb = frames[0]; // first frame as thumbnail for log

  addLogEntry(session, {
    type: 'capture',
    author,
    content: `Captured ${modeLabel}.`,
    thumb,
    frame_count: frameCount,
    mode: mode || 'single',
  });

  session.updated_at = Date.now();
  await saveSession(env, session_id, session);

  return json({ ok: true, session_id, frame_count: frameCount });
}

async function handleObserve(request, env) {
  const body = await request.json();
  const { session_id, author, content } = body;

  if (!session_id || !author || !content) {
    return json({ error: 'session_id, author, and content required' }, 400);
  }

  const session = await getSession(env, session_id);
  if (!session) return json({ error: 'session not found' }, 404);

  addLogEntry(session, {
    type: 'observation',
    author,
    content,
  });

  session.updated_at = Date.now();
  await saveSession(env, session_id, session);

  return json({ ok: true, session_id, log_length: session.log.length });
}

async function handleGetSession(sessionId, env) {
  if (!sessionId) return json({ error: 'session_id required' }, 400);

  const session = await getSession(env, sessionId);
  if (!session) return json({ error: 'session not found' }, 404);

  return json({
    ok: true,
    session_id: sessionId,
    narrator: session.narrator,
    passengers: session.passengers,
    log: session.log,
    frames: session.frames,
    updated_at: session.updated_at,
  });
}

// ── KV HELPERS ───────────────────────────────────────────────────────────────

async function getSession(env, sessionId) {
  const raw = await env.EYES_KV.get(`session:${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveSession(env, sessionId, session) {
  await env.EYES_KV.put(
    `session:${sessionId}`,
    JSON.stringify(session),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────

function addLogEntry(session, entry) {
  session.log.push({
    ...entry,
    ts: Date.now(),
  });
  // Trim to max entries, keeping most recent
  if (session.log.length > MAX_LOG_ENTRIES) {
    session.log = session.log.slice(-MAX_LOG_ENTRIES);
  }
}

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
