import { describe, expect, it } from 'vitest';
import { resolveApiBase } from './api-base.js';

describe('resolveApiBase', () => {
  it('uses localhost only during development when unset', () => {
    expect(resolveApiBase({ value: '', dev: true })).toBe('http://localhost:4000');
  });
  it('rejects missing and localhost production configuration', () => {
    expect(() => resolveApiBase({ value: '', dev: false })).toThrow(/VITE_API_URL/);
    expect(() => resolveApiBase({ value: 'http://localhost:4000', dev: false })).toThrow(/localhost/);
  });
  it('uses an HTTPS production API', () => {
    expect(resolveApiBase({ value: 'https://api.example.test/', dev: false })).toBe('https://api.example.test');
  });
});
