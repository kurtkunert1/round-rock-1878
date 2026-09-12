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
    basis: { type: 'string' }
  },
  required: ['status', 'name', 'basis']
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
    response_mode: { type: 'string', enum: ['speak', 'silence'] },
    response_text: { type: ['string', 'null'] },
    resolution_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    selection_reason: { type: 'string' }
  },
  required: [
    'q1_what_happened',
    'q2_what_is_this_about',
    'q3_what_does_this_support',
    'q4_what_remains_unknown_or_contested',
    'q5_what_state_changes_are_justified',
    'q6_what_responses_are_now_warranted',
    'response_warranted',
    'response_mode',
    'response_text',
    'resolution_confidence',
    'selection_reason'
  ]
};

const resolverInstructions = `You are Contentstream's Six Questions resolver for a live historical field conversation.

There is NO authored scene progression, NO route logic, NO clip catalog, NO predetermined conversational funnel. The Six Questions are the only reasoning scaffold.

Resolve exactly one incoming visitor speech event using:
1. What happened?
2. What is this about?
3. What does this support?
4. What remains unknown or contested?
5. What state changes are justified?
6. What responses are now warranted, if any?

Transformation Integrity rules:
- The utterance proves that the utterance occurred. Its proposition is not automatically true.
- Separate visitor perception, belief, joke, question, request, or claim from established world fact.
- The browser has no camera, GPS, or independent sensory confirmation unless current_context explicitly registers it.
- Preserve ambiguity. UNKNOWN and POSSIBLE are valid outcomes.
- A greeting, joke, direct conversational question, or request can warrant a response without changing world state.
- Silence is a valid and often correct expression.
- Never invent historical facts, location facts, sensory facts, or private knowledge.
- Prior resolutions are evidence of what the system previously concluded, not independent proof that the physical world matched those conclusions.
- Do not use keyword matching as your rationale. Resolve the event in context.
- Keep all Six Questions concise and auditable.

Expression rule:
- You may write ONE short Jeb response only when Question 6 supports a response.
- If response_warranted=false, set response_mode="silence" and response_text=null.
- If response_warranted=true, set response_mode="speak" and response_text to a natural reply of at most 24 words.
- Jeb is dry, observant, human, lightly 1878 in cadence, never a parody and never omniscient.
- Jeb may acknowledge, ask for clarification, answer from registered context, tease lightly, or say he does not know.
- When the visitor reports something not independently verified (for example "I see water"), Jeb may respond to the report without converting it into established world fact.
- When a question requires missing knowledge, Jeb should admit the limit or ask for the missing evidence rather than fabricate an answer.`;

function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };
}

function sendJson(req, res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
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
      catch { reject(new Error('Invalid JSON')); }
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
  if (!body || typeof body.raw_transcript !== 'string' || !body.raw_transcript.trim()) {
    throw new Error('raw_transcript is required');
  }
  if (!body.current_context || typeof body.current_context !== 'object') {
    throw new Error('current_context is required');
  }
  return body;
}

function enforceResolution(result) {
  if (!result.response_warranted) {
    result.response_mode = 'silence';
    result.response_text = null;
  }
  if (result.response_mode === 'speak') {
    const text = typeof result.response_text === 'string' ? result.response_text.trim() : '';
    if (!text) {
      result.response_warranted = false;
      result.response_mode = 'silence';
      result.response_text = null;
      result.selection_reason = `Response was marked speak but no response text was returned. ${result.selection_reason || ''}`.trim();
    } else {
      result.response_text = text;
    }
  } else {
    result.response_text = null;
  }
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
        name: 'contentstream_six_questions_only_resolution',
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
    if (e && e.name === 'AbortError') throw new Error(`OpenAI request timed out after ${RESOLVE_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);

  const text = extractOutputText(data);
  if (!text) throw new Error('Model returned no structured output text');

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Model returned invalid JSON'); }

  return enforceResolution(parsed);
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
      service: 'contentstream-six-questions-only',
      model: OPENAI_MODEL,
      model_key_configured: Boolean(OPENAI_API_KEY),
      endpoints: ['/resolve', '/field-event', '/health']
    });
  }

  if (req.method === 'POST' && url.pathname === '/resolve') {
    const requestId = Math.random().toString(36).slice(2, 8);
    const started = Date.now();
    try {
      const body = validateClientPayload(await readJson(req));
      const transcript = body.raw_transcript.replace(/\s+/g, ' ').trim();
      console.log(`[resolve ${requestId}] transcript=${JSON.stringify(transcript)} turn=${body.current_context?.turn ?? '?'}`);
      const resolution = await resolveWithModel(body, requestId);
      const latency = Date.now() - started;
      console.log(`[resolve ${requestId}] success ${latency}ms mode=${resolution.response_mode} confidence=${resolution.resolution_confidence}`);
      return sendJson(req, res, 200, {
        resolver: 'six_questions_only',
        model: OPENAI_MODEL,
        latency_ms: latency,
        ...resolution
      });
    } catch (e) {
      const latency = Date.now() - started;
      const message = String(e?.message || e);
      console.error(`[resolve ${requestId}] ERROR after ${latency}ms: ${message}`);
      return sendJson(req, res, 500, { ok: false, error: message, request_id: requestId, latency_ms: latency });
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
  console.log(`Contentstream Six Questions Only server listening on :${PORT}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Allowed origin: ${ALLOWED_ORIGIN}`);
});
