import {
  SENSITIVE_AUTOCOMPLETE,
  SENSITIVE_FIELD_PATTERN,
  type ActionItem,
  type ActionRisk,
  type PolicyDecision,
} from '@aether/shared';
import { UrlBoundary } from './url-boundary.js';

/** The parts of a page element the classifier reads. */
export interface PolicyTarget {
  name: string;
  value?: string;
  role?: string;
  /** Field holds a secret: password, one-time code, card number. */
  sensitive?: boolean;
  /** Field holds personal details: name, email, phone, address. */
  identity?: boolean;
}

export interface ActionContext {
  action: ActionItem;
  target?: PolicyTarget;
  risk?: ActionRisk;
  attributes?: ReadonlyMap<string, string>;
  /** Fields of the form that encloses the target, if any. */
  formFields?: PolicyTarget[];
  /** The target sits inside a CAPTCHA frame. */
  inCaptcha?: boolean;
}

export const IRREVERSIBLE_NAME_TRIGGERS =
  /\b(buy|pay|place order|send|post|publish|delete|remove|submit|confirm|transfer|subscribe)\b/i;

/** Roles that commit something when activated. Trigger words on other controls (a newsletter checkbox) do not gate them. */
const ACTIVATOR_ROLES = new Set(['button', 'link', 'menuitem']);

function activates(action: ActionItem, target?: PolicyTarget): boolean {
  const activating = action.op === 'click' || (action.op === 'key' && /^(enter|space)$/i.test(action.value ?? 'enter'));
  return activating && (target?.role === undefined || ACTIVATOR_ROLES.has(target.role));
}

function decision(outcome: PolicyDecision['outcome'], reason: string, action: ActionItem): PolicyDecision {
  return { outcome, reason, actionRef: action.ref };
}

/** True when attributes or the accessible name mark a field as holding a credential or other secret. */
export function isPasswordField(attributes: ReadonlyMap<string, string> | Record<string, string>, name = ''): boolean {
  const read = (key: string): string =>
    (attributes instanceof Map ? (attributes.get(key) ?? '') : ((attributes as Record<string, string>)[key] ?? '')).toLowerCase();
  if (read('type') === 'password') return true;
  if (read('autocomplete').split(/\s+/).some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) return true;
  return SENSITIVE_FIELD_PATTERN.test(read('name')) || SENSITIVE_FIELD_PATTERN.test(read('id')) || SENSITIVE_FIELD_PATTERN.test(name);
}

export function isIrreversible(action: ActionItem, target?: PolicyTarget, risk?: ActionRisk): boolean {
  if (risk === 'irreversible') return true;
  return activates(action, target) && IRREVERSIBLE_NAME_TRIGGERS.test(`${target?.name ?? ''} ${target?.value ?? ''}`);
}

/**
 * Classify one action on its resolved element. Order matters: what only the
 * person may do comes first, then what needs their approval.
 */
export function classifyAction(context: ActionContext): PolicyDecision {
  const { action, target, risk, attributes, formFields, inCaptcha } = context;
  const label = `${action.ref ?? action.op}${target?.name ? ` ("${target.name.slice(0, 60)}")` : ''}`;

  if (action.op === 'upload') {
    // A local file leaving the machine: the person approves the exact path every time.
    return decision('needs_approval', `${label} would upload the local file ${action.value ?? '(none)'}`, action);
  }
  if (inCaptcha) return decision('human_must_perform', `${label} is part of a CAPTCHA, which the person must solve`, action);
  if (action.op === 'fill' && (target?.sensitive || (attributes && isPasswordField(attributes, target?.name)))) {
    return decision('human_must_perform', `${label} holds a password, code or card number, which the person must type`, action);
  }
  if (isIrreversible(action, target, risk)) {
    return decision('needs_approval', `${label} looks irreversible`, action);
  }
  if (activates(action, target) && formFields?.some((field) => field.sensitive || field.identity)) {
    return decision('needs_approval', `${label} sends a form with personal or payment details`, action);
  }
  return decision('allow', 'allowed', action);
}

/** Classify a URL on scheme and origin alone. */
export function classifyNavigation(url: string): PolicyDecision {
  const boundary = UrlBoundary.check(url);
  if (!boundary.allowed) return { outcome: 'refuse', reason: boundary.reason ?? 'URL is blocked by policy' };
  return { outcome: 'allow', reason: 'within permitted boundaries' };
}

/** Kept for existing callers; the functions above are the API. */
export const PolicyClassifier = {
  classifyNavigation,
  isPasswordField,
  isIrreversible,
  classifyAction: (
    action: ActionItem,
    target?: PolicyTarget,
    risk?: ActionRisk,
    attributes?: ReadonlyMap<string, string> | Record<string, string>,
  ): PolicyDecision =>
    classifyAction({
      action,
      target,
      risk,
      attributes: attributes instanceof Map ? attributes : attributes ? new Map(Object.entries(attributes)) : undefined,
    }),
};
