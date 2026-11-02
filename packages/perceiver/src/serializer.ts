import {
  MAX_ELEMENTS_PER_SNAPSHOT,
  type OutlineSnapshot,
  type ParsedElement,
} from '@aether/shared';
import { isCollapsedMarker, SiblingCollapser, type OutlineNode } from './collapser.js';

export interface FrameElementsData {
  frameOrdinal: number;
  frameUrl: string;
  elements: ParsedElement[];
}

export interface ViewportSerializeOptions {
  inViewportNodeIds?: Set<number>;
}

const LANDMARK_AND_HEADING_ROLES = new Set([
  'heading',
  'banner',
  'navigation',
  'main',
  'search',
  'form',
  'dialog',
]);

export class OutlineSerializer {
  public static serialize(
    pageUrl: string,
    pageTitle: string,
    framesCount: number,
    framesData: FrameElementsData[],
    viewportOptions?: ViewportSerializeOptions,
  ): OutlineSnapshot {
    const lines: string[] = [];
    lines.push(`page ${pageUrl}  "${pageTitle}"  frames=${framesCount}`);

    let totalActionableElements = 0;
    let truncated = false;
    const allParsedElements: ParsedElement[] = [];

    for (const frame of framesData) {
      if (truncated) break;

      if (frame.frameOrdinal > 0) {
        lines.push(`frame ${frame.frameOrdinal} ${frame.frameUrl}`);
      }

      let belowViewportCount = 0;
      const collapsedNodes = SiblingCollapser.collapseSiblings(frame.elements);

      const renderNode = (node: OutlineNode, depth: number): void => {
        if (truncated) return;

        const indent = '  '.repeat(depth);

        if (isCollapsedMarker(node)) {
          lines.push(`${indent}... ${node.count} more similar ${node.role}s (use find or read)`);
          return;
        }

        if (node.role === 'collapsed_marker') {
          lines.push(`${indent}${node.name}`);
          return;
        }

        if (viewportOptions?.inViewportNodeIds && !LANDMARK_AND_HEADING_ROLES.has(node.role)) {
          if (!viewportOptions.inViewportNodeIds.has(node.backendDOMNodeId)) {
            belowViewportCount++;
            return;
          }
        }

        if (totalActionableElements >= MAX_ELEMENTS_PER_SNAPSHOT) {
          truncated = true;
          lines.push(`${indent}... truncated at ${MAX_ELEMENTS_PER_SNAPSHOT} elements (use find or read)`);
          return;
        }

        totalActionableElements++;
        allParsedElements.push(node);

        const parts: string[] = [];
        parts.push(`[${node.ref}] ${node.role}`);

        if (node.name) {
          parts.push(`"${node.name}"`);
        }
        if (node.level !== undefined) {
          parts.push(`level=${node.level}`);
        }
        if (node.value !== undefined && node.value !== '') {
          parts.push(`value="${node.value}"`);
        }
        if (node.states && node.states.length > 0) {
          for (const s of node.states) {
            parts.push(`[${s}]`);
          }
        }

        lines.push(`${indent}${parts.join(' ')}`);

        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            renderNode(child, depth + 1);
          }
        }
      };

      for (const node of collapsedNodes) {
        renderNode(node, frame.frameOrdinal > 0 ? 1 : 0);
      }

      if (belowViewportCount > 0) {
        const indent = frame.frameOrdinal > 0 ? '  ' : '';
        lines.push(`${indent}... ${belowViewportCount} more below (scroll or find)`);
      }
    }

    const formattedText = lines.join('\n');
    const tokenEstimate = Math.ceil(formattedText.length / 4);

    return {
      url: pageUrl,
      title: pageTitle,
      framesCount,
      elements: allParsedElements,
      elementCount: totalActionableElements,
      formattedText,
      tokenEstimate,
      truncated,
    };
  }
}
