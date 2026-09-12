'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const LOG_FILE = process.env.LOG_FILE || path.join(process.cwd(), 'field-events.ndjson');

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

async function resolveWithModel(body) {
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

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(apiBody)
  });
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
      endpoints: ['/resolve', '/field-event', '/health']
    });
  }

  if (req.method === 'POST' && url.pathname === '/resolve') {
    try {
      const body = validateClientPayload(await readJson(req));
      const started = Date.now();
      const resolution = await resolveWithModel(body);
      return sendJson(req, res, 200, {
        resolver: 'six_questions_model',
        model: OPENAI_MODEL,
        latency_ms: Date.now() - started,
        ...resolution
      });
    } catch (e) {
      return sendJson(req, res, 500, { ok: false, error: String(e.message || e) });
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
});
