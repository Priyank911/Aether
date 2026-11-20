import { spawn } from 'node:child_process';
import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { readProfileJson } from './source.js';

/** Uses Windows' own DPAPI. No elevation, key material in arguments, or secret diagnostics. */
export function windowsUnprotect(value: Buffer): Promise<Buffer> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Encryption unavailable'));
  const script = "$ErrorActionPreference='Stop';try{Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))}catch{exit 1}";
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    const finish = (result?: Buffer) => {
      if (settled) { result?.fill(0); return; }
      settled = true; clearTimeout(timer);
      if (result) resolve(result); else reject(new Error('Encryption unavailable'));
    };
    const timer = setTimeout(() => { child.kill(); finish(); }, 15000);
    child.on('error', () => finish());
    child.stdin.on('error', () => finish());
    child.stdout.on('data', (part: Buffer) => { output += part.toString('utf8'); if (output.length > 65536) { child.kill(); finish(); } });
    child.on('close', code => finish(code === 0 && output.trim() ? Buffer.from(output.trim(), 'base64') : undefined));
    child.stdin.end(value.toString('base64'));
  });
}

export class CookieCrypto {
  private key?: Buffer;
  private attempted = false;
  public constructor(private readonly profile: string, private readonly platform: NodeJS.Platform = process.platform, private readonly unprotect = windowsUnprotect) {}

  public async decrypt(bytes: Buffer, host: string, version: number): Promise<Buffer | undefined> {
    if (this.platform !== 'win32') return undefined;
    if (bytes.subarray(0, 3).toString('ascii') !== 'v10') return this.unprotect(bytes).catch(() => undefined);
    if (!this.attempted) {
      this.attempted = true;
      try {
        const state = z.object({ os_crypt: z.object({ encrypted_key: z.string() }) }).parse(await readProfileJson(path.join(this.profile, '..', 'Local State')));
        const wrapped = Buffer.from(state.os_crypt.encrypted_key, 'base64');
        if (wrapped.subarray(0, 5).toString('ascii') !== 'DPAPI') return undefined;
        this.key = await this.unprotect(wrapped.subarray(5));
        if (this.key.length !== 32) this.close();
      } catch { this.close(); }
    }
    if (!this.key || bytes.length < 31) return undefined;
    let plain: Buffer | undefined;
    try {
      const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(3, 15));
      cipher.setAuthTag(bytes.subarray(-16));
      plain = Buffer.concat([cipher.update(bytes.subarray(15, -16)), cipher.final()]);
      if (version < 24) return plain;
      const hash = createHash('sha256').update(host).digest();
      if (plain.length < 32 || !timingSafeEqual(hash, plain.subarray(0, 32))) { plain.fill(0); return undefined; }
      const value = Buffer.from(plain.subarray(32));
      plain.fill(0);
      return value;
    } catch { plain?.fill(0); return undefined; }
  }

  public close(): void { this.key?.fill(0); this.key = undefined; }
}
