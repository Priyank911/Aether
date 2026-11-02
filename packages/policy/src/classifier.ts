import type {
  ActionItem,
  ActionRisk,
  ParsedElement,
  PolicyDecision,
} from '@aether/shared';
import { UrlBoundary } from './url-boundary.js';

export const IRREVERSIBLE_NAME_TRIGGERS =
  /\b(buy|pay|place order|send|post|publish|delete|remove|submit|confirm|transfer|subscribe)\b/i;

export const SENSITIVE_CREDENTIAL_PATTERN =
  /(password|passphrase|secret|credit[_\s-]*card|(?:^|[^a-z0-9])(?:pin|otp|cvv|cvc)(?:$|[^a-z0-9]))/i;

export class PolicyClassifier {
  /**
   * Classify a proposed navigation URL.
   */
  public static classifyNavigation(url: string): PolicyDecision {
    const boundary = UrlBoundary.check(url);
    if (!boundary.allowed) {
      return {
        outcome: 'refuse',
        reason: boundary.reason ?? 'URL is blocked by security policy',
      };
    }
    return {
      outcome: 'allow',
      reason: 'Navigation is within permitted boundaries',
    };
  }

  /**
   * Check if attributes or name match password / credential fields.
   */
  public static isPasswordField(
    attributes: Map<string, string> | Record<string, string>,
    name = '',
  ): boolean {
    const getAttr = (key: string): string => {
      if (attributes instanceof Map) {
        return (attributes.get(key) ?? '').toLowerCase();
      }
      return (attributes[key] ?? '').toLowerCase();
    };

    const typeAttr = getAttr('type');
    const autocompleteAttr = getAttr('autocomplete');
    const nameAttr = getAttr('name');
    const idAttr = getAttr('id');

    if (typeAttr === 'password') return true;
    if (autocompleteAttr === 'current-password' || autocompleteAttr === 'new-password') return true;
    if (SENSITIVE_CREDENTIAL_PATTERN.test(nameAttr)) return true;
    if (SENSITIVE_CREDENTIAL_PATTERN.test(idAttr)) return true;
    if (SENSITIVE_CREDENTIAL_PATTERN.test(name)) return true;

    return false;
  }

  /**
   * Check if an element or action matches irreversible triggers.
   */
  public static isIrreversible(
    _action: ActionItem,
    target?: ParsedElement,
    declaredRisk?: ActionRisk,
  ): boolean {
    if (declaredRisk === 'irreversible') return true;

    const targetText = `${target?.name ?? ''} ${target?.value ?? ''}`;
    if (IRREVERSIBLE_NAME_TRIGGERS.test(targetText)) {
      return true;
    }

    return false;
  }

  /**
   * Classify a single action item.
   */
  public static classifyAction(
    action: ActionItem,
    target?: ParsedElement,
    declaredRisk?: ActionRisk,
    attributes?: Map<string, string> | Record<string, string>,
  ): PolicyDecision {
    // 1. Password and credential fields must always be performed by a human
    if (action.op === 'type') {
      if (attributes && PolicyClassifier.isPasswordField(attributes, target?.name)) {
        return {
          outcome: 'human_must_perform',
          reason: `Password and credential field ${action.ref} must be performed by human`,
          actionRef: action.ref,
        };
      }
    }

    // 2. Irreversible actions require human approval
    if (PolicyClassifier.isIrreversible(action, target, declaredRisk)) {
      return {
        outcome: 'needs_approval',
        reason: `Irreversible action on ${action.ref} ("${target?.name ?? ''}") requires human approval`,
        actionRef: action.ref,
      };
    }

    return {
      outcome: 'allow',
      reason: 'Action allowed under current policy',
      actionRef: action.ref,
    };
  }

  /**
   * Classify a batch of actions. Returns the highest-priority restrictive outcome.
   * Priority: refuse > human_must_perform > needs_approval > allow
   */
  public static classifyBatch(
    actions: ActionItem[],
    elementMap: Map<string, ParsedElement>,
    declaredRisk: ActionRisk,
    attributeMap?: Map<string, Map<string, string>>,
  ): PolicyDecision {
    const decisions: PolicyDecision[] = [];

    for (const action of actions) {
      const target = elementMap.get(action.ref);
      const attrs = attributeMap?.get(action.ref);
      decisions.push(PolicyClassifier.classifyAction(action, target, declaredRisk, attrs));
    }

    // Return first refusal
    const refuse = decisions.find((d) => d.outcome === 'refuse');
    if (refuse) return refuse;

    // Return first human_must_perform
    const humanMust = decisions.find((d) => d.outcome === 'human_must_perform');
    if (humanMust) return humanMust;

    // Return first needs_approval
    const needsApproval = decisions.find((d) => d.outcome === 'needs_approval');
    if (needsApproval) return needsApproval;

    return {
      outcome: 'allow',
      reason: 'All actions in batch allowed',
    };
  }
}
