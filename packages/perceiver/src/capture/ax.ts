export interface RawAXValue {
  type?: string;
  value?: unknown;
}

export interface RawAXProperty {
  name: string;
  value: RawAXValue;
}

export interface RawAXNode {
  nodeId: string;
  ignored?: boolean;
  role?: RawAXValue;
  name?: RawAXValue;
  value?: RawAXValue;
  properties?: RawAXProperty[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

export function roleOf(node: RawAXNode): string {
  return String(node.role?.value ?? '');
}

export function nameOf(node: RawAXNode): string {
  return String(node.name?.value ?? '').trim();
}

export function axValueOf(node: RawAXNode): string | undefined {
  const raw = node.value?.value;
  return raw === undefined || raw === null ? undefined : String(raw).trim();
}

export function property(node: RawAXNode, name: string): unknown {
  return node.properties?.find((candidate) => candidate.name === name)?.value?.value;
}
