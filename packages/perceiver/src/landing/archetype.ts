import { CAPTCHA_FRAME_PATTERN, type PageArchetype } from '@aether/shared';
import { findItems, type ProductFacts } from '../items.js';
import { EDITABLE_ROLES } from '../roles.js';
import type { PageModel } from '../types.js';

/*
 * What kind of page this is (plan 3.1, section 6.1), so a script can branch
 * without reading the skim. Checked in order: a CAPTCHA or sign-in blocks
 * everything else, a product page beats a listing (product pages often carry
 * a related-items row), and a long reading page comes last.
 */

const CAPTCHA_TEXT = /\b(verify (that )?you are (a )?human|(?:are you|not a|aren't a|are not a) robot|press and hold|complete the security check|i'?m not a robot|captcha|human verification|security challenge|unusual (?:traffic|activity)|automated (?:requests?|access)|make sure you(?:'re| are) not a robot|enter (?:the )?characters? (?:you see|shown|in the image))\b/i;
const SIGN_IN_FIELD = /password|passcode|passwort|mot de passe|contraseña|one[- ]?time|\botp\b|verification code|security code|\bpin\b|2fa|two[- ]factor/i;
const FIELD_ROLES = new Set([...EDITABLE_ROLES, 'checkbox', 'radio', 'switch', 'slider']);
const LISTING_MIN_ITEMS = 6;
const FORM_MIN_FIELDS = 3;
const ARTICLE_MIN_CHARS = 2500;

export function classifyPage(model: PageModel, product?: ProductFacts): PageArchetype {
  const nodes = [...model.byRef.values()];
  const captchaFrame = model.frames.some((frame) => frame.ordinal > 0 && CAPTCHA_FRAME_PATTERN.test(frame.url));
  if (captchaFrame || model.lines.slice(0, 80).some((line) => CAPTCHA_TEXT.test(line.plain))) return 'captcha';

  // A password or one-time code field; a card field alone is a checkout form, not a sign-in gate.
  const signIn = nodes.some((node) => node.sensitive && EDITABLE_ROLES.has(node.role) && SIGN_IN_FIELD.test(node.name));
  if (signIn) return 'auth_gate';

  if (product && (product.price || product.priceRange) && product.name) return 'product';

  if (findItems(model).length >= LISTING_MIN_ITEMS) return 'listing';

  const fields = nodes.filter((node) => FIELD_ROLES.has(node.role) && !node.states.includes('disabled'));
  const searchOnly = fields.length > 0 && fields.every((node) => node.role === 'searchbox' || model.byRef.get(model.scopeOf.get(node.ref ?? '') ?? '')?.role === 'search');
  if (fields.length >= FORM_MIN_FIELDS && !searchOnly && nodes.some((node) => node.role === 'button')) return 'form';

  const text = model.lines.reduce((sum, line) => sum + line.plain.length, 0);
  if (text >= ARTICLE_MIN_CHARS) return 'article';
  return 'other';
}
