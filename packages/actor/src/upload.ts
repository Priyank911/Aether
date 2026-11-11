import { statSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession } from '@aether/cdp';
import { ActionBlockedError } from './geometry.js';

/**
 * Put one existing local file into a file input. Policy has already shown the
 * person the exact path and they approved it.
 */
export async function uploadFile(session: CDPSession, backendNodeId: number, file: string): Promise<void> {
  if (!file) throw new ActionBlockedError('upload needs the file path as value');
  const absolute = path.resolve(file);
  let isFile = false;
  try {
    isFile = statSync(absolute).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) throw new ActionBlockedError(`no file at ${absolute}`);
  const { node } = await session.send<{ node: { nodeName: string; attributes?: string[] } }>('DOM.describeNode', { backendNodeId });
  const attributes = node.attributes ?? [];
  const type = attributes[attributes.indexOf('type') + 1]?.toLowerCase();
  if (node.nodeName.toUpperCase() !== 'INPUT' || type !== 'file') throw new ActionBlockedError('the target is not a file input');
  await session.send('DOM.setFileInputFiles', { files: [absolute], backendNodeId });
}
