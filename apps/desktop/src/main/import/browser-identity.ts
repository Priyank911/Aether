import type { Session } from 'electron';

/** Match the bundled Chromium version, not a machine-specific or frozen Chrome release. */
export function chromeIdentity(userAgent: string, version: string, platform: NodeJS.Platform): { userAgent: string; hints: Record<string, string> } {
  const major = version.split('.')[0] ?? '0';
  return {
    userAgent: userAgent.replace(/\s(?:Electron|@aether\/desktop|aether(?:-desktop|-monorepo)?)\/\S+/gi, '').replace(/Chrome\/[\d.]+/, `Chrome/${version}`),
    hints: { 'Sec-CH-UA': `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not_A Brand";v="99"`, 'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Platform': JSON.stringify(platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux') },
  };
}

export function configureBrowserIdentity(target: Session, version: string): void {
  const identity = chromeIdentity(target.getUserAgent(), version, process.platform);
  target.setUserAgent(identity.userAgent);
  target.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const [name, value] of Object.entries(identity.hints)) {
      for (const existing of Object.keys(headers)) if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
      headers[name] = value;
    }
    callback({ requestHeaders: headers });
  });
}
