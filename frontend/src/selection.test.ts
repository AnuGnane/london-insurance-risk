import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every user action that changes the panel bumps selectionId, so a late answer
// from an earlier action (a postcode lookup, a "Near me" fix) sees it is stale
// and drops itself instead of reopening the panel.
const src = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

/** The body of `const <name> = ...`, by brace-matching from its first `{`. */
function handlerBody(name: string): string {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`${name} not found in App.tsx`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`${name} has no closing brace`);
}

// Excluded: showPostcodeHit is a useCallback the handlers call after bumping;
// restoreArea is the initial-link restore inside an effect, not a user action.
const handlers = [
  'handleSearch',
  'handleMapClick',
  'handleSelectRanking',
  'handleNearMe',
  'clearDetail',
];

describe('user actions that set the panel bump selectionId', () => {
  it.each(handlers)('%s bumps selectionId', (name) => {
    const body = handlerBody(name);
    expect(body).toContain('setDetail(');
    expect(body).toMatch(/selectionId\.current\+\+|\+\+selectionId\.current/);
  });
});
