import { app, type Session } from 'electron';

/*
 * Electron security settings (plan 3.1, section 9.7) that apply to every
 * web page in the app. Per-view settings (sandbox, context isolation, no
 * Node) are set where views are made.
 */

/** Permissions the person's own tabs may use without a prompt in this step; prompts come in Step 4. */
const HUMAN_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

export interface PermissionOwner {
  kindOf(webContentsId: number): 'human' | 'agent' | 'shell' | undefined;
}

export function hardenApp(): void {
  app.on('web-contents-created', (_event, contents) => {
    // No <webview>, ever.
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/**
 * Camera, microphone, location, notifications, MIDI and clipboard reading are
 * denied to Agent tabs. The person's tabs get a short allow list until Step 4
 * brings the permission bubble.
 */
export function hardenSession(target: Session, owners: PermissionOwner): void {
  target.setPermissionRequestHandler((contents, permission, callback) => {
    const kind = owners.kindOf(contents.id);
    callback(kind === 'human' && HUMAN_ALLOWED.has(permission));
  });
  target.setPermissionCheckHandler((contents, permission) => {
    const kind = contents ? owners.kindOf(contents.id) : undefined;
    return kind === 'human' && HUMAN_ALLOWED.has(permission);
  });
  // Downloads arrive with Step 5 (per-Space folders with a disk check); until then they are refused.
  target.on('will-download', (event) => event.preventDefault());
}
