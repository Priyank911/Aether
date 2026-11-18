import { waitForSettle } from '@aether/actor';
import { classifyPage, findConsentBanner, readProductFacts, type ConsentBanner, type PageModel, type ProductFacts } from '@aether/perceiver';
import type { CookieBannerMode, PageArchetype } from '@aether/shared';
import type { AgentTab } from '../agent-tab.js';

/*
 * Smart Landing (plan 3.1, section 6.1): after a page loads and before anyone
 * reads it, wait for it to settle, answer a cookie banner the way the person's
 * setting says, and label the page type. No model tokens. The notes name refs
 * and roles only, never page text, because they travel outside the untrusted
 * wrapper.
 */

export interface LandingResult {
  /** Engine notes for the agent, such as "closed a cookie banner (rejected optional cookies)". */
  notes: string[];
  archetype: PageArchetype;
  product?: ProductFacts;
  /** The page as it stands after landing. */
  model: PageModel;
}

const MAX_BANNER_PASSES = 2;

function describe(banner: ConsentBanner): string {
  const parts = [
    banner.reject?.ref ? `reject [${banner.reject.ref}]` : undefined,
    banner.accept?.ref ? `accept [${banner.accept.ref}]` : undefined,
    banner.settings?.ref ? `settings [${banner.settings.ref}]` : undefined,
  ].filter(Boolean);
  return `${banner.containerRef ? `[${banner.containerRef}] ` : ''}${parts.join(', ')}`;
}

export async function smartLanding(
  tab: AgentTab,
  capture: () => Promise<PageModel>,
  mode: CookieBannerMode,
  options: { step: number; interrupted: () => boolean },
): Promise<LandingResult> {
  const started = Date.now();
  const notes: string[] = [];
  const settled = await waitForSettle(tab.session, tab.watcher);
  let model = await capture();

  for (let pass = 0; pass < MAX_BANNER_PASSES; pass++) {
    const banner = tab.watcher.dialog ? undefined : findConsentBanner(model);
    if (!banner) break;
    if (mode === 'off') {
      notes.push(`cookie banner left as it is (your setting): ${describe(banner)}`);
      break;
    }
    const target = mode === 'reject' ? banner.reject : banner.accept;
    if (!target?.ref) {
      notes.push(
        mode === 'reject'
          ? `cookie banner has no option to refuse optional cookies, so it was left as it is (your setting: reject): ${describe(banner)}`
          : `cookie banner has no accept option, so it was left as it is: ${describe(banner)}`,
      );
      break;
    }
    const result = await tab.actor.execute(
      { actions: [{ op: 'click', ref: target.ref }], risk: 'read', why: 'Smart Landing: answer the cookie banner as set' },
      options.step,
      options.interrupted,
    );
    if (!result.success) {
      notes.push(`could not answer the cookie banner: ${describe(banner)}`);
      break;
    }
    await waitForSettle(tab.session, tab.watcher);
    model = await capture();
    const still = findConsentBanner(model);
    if (!still) {
      notes.push(`closed a cookie banner (${mode === 'reject' ? 'rejected optional cookies' : 'accepted cookies'}) in ${Date.now() - started} ms`);
      break;
    }
    if (pass === MAX_BANNER_PASSES - 1) notes.push(`answered the cookie banner but it is still showing: ${describe(still)}`);
  }

  const product = await readProductFacts(tab.session).catch(() => undefined);
  const archetype = classifyPage(model, product);
  if (!settled) notes.push('the page was still changing after 2.5 s; parts may load later');
  return { notes, archetype, product, model };
}
