import type { Session } from 'electron';
import { isBlockedHost } from '@aether/policy';

/*
 * Request filtering for Agent Spaces (plan 3.1, section 5.2). The persistent
 * partition is shared with the person's own tabs, so the decision is made per
 * request from the tab that sent it: only Agent tabs are filtered. Blocked:
 * the hand-kept ad and tracking hosts, and media streams from Agent tabs the
 * person is not looking at.
 */

export interface RequestOwner {
  /** 'agent' for an Agent tab, with whether it is on screen; undefined for anything else. */
  ownerOf(webContentsId: number): { kind: 'agent'; shown: boolean } | undefined;
}

export function installRequestFilter(target: Session, owners: RequestOwner, counter: { blocked: number }): void {
  target.webRequest.onBeforeRequest((details, callback) => {
    const owner = details.webContentsId === undefined ? undefined : owners.ownerOf(details.webContentsId);
    if (owner?.kind !== 'agent') {
      callback({});
      return;
    }
    const media = details.resourceType === 'media' && !owner.shown;
    if (media || isBlockedHost(details.url)) {
      counter.blocked++;
      callback({ cancel: true });
      return;
    }
    callback({});
  });
}
