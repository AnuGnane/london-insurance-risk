import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every user action that changes the panel bumps selectionId, so a "Near me" fix
// that lands after a later action sees it is stale and drops itself instead of
// reopening the panel.
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

describe('clearDetail', () => {
  it('is memoised, so the Escape listener is not re-registered on every App render', () => {
    expect(src).toMatch(/const clearDetail = useCallback\(\(\) => \{/);
  });
});

// Escape closes the panel (keyboard.ts's escapeAction) and hands focus back to
// the search box, as "Back to rankings" does.
describe('Escape in Sidebar.tsx', () => {
  const sidebar = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
  it('registers and removes the keydown listener in the same effect', () => {
    const effect = sidebar.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\);/g) ?? [];
    const esc = effect.find((e) => e.includes('escapeAction('));
    expect(esc).toBeDefined();
    expect(esc).toMatch(/window\.addEventListener\('keydown', (\w+)\)/);
    const name = esc!.match(/window\.addEventListener\('keydown', (\w+)\)/)![1];
    expect(esc).toContain(`return () => window.removeEventListener('keydown', ${name})`);
  });
  it('follows onClear with the focus call, for Escape and the Back button', () => {
    expect(sidebar).toMatch(/const closeDetail = [^\n]*\n\s*onClear\(\);\n\s*inputRef\.current\?\.focus\(\);/);
    expect(sidebar).toMatch(/action === 'close'\) closeDetail\(\)/);
    expect(sidebar).toContain('onClick={closeDetail}');
    expect(sidebar.match(/onClear\(/g)).toHaveLength(1);
    expect(sidebar).not.toMatch(/onClick=\{onClear\}/);
  });
  it('lets Escape from the search box close the panel (focus stays there after a search)', () => {
    expect(sidebar).toContain('inTextField: e.target !== inputRef.current && isTextField(e.target)');
  });
});
