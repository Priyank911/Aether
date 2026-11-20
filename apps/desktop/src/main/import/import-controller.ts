import { EventEmitter } from 'node:events';
import type { Session } from 'electron';
import { ImportStateSchema, type ImportSelection, type ImportState } from '@aether/shared';
import type { NavigationStore } from '../navigation-store.js';
import { importChromeProfile } from './chrome-importer.js';
import { discoverChromeProfiles, profileAt, type LocalProfile } from './profiles.js';

/** Main-process registry: renderer commands name an offered id, never an arbitrary file path. */
export class ImportController extends EventEmitter {
  private profiles: LocalProfile[] = [];
  private busy = false;
  private report?: ImportState['report'];
  private error?: string;
  public constructor(private readonly navigation: NavigationStore, private readonly session: Session, private readonly roots?: string[]) { super(); }
  public state(): ImportState {
    return ImportStateSchema.parse({ profiles: this.profiles.map(profile => profile.public), busy: this.busy, offer: this.navigation.importOffer, report: this.report, error: this.error });
  }
  public dismissOffer(): void { this.navigation.dismissImportOffer(); this.emit('changed'); }
  public async discover(): Promise<void> {
    await this.perform(async () => { this.profiles = await discoverChromeProfiles(this.roots); });
  }
  public async choose(selectDirectory: () => Promise<string | undefined>): Promise<void> {
    await this.perform(async () => {
      const directory = await selectDirectory();
      if (!directory) return;
      const profile = await profileAt(directory);
      if (!profile) { this.error = 'No readable Chrome data was found. Choose a profile folder containing Bookmarks, History or Cookies.'; return; }
      if (!this.profiles.some(item => item.directory === profile.directory)) this.profiles.push(profile);
    });
  }
  public async import(profileId: string, selection: ImportSelection): Promise<void> {
    const profile = this.profiles.find(item => item.public.id === profileId);
    if (!profile) throw new Error('Choose a profile from the current list.');
    await this.perform(async () => {
      const verified = await profileAt(profile.directory);
      if (!verified || verified.directory !== profile.directory) { this.error = 'This profile is no longer available. Refresh the list or choose its folder again.'; return; }
      this.report = undefined;
      this.report = await importChromeProfile(profile.directory, selection, {
        navigation: this.navigation,
        cookie: async details => {
          const domain = (details.domain ?? new URL(details.url).hostname).replace(/^\./, '');
          const existing = await this.session.cookies.get({ name: details.name });
          if (existing.some(cookie => cookie.domain?.replace(/^\./, '') === domain && cookie.path === (details.path ?? '/'))) return false;
          await this.session.cookies.set(details);
          return true;
        },
        flush: () => this.session.cookies.flushStore(),
      });
      this.navigation.dismissImportOffer();
    });
  }
  private async perform(body: () => Promise<void>): Promise<void> {
    if (this.busy) throw new Error('An import or profile search is already running. Wait for it to finish.');
    this.busy = true; this.error = undefined; this.emit('changed');
    try { await body(); }
    catch { this.error = 'Could not read the selected browser data. Close Chrome, check access to the profile, and try again.'; }
    finally { this.busy = false; this.emit('changed'); }
  }
}
