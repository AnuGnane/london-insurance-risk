import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CALLOUT_COPY,
  loadCalloutDismissed,
  saveCalloutDismissed,
  shouldShowCallout,
} from './callout';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const squash = (s: string) => s.replace(/\s+/g, ' ');

// README prose without its markdown bold; the About intro without its tags and
// without the area-count expression (the count is not part of the copy).
const readme = squash(read('../../README.md').replace(/\*\*/g, ''));
const aboutSrc = read('./AboutPanel.tsx');
const introJsx = aboutSrc.match(/<p className="about-intro">([\s\S]*?)<\/p>/)?.[1] ?? '';
const aboutIntro = squash(
  introJsx
    .replace(/\{areaCount[^}]*\}[^}]*\}/g, '')
    .replace(/\{' '\}/g, ' ')
    .replace(/<[^>]+>/g, ''),
).trim();

class MemoryStorage {
  store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
}

describe('shouldShowCallout', () => {
  it('shows only on an undismissed landing', () => {
    expect(shouldShowCallout(false, false)).toBe(true);
    expect(shouldShowCallout(true, false)).toBe(false);
    expect(shouldShowCallout(false, true)).toBe(false);
    expect(shouldShowCallout(true, true)).toBe(false);
  });
});

describe('callout copy', () => {
  it('reads the About intro', () => {
    expect(aboutIntro).toContain('not an insurance quote');
  });
  it.each(CALLOUT_COPY)('"%s" is quoted from the README or the About intro', (s) => {
    expect(readme.includes(s) || aboutIntro.includes(s)).toBe(true);
  });
  it('carries no figure', () => {
    for (const s of CALLOUT_COPY) expect(s).not.toMatch(/\d/);
  });
});

describe('callout dismissal storage', () => {
  it('round-trips one boolean', () => {
    const storage = new MemoryStorage();
    expect(loadCalloutDismissed(storage)).toBe(false);
    saveCalloutDismissed(storage);
    expect(loadCalloutDismissed(storage)).toBe(true);
    expect([...storage.store.values()]).toEqual(['1']);
  });
  it('works without storage', () => {
    expect(loadCalloutDismissed(null)).toBe(false);
    expect(() => saveCalloutDismissed(null)).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(loadCalloutDismissed(throwing)).toBe(false);
    expect(() => saveCalloutDismissed(throwing)).not.toThrow();
  });
});
