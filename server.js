'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const LOG_FILE = process.env.LOG_FILE || path.join(process.cwd(), 'field-events.ndjson');
const RESOLVE_TIMEOUT_MS = Number(process.env.RESOLVE_TIMEOUT_MS || 30000);
const SPEECHIFY_API_KEY = process.env.SPEECHIFY_API_KEY || '';
const SPEECHIFY_VOICE_ID = process.env.SPEECHIFY_VOICE_ID || '';
const SPEECHIFY_MODEL = process.env.SPEECHIFY_MODEL || 'simba-3.2';

const QUESTION_KEYS = [
  'q1_what_happened',
  'q2_what_is_this_about',
  'q3_what_does_this_support',
  'q4_what_remains_unknown_or_contested',
  'q5_what_state_changes_are_justified',
  'q6_what_responses_are_now_warranted'
];

const evidenceItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['SUPPORTED', 'POSSIBLE', 'UNKNOWN', 'CONTESTED'] },
    claim: { type: 'string' },
    basis: { type: 'string' }
  },
  required: ['status', 'claim', 'basis']
};

const responseItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['SUPPORTED', 'POSSIBLE', 'UNKNOWN', 'CONTESTED'] },
    name: { type: 'string' },
    basis: { type: 'string' },
    clip: { type: ['string', 'null'] }
  },
  required: ['status', 'name', 'basis', 'clip']
};

const resolutionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q1_what_happened: { type: 'array', items: evidenceItemSchema },
    q2_what_is_this_about: { type: 'array', items: evidenceItemSchema },
    q3_what_does_this_support: { type: 'array', items: evidenceItemSchema },
    q4_what_remains_unknown_or_contested: { type: 'array', items: evidenceItemSchema },
    q5_what_state_changes_are_justified: { type: 'array', items: evidenceItemSchema },
    q6_what_responses_are_now_warranted: { type: 'array', items: responseItemSchema },
    response_warranted: { type: 'boolean' },
    response_available: { type: 'boolean' },
    selected_clip: { type: ['string', 'null'], enum: ['tellSee', 'water', 'trees', 'river', null] },
    resolution_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    selection_reason: { type: 'string' }
  },
  required: [
    ...QUESTION_KEYS,
    'response_warranted',
    'response_available',
    'selected_clip',
    'resolution_confidence',
    'selection_reason'
  ]
};

const resolverInstructions = `You are the semantic resolution layer for Contentstream, a stateful historical field experience.

Your job is NOT to write Jeb dialogue and NOT to control world state. Your job is to resolve one incoming actor speech event using exactly six questions:
1. What happened?
2. What is this about?
3. What does this support?
4. What remains unknown or contested?
5. What state changes are justified?
6. What responses are now warranted, if any?

Transformation Integrity rules:
- An utterance is evidence that an utterance occurred. Its proposition is not automatically true.
- Separate actor belief/claim from established world fact.
- Do not confirm Brushy Creek from speech alone when no independent location/visual evidence is registered.
- Preserve ambiguity. UNKNOWN and POSSIBLE are valid outcomes.
- A conversational request can warrant a response without changing world state.
- Silence is valid when no registered expression is sufficiently warranted.
- Never invent historical facts, location facts, or Jeb's private knowledge.
- Never generate new dialogue. You may select only a clip ID listed in expression_catalog.
- Respect clip constraints exactly. If a response is warranted but no clip fits, set response_warranted=true, response_available=false, selected_clip=null.
- Do not use keyword matching as your rationale. Resolve meaning from the event, prior exchange, and registered evidence.
- Keep claims concise and auditable.

Important phase behavior:
- In phase "locating", a plausible visual candidate such as "through the trees" or "I see water down there" may justify a candidate-found state without proving identity. If the registered clip tellSee is appropriate, it may be selected to ask for more observation.
- In phase "observing", choose an observation-specific clip only when its exact constraint is met.
- Questions such as "Where is the creek?", "Where should we go next?", "Are you there?", or safety/action questions may warrant a response, but if no registered clip can answer them, do not force a clip.`;

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allow = ALLOWED_ORIGIN === '*' ? '*' : (origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
}

function sendJson(req, res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function extractOutputText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.type === 'output_text' && typeof c.text === 'string') return c.text;
    }
  }
  return '';
}

function validateClientPayload(body) {
  if (!body || typeof body.raw_transcript !== 'string' || !body.raw_transcript.trim()) throw new Error('raw_transcript is required');
  if (!body.current_context || typeof body.current_context !== 'object') throw new Error('current_context is required');
  if (!Array.isArray(body.expression_catalog)) throw new Error('expression_catalog is required');
  return body;
}

function enforceExpressionBoundary(result, catalog) {
  const allowed = new Set((catalog || []).map(x => x && x.clip).filter(Boolean));
  if (result.selected_clip && !allowed.has(result.selected_clip)) {
    result.selection_reason = `Rejected unregistered expression ${result.selected_clip}. ${result.selection_reason || ''}`.trim();
    result.selected_clip = null;
    result.response_available = false;
  }
  if (!result.response_warranted) {
    result.selected_clip = null;
    result.response_available = false;
  }
  if (!result.selected_clip) result.response_available = false;
  return result;
}

async function resolveWithModel(body, requestId) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server');
  const apiBody = {
    model: OPENAI_MODEL,
    reasoning: { effort: 'low' },
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: resolverInstructions }] },
      { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(body) }] }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'contentstream_six_question_resolution',
        strict: true,
        schema: resolutionSchema
      }
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  let response;
  try {
    console.log(`[resolve ${requestId}] OpenAI request start model=${OPENAI_MODEL}`);
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(apiBody),
      signal: controller.signal
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`OpenAI request timed out after ${RESOLVE_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI HTTP ${response.status}`;
    throw new Error(message);
  }
  const text = extractOutputText(data);
  if (!text) throw new Error('Model returned no structured output text');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Model returned invalid JSON'); }
  return enforceExpressionBoundary(parsed, body.expression_catalog);
}

function appendEvents(payload) {
  const receivedAt = new Date().toISOString();
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) return 0;
  const lines = events.map(e => JSON.stringify({ ...e, received_at: receivedAt })).join('\n') + '\n';
  fs.appendFileSync(LOG_FILE, lines, 'utf8');
  return events.length;
}

async function listSpeechifyVoices(req, res) {
  if (!SPEECHIFY_API_KEY) {
    return sendJson(req, res, 503, { ok: false, error: 'SPEECHIFY_API_KEY is not configured on the server' });
  }
  const u = new URL('https://api.speechify.ai/v1/voices');
  u.searchParams.set('locale', 'en');
  u.searchParams.set('model', SPEECHIFY_MODEL);
  const r = await fetch(u, {
    headers: { 'Authorization': `Bearer ${SPEECHIFY_API_KEY}` }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return sendJson(req, res, r.status, data);
}

async function speechifySpeak(req, res, text, voiceOverride = '') {
  if (!SPEECHIFY_API_KEY) {
    return sendJson(req, res, 503, { ok: false, error: 'SPEECHIFY_API_KEY is not configured on the server' });
  }
  const voiceId = String(voiceOverride || SPEECHIFY_VOICE_ID || '').trim();
  if (!voiceId) {
    return sendJson(req, res, 503, { ok: false, error: 'SPEECHIFY_VOICE_ID is not configured on the server' });
  }
  const input = String(text || '').trim();
  if (!input) return sendJson(req, res, 400, { ok: false, error: 'text is required' });
  if (input.length > 2000) return sendJson(req, res, 400, { ok: false, error: 'text is too long for this prototype' });

  const r = await fetch('https://api.speechify.ai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SPEECHIFY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input,
      voice_id: voiceId,
      model: SPEECHIFY_MODEL,
      audio_format: 'mp3'
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return sendJson(req, res, r.status, { ok: false, error: data?.error || data || `Speechify HTTP ${r.status}` });
  }
  if (!data.audio_data) {
    return sendJson(req, res, 502, { ok: false, error: 'Speechify returned no audio_data' });
  }
  const audio = Buffer.from(data.audio_data, 'base64');
  res.writeHead(200, {
    ...corsHeaders(req),
    'Content-Type': 'audio/mpeg',
    'Content-Length': audio.length
  });
  res.end(audio);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(req, res, 200, {
      ok: true,
      service: 'contentstream-six-questions',
      model: OPENAI_MODEL,
      model_key_configured: Boolean(OPENAI_API_KEY),
      speechify_key_configured: Boolean(SPEECHIFY_API_KEY),
      speechify_voice_configured: Boolean(SPEECHIFY_VOICE_ID),
      speechify_model: SPEECHIFY_MODEL,
      endpoints: ['/resolve', '/speechify/voices', '/speak', '/field-event', '/health']
    });
  }

  if (req.method === 'POST' && url.pathname === '/resolve') {
    const requestId = Math.random().toString(36).slice(2, 8);
    const started = Date.now();
    console.log(`[resolve ${requestId}] incoming origin=${req.headers.origin || '-'} ip=${req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-'}`);
    try {
      const body = validateClientPayload(await readJson(req));
      const transcript = body.raw_transcript.replace(/\s+/g, ' ').trim();
      const phase = body.current_context?.phase || body.current_context?.screen || 'unknown';
      console.log(`[resolve ${requestId}] transcript=${JSON.stringify(transcript)} phase=${phase} catalog=${body.expression_catalog.length}`);
      const resolution = await resolveWithModel(body, requestId);
      const latency = Date.now() - started;
      console.log(`[resolve ${requestId}] success ${latency}ms warranted=${resolution.response_warranted} available=${resolution.response_available} clip=${resolution.selected_clip || 'none'} confidence=${resolution.resolution_confidence || 'unknown'}`);
      return sendJson(req, res, 200, {
        resolver: 'six_questions_model',
        model: OPENAI_MODEL,
        latency_ms: latency,
        ...resolution
      });
    } catch (e) {
      const latency = Date.now() - started;
      const message = String(e?.message || e);
      console.error(`[resolve ${requestId}] ERROR after ${latency}ms: ${message}`);
      if (e?.stack) console.error(`[resolve ${requestId}] stack: ${e.stack}`);
      return sendJson(req, res, 500, { ok: false, error: message, request_id: requestId, latency_ms: latency });
    }
  }

  if (req.method === 'GET' && url.pathname === '/speechify/voices') {
    try {
      return await listSpeechifyVoices(req, res);
    } catch (e) {
      return sendJson(req, res, 502, { ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/speak') {
    try {
      return await speechifySpeak(req, res, url.searchParams.get('text') || '', url.searchParams.get('voice_id') || '');
    } catch (e) {
      return sendJson(req, res, 502, { ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/speak') {
    try {
      const body = await readJson(req);
      return await speechifySpeak(req, res, body.text || body.input || '', body.voice_id || '');
    } catch (e) {
      return sendJson(req, res, 502, { ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/field-event') {
    try {
      const body = await readJson(req, 5_000_000);
      const count = appendEvents(body);
      return sendJson(req, res, 200, { ok: true, received: count });
    } catch (e) {
      return sendJson(req, res, 400, { ok: false, error: String(e.message || e) });
    }
  }

  return sendJson(req, res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Contentstream Six Questions server listening on :${PORT}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Allowed origin: ${ALLOWED_ORIGIN}`);
  console.log(`Resolve timeout: ${RESOLVE_TIMEOUT_MS}ms`);
  console.log(`Speechify configured: key=${Boolean(SPEECHIFY_API_KEY)} voice=${Boolean(SPEECHIFY_VOICE_ID)} model=${SPEECHIFY_MODEL}`);
});
