import { ancestorsOf, descendantsOf, nodeLine, type PageModel, type PageNode } from '@aether/perceiver';
import type { PolicyTarget } from '@aether/policy';
import { CAPTCHA_FRAME_PATTERN, type ApprovalDetail } from '@aether/shared';

const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'checkbox', 'radio', 'switch']);
const MAX_VALUES = 12;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Fields of the form or search region that encloses a ref. */
export function enclosingFormFields(model: PageModel, ref: string): PageNode[] {
  const form = [...ancestorsOf(model, ref)].reverse().find((node) => node.role === 'form' || node.role === 'search');
  return form ? descendantsOf(form).filter((node) => FIELD_ROLES.has(node.role)) : [];
}

export function asPolicyTarget(node: PageNode): PolicyTarget {
  return { name: node.name, value: node.value, role: node.role, sensitive: node.sensitive, identity: node.identity };
}

export function inCaptchaFrame(model: PageModel, node: PageNode): boolean {
  const frame = model.frames.find((candidate) => candidate.ordinal === node.frameOrdinal);
  return Boolean(frame && node.frameOrdinal > 0 && CAPTCHA_FRAME_PATTERN.test(frame.url));
}

function fieldValue(node: PageNode): string {
  if (['checkbox', 'radio', 'switch'].includes(node.role)) return node.states.includes('checked') ? 'checked' : 'not checked';
  if (node.sensitive) return node.value ? '***' : '(empty)';
  return node.value ? node.value.slice(0, 80) : '(empty)';
}

/** What the approval card shows: the site, the element, what the form is about to send, and the agent's claim. */
export function approvalDetail(model: PageModel, ref: string | undefined, agentReason: string): ApprovalDetail {
  const node = ref ? model.byRef.get(ref) : undefined;
  const values = ref
    ? enclosingFormFields(model, ref)
        .slice(0, MAX_VALUES)
        .map((field) => ({ label: field.name || field.role, value: fieldValue(field) }))
    : [];
  return {
    site: originOf(model.url),
    element: node ? nodeLine(node) : 'the page',
    values,
    agentReason: agentReason.slice(0, 300),
  };
}
