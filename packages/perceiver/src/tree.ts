import type { PageModel, PageNode } from './types.js';

/** Ancestors of a ref, outermost first. Empty when the ref is unknown or at the top. */
export function ancestorsOf(model: PageModel, ref: string): PageNode[] {
  const path: PageNode[] = [];
  const walk = (node: PageNode): boolean => {
    if (node.ref === ref) return true;
    path.push(node);
    for (const child of node.children) if (walk(child)) return true;
    path.pop();
    return false;
  };
  for (const root of model.roots) if (walk(root)) return path;
  return [];
}

/** Every node below a node, depth first. */
export function descendantsOf(node: PageNode): PageNode[] {
  const found: PageNode[] = [];
  const walk = (current: PageNode): void => {
    for (const child of current.children) {
      found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}
