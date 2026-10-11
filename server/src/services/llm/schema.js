// ---------------------------------------------------------------------------
// Schema shape translation for the LLM failover chain.
//
// The market engine defines its output contract in Gemini's native style
// (server/src/services/marketEngine.js → RESPONSE_SCHEMA): type names are UPPERCASE
// ('OBJECT' | 'ARRAY' | 'STRING' | ...). That is what the Gemini client sends
// verbatim as `responseSchema`. Cloudflare Workers AI and OpenRouter follow the
// OpenAI convention instead: STANDARD JSON Schema with LOWERCASE type names, passed
// as `response_format.json_schema.schema`.
//
// This module converts the one canonical (Gemini-style) schema the engine already
// produces into standard JSON Schema, so a single schema definition serves all three
// providers. It is a pure, total function: unknown keys are copied through, only the
// `type` value is normalised, and nested `properties` / `items` recurse. It never
// invents fields — a provider that ignores the schema still gets the same prompt, and
// the engine validates the returned objects regardless (§4 honesty: schema is a
// steer, not a trust boundary).
// ---------------------------------------------------------------------------

const TYPE_MAP = {
  OBJECT: 'object',
  ARRAY: 'array',
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  NULL: 'null',
};

function normalizeType(t) {
  if (typeof t !== 'string') return t;
  return TYPE_MAP[t.toUpperCase()] ?? t.toLowerCase();
}

// Recursively convert a Gemini-style schema node to standard JSON Schema.
export function toJsonSchema(node) {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') out.type = normalizeType(value);
    else if (key === 'properties') out.properties = mapValues(value, toJsonSchema);
    else if (key === 'items') out.items = toJsonSchema(value);
    else out[key] = value;
  }
  return out;
}

function mapValues(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = fn(v);
  return out;
}
