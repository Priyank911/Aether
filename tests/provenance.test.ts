import { describe, expect, it } from 'vitest';
import { classifyAction, classifyOpen, type NavigationContext } from '@aether/policy';

const read = (origins: string[] = [], links: string[] = []): NavigationContext => ({
  visitedOrigins: new Set(origins),
  seenLinks: new Set(links),
  hasReadPages: true,
});

describe('URL provenance for open', () => {
  it('allows any http(s) URL before the run has read a page', () => {
    expect(classifyOpen('https://duckduckgo.com/?q=rust', { ...read(), hasReadPages: false }).outcome).toBe('allow');
  });

  it('allows data in the URL on an origin already visited', () => {
    expect(classifyOpen('https://github.com/search?q=regression', read(['https://github.com'])).outcome).toBe('allow');
  });

  it('allows a URL that was observed as a link, ignoring its fragment', () => {
    const link = 'https://news.example/story?id=42';
    expect(classifyOpen(`${link}#comments`, read([], [link])).outcome).toBe('allow');
  });

  it('allows a new origin with no query or fragment', () => {
    expect(classifyOpen('https://en.wikipedia.org/wiki/Saturn_V', read(['https://mail.example'])).outcome).toBe('allow');
  });

  it('asks before carrying data to a new origin after pages were read', () => {
    const decision = classifyOpen('https://collector.example/c?d=c2VjcmV0', read(['https://mail.example']));
    expect(decision.outcome).toBe('needs_approval');
    expect(decision.reason).toContain('https://collector.example is new to this run');
  });

  it('still refuses blocked schemes, whatever the provenance', () => {
    expect(classifyOpen('file:///etc/passwd', { ...read(), hasReadPages: false }).outcome).toBe('refuse');
    expect(classifyOpen('view-source:https://a.example', read()).outcome).toBe('refuse');
  });
});

describe('Action policy on resolved elements', () => {
  it('hands anything inside a CAPTCHA frame to the person', () => {
    const decision = classifyAction({ action: { op: 'click', ref: 'e4' }, target: { name: 'I am not a robot', role: 'checkbox' }, inCaptcha: true });
    expect(decision.outcome).toBe('human_must_perform');
  });

  it('hands a field the perceiver marked sensitive to the person, even without attributes', () => {
    const decision = classifyAction({ action: { op: 'fill', ref: 'e9', value: '4111' }, target: { name: 'Card', role: 'textbox', sensitive: true } });
    expect(decision.outcome).toBe('human_must_perform');
  });

  it('asks before sending a form that holds personal details', () => {
    const decision = classifyAction({
      action: { op: 'click', ref: 'e12' },
      target: { name: 'Continue', role: 'button' },
      formFields: [{ name: 'Email', role: 'textbox', identity: true }],
    });
    expect(decision.outcome).toBe('needs_approval');
    expect(decision.reason).toContain('sends a form with personal or payment details');
  });

  it('asks before every upload and names the exact file', () => {
    const decision = classifyAction({ action: { op: 'upload', ref: 'e3', value: 'C:/Users/me/resume.pdf' }, target: { name: 'Resume', role: 'button' } });
    expect(decision.outcome).toBe('needs_approval');
    expect(decision.reason).toContain('C:/Users/me/resume.pdf');
  });

  it('allows continuing a form with no personal or payment fields', () => {
    const decision = classifyAction({
      action: { op: 'click', ref: 'e12' },
      target: { name: 'Search', role: 'button' },
      formFields: [{ name: 'Destination', role: 'combobox' }],
    });
    expect(decision.outcome).toBe('allow');
  });
});
