'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

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

const conversationSchema = {
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
    response_mode: { type: 'string', enum: ['clip', 'generated', 'silence'] },
    selected_clip: { type: ['string', 'null'] },
    response_text: { type: ['string', 'null'] },
    resolution_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    selection_reason: { type: 'string' }
  },
  required: [
    ...QUESTION_KEYS,
    'response_warranted',
    'response_mode',
    'selected_clip',
    'response_text',
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
- Keep claims concise and auditable.`;

const conversationInstructions = `You are the live conversation layer for Contentstream's Round Rock 1878 field experience.

You must first resolve the visitor's speech using the Six Questions, then decide whether Jeb should speak.

Six Questions:
1. What happened?
2. What is this about?
3. What does this support?
4. What remains unknown or contested?
5. What state changes are justified?
6. What response is now warranted, if any?

Transformation Integrity:
- The visitor's utterance is evidence that the utterance occurred. Do not promote its claims to world fact without support.
- Use ONLY facts supplied in current_context.warranted_world_facts, prior conversation events, and the visitor's current utterance as a claim/belief.
- Preserve UNKNOWN and CONTESTED states. Never invent missing historical facts, locations, motives, private knowledge, or future events.
- Do not make Jeb omniscient about the modern physical world. If a question requires modern route/safety knowledge not supplied in context, Jeb should admit he cannot know it from his side of the world.
- Silence is a valid response. Do not fill space merely because the visitor spoke.
- If an authored recording in expression_catalog is an exact fit, prefer it by setting response_mode="clip" and selected_clip to that clip id.
- Otherwise, if Jeb has sufficient reason to answer, set response_mode="generated" and write response_text.
- If no response is warranted, set response_mode="silence", selected_clip=null, response_text=null.

Jeb:
- Jeb is a fictionalized 1878 Round Rock livery owner. He is a person in the world, not a narrator or tour guide.
- He knows more than he says. He is practical, observant, dry, lightly teasing, and comfortable with silence.
- His speech is concise and conversational. Usually 1-3 short sentences, generally under 45 words unless the visitor directly asks for a fuller explanation.
- No theatrical cowboy dialect, no museum voice, no modern AI phrasing, no exposition dump.
- He may answer with a question, a dry joke, a correction, an opinion, or a compact explanation when grounded.
- Let relationship history affect tone only when prior events support it. Do not invent callbacks or memories.
- A small shift in seriousness should be expressed with fewer words and tighter attention, not melodrama.

The authored route still owns required dramatic beats. Live conversation fills the space between them; it must not force progression to the next anchor.`;

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
  if (!Array.isArray(body.expression_catalog)) body.expression_catalog = [];
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

function enforceConversationBoundary(result, catalog) {
  const allowed = new Set((catalog || []).map(x => x && x.clip).filter(Boolean));
  if (result.selected_clip && !allowed.has(result.selected_clip)) {
    result.selection_reason = `Rejected unregistered clip ${result.selected_clip}. ${result.selection_reason || ''}`.trim();
    result.selected_clip = null;
    if (result.response_text && result.response_warranted) result.response_mode = 'generated';
    else result.response_mode = 'silence';
  }
  if (!result.response_warranted) {
    result.response_mode = 'silence';
    result.selected_clip = null;
    result.response_text = null;
  }
  if (result.response_mode === 'clip' && !result.selected_clip) {
    result.response_mode = result.response_text ? 'generated' : 'silence';
  }
  if (result.response_mode === 'generated') {
    const text = String(result.response_text || '').trim();
    result.response_text = text ? text.slice(0, 800) : null;
    if (!result.response_text) result.response_mode = 'silence';
    result.selected_clip = null;
  }
  if (result.response_mode === 'silence') {
    result.selected_clip = null;
    result.response_text = null;
  }
  return result;
}

async function callOpenAI({ body, instructions, schema, schemaName, requestId }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server');
  const apiBody = {
    model: OPENAI_MODEL,
    reasoning: { effort: 'low' },
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: instructions }] },
      { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(body) }] }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema
      }
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  let response;
  try {
    console.log(`[${schemaName} ${requestId}] OpenAI request start model=${OPENAI_MODEL}`);
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
    if (e && e.name === 'AbortError') throw new Error(`OpenAI request timed out after ${RESOLVE_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
  const text = extractOutputText(data);
  if (!text) throw new Error('Model returned no structured output text');
  try { return JSON.parse(text); }
  catch { throw new Error('Model returned invalid JSON'); }
}

async function resolveWithModel(body, requestId) {
  const parsed = await callOpenAI({
    body,
    instructions: resolverInstructions,
    schema: resolutionSchema,
    schemaName: 'contentstream_six_question_resolution',
    requestId
  });
  return enforceExpressionBoundary(parsed, body.expression_catalog);
}

async function converseWithModel(body, requestId) {
  const parsed = await callOpenAI({
    body,
    instructions: conversationInstructions,
    schema: conversationSchema,
    schemaName: 'contentstream_live_conversation',
    requestId
  });
  return enforceConversationBoundary(parsed, body.expression_catalog);
}

function appendEvents(payload) {
  const receivedAt = new Date().toISOString();
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) return 0;
  const lines = events.map(e => JSON.stringify({ ...e, received_at: receivedAt })).join('\n') + '\n';
  fs.appendFileSync(LOG_FILE, lines, 'utf8');
  return events.length;
}

async function proxySpeechify(req, res, text, voiceOverride = '') {
  if (!SPEECHIFY_API_KEY) return sendJson(req, res, 503, { ok: false, error: 'SPEECHIFY_API_KEY is not configured on the server' });
  const voiceId = String(voiceOverride || SPEECHIFY_VOICE_ID || '').trim();
  if (!voiceId) return sendJson(req, res, 503, { ok: false, error: 'SPEECHIFY_VOICE_ID is not configured on the server' });
  const input = String(text || '').trim();
  if (!input) return sendJson(req, res, 400, { ok: false, error: 'text is required' });
  if (input.length > 2000) return sendJson(req, res, 400, { ok: false, error: 'text is too long for this field prototype' });

  const speechResp = await fetch('https://api.speechify.ai/v1/audio/stream', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SPEECHIFY_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      input,
      voice_id: voiceId,
      model: SPEECHIFY_MODEL,
      language: 'en-US'
    })
  });

  if (!speechResp.ok || !speechResp.body) {
    const errText = await speechResp.text().catch(() => '');
    return sendJson(req, res, speechResp.status || 502, { ok: false, error: errText || `Speechify HTTP ${speechResp.status}` });
  }

  res.writeHead(200, {
    ...corsHeaders(req),
    'Content-Type': speechResp.headers.get('content-type') || 'audio/mpeg',
    'Transfer-Encoding': 'chunked',
    'Speechify-Request-Id': speechResp.headers.get('speechify-request-id') || ''
  });
  Readable.fromWeb(speechResp.body).pipe(res);
}

async function listSpeechifyVoices(req, res) {
  if (!SPEECHIFY_API_KEY) return sendJson(req, res, 503, { ok: false, error: 'SPEECHIFY_API_KEY is not configured on the server' });
  const u = new URL('https://api.speechify.ai/v1/voices');
  u.searchParams.set('locale', 'en');
  u.searchParams.set('model', SPEECHIFY_MODEL);
  const r = await fetch(u, { headers: { 'Authorization': `Bearer ${SPEECHIFY_API_KEY}` } });
  const data = await r.json().catch(() => ({}));
  return sendJson(req, res, r.status, data);
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
      service: 'contentstream-live-conversation',
      model: OPENAI_MODEL,
      model_key_configured: Boolean(OPENAI_API_KEY),
      speechify_key_configured: Boolean(SPEECHIFY_API_KEY),
      speechify_voice_configured: Boolean(SPEECHIFY_VOICE_ID),
      speechify_voice_id: SPEECHIFY_VOICE_ID || null,
      speechify_model: SPEECHIFY_MODEL,
      endpoints: ['/resolve', '/converse', '/speak', '/speechify/voices', '/field-event', '/health']
    });
  }

  if (req.method === 'POST' && url.pathname === '/resolve') {
    const requestId = Math.random().toString(36).slice(2, 8);
    const started = Date.now();
    try {
      const body = validateClientPayload(await readJson(req));
      const resolution = await resolveWithModel(body, requestId);
      return sendJson(req, res, 200, { resolver: 'six_questions_model', model: OPENAI_MODEL, latency_ms: Date.now() - started, ...resolution });
    } catch (e) {
      return sendJson(req, res, 500, { ok: false, error: String(e?.message || e), request_id: requestId, latency_ms: Date.now() - started });
    }
  }

  if (req.method === 'POST' && url.pathname === '/converse') {
    const requestId = Math.random().toString(36).slice(2, 8);
    const started = Date.now();
    try {
      const body = validateClientPayload(await readJson(req));
      const resolution = await converseWithModel(body, requestId);
      console.log(`[converse ${requestId}] ${Date.now() - started}ms mode=${resolution.response_mode} clip=${resolution.selected_clip || '-'} text=${JSON.stringify(resolution.response_text || '')}`);
      return sendJson(req, res, 200, { resolver: 'six_questions_live_conversation', model: OPENAI_MODEL, latency_ms: Date.now() - started, ...resolution });
    } catch (e) {
      console.error(`[converse ${requestId}] ERROR: ${String(e?.message || e)}`);
      return sendJson(req, res, 500, { ok: false, error: String(e?.message || e), request_id: requestId, latency_ms: Date.now() - started });
    }
  }

  if (req.method === 'GET' && url.pathname === '/speak') {
    try { return await proxySpeechify(req, res, url.searchParams.get('text') || '', url.searchParams.get('voice_id') || ''); }
    catch (e) { return sendJson(req, res, 502, { ok: false, error: String(e?.message || e) }); }
  }

  if (req.method === 'POST' && url.pathname === '/speak') {
    try {
      const body = await readJson(req);
      return await proxySpeechify(req, res, body.text || body.input || '', body.voice_id || '');
    } catch (e) { return sendJson(req, res, 502, { ok: false, error: String(e?.message || e) }); }
  }

  if (req.method === 'GET' && url.pathname === '/speechify/voices') {
    try { return await listSpeechifyVoices(req, res); }
    catch (e) { return sendJson(req, res, 502, { ok: false, error: String(e?.message || e) }); }
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
  console.log(`Contentstream live conversation server listening on :${PORT}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Speechify: ${SPEECHIFY_MODEL} voice=${SPEECHIFY_VOICE_ID || '(not configured)'}`);
});
