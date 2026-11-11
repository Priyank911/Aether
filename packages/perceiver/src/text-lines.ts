import type { TextLine, Visibility } from './types.js';

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Accumulates inline text pieces and cuts them into lines at block boundaries. */
export class LineBuilder {
  public readonly lines: TextLine[] = [];
  private plain = '';
  private linked = '';
  private prefix = '';
  private path: readonly string[] = [];
  private visibility: Visibility = 'in';
  private open = false;

  public add(plain: string, linked: string, path: readonly string[], visibility: Visibility): void {
    if (!this.open) {
      this.open = true;
      this.path = path;
      this.visibility = visibility;
    }
    this.plain += plain;
    this.linked += linked;
  }

  /** Prefix for the next line, e.g. a list bullet. Ignored if a line is already open. */
  public startWith(prefix: string): void {
    if (!this.open) this.prefix = prefix;
  }

  public flush(): void {
    const plain = collapse(this.plain);
    const linked = collapse(this.linked);
    if (linked) {
      this.lines.push({ plain, linked: `${this.prefix}${linked}`, path: this.path, visibility: this.visibility });
    }
    this.plain = '';
    this.linked = '';
    this.prefix = '';
    this.open = false;
  }

  public append(lines: TextLine[], pathPrefix: readonly string[]): void {
    this.flush();
    for (const line of lines) this.lines.push({ ...line, path: [...pathPrefix, ...line.path] });
  }
}
