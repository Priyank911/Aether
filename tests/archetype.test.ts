import { describe, expect, it } from 'vitest';
import { classifyPage, type PageModel } from '@aether/perceiver';

function pageWithText(text: string): PageModel {
  return {
    url: 'https://www.amazon.com/s?k=tea',
    title: 'Search results',
    documentId: 'doc-1',
    scrollPercent: 0,
    frames: [],
    roots: [],
    lines: [{ plain: text, linked: text, path: [], visibility: 'in' }],
    byRef: new Map(),
    order: [],
    scopeOf: new Map(),
    unreadFrames: 0,
  };
}

describe('CAPTCHA page classification', () => {
  it.each([
    "Sorry, we just need to make sure you're not a robot.",
    'Please complete the security challenge to continue.',
    'Enter the characters you see in the image.',
    'We detected unusual traffic from your computer network.',
  ])('recognizes the human-verification page text: %s', (text) => {
    expect(classifyPage(pageWithText(text))).toBe('captcha');
  });

  it('does not label ordinary product text as a CAPTCHA', () => {
    expect(classifyPage(pageWithText('Organic tea leaves, available in three sizes.'))).toBe('other');
  });
});
