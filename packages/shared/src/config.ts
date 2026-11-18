import { z } from 'zod';

/*
 * The person's settings, ~/.aether/config.json (plan 3.1, sections 5.2 and
 * 6.1). Only the person changes these: the Settings page in the app, or the
 * file. No tool or script can write them.
 */

/**
 * What Smart Landing does with a cookie consent banner.
 * - reject: click the option that refuses optional cookies ("Reject all",
 *   "Only necessary", "Necessary only"); never accept. If the banner has no
 *   such option it is left alone and the agent is told.
 * - accept: click "Accept all".
 * - off: never touch a banner; the agent is told where it is.
 */
export const CookieBannerModeSchema = z.enum(['reject', 'accept', 'off']);

export const AetherConfigSchema = z.object({
  cookieBanners: CookieBannerModeSchema.default('reject'),
  /** Free memory kept in reserve before background tabs are put to sleep (Step 2). */
  minFreeMemoryRatio: z.number().min(0.05).max(0.9).default(0.2),
});

export type CookieBannerMode = z.infer<typeof CookieBannerModeSchema>;
export type AetherConfig = z.infer<typeof AetherConfigSchema>;

export const DEFAULT_CONFIG: AetherConfig = AetherConfigSchema.parse({});
