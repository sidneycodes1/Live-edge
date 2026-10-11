import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toJsonSchema } from '../src/services/llm/schema.js';

describe('llm schema converter (Gemini uppercase → standard JSON Schema)', () => {
  it('normalises the engine RESPONSE_SCHEMA recursively', () => {
    const gemini = {
      type: 'OBJECT',
      properties: {
        markets: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              liveItemId: { type: 'STRING' },
              question: { type: 'STRING' },
            },
            required: ['liveItemId', 'question'],
          },
        },
      },
      required: ['markets'],
    };
    const out = toJsonSchema(gemini);
    assert.equal(out.type, 'object');
    assert.equal(out.properties.markets.type, 'array');
    assert.equal(out.properties.markets.items.type, 'object');
    assert.equal(out.properties.markets.items.properties.liveItemId.type, 'string');
    assert.deepEqual(out.required, ['markets'], 'required array copied through unchanged');
    assert.deepEqual(out.properties.markets.items.required, ['liveItemId', 'question']);
  });

  it('passes an already-lowercase type through untouched', () => {
    assert.deepEqual(toJsonSchema({ type: 'string' }), { type: 'string' });
  });

  it('maps every scalar type and leaves unknown keys intact', () => {
    const out = toJsonSchema({
      type: 'OBJECT',
      properties: {
        a: { type: 'NUMBER', minimum: 0 },
        b: { type: 'INTEGER' },
        c: { type: 'BOOLEAN' },
      },
    });
    assert.equal(out.properties.a.type, 'number');
    assert.equal(out.properties.a.minimum, 0, 'unknown sibling key preserved');
    assert.equal(out.properties.b.type, 'integer');
    assert.equal(out.properties.c.type, 'boolean');
  });

  it('handles arrays of nodes and primitives without crashing', () => {
    assert.deepEqual(toJsonSchema([{ type: 'STRING' }, { type: 'OBJECT' }]), [{ type: 'string' }, { type: 'object' }]);
    assert.equal(toJsonSchema('x'), 'x');
    assert.equal(toJsonSchema(null), null);
  });
});
