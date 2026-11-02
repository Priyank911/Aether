export class ContentSanitizer {
  /**
   * Neutralizes potential prompt injection markers and tags attempting
   * to escape the `<page untrusted>` enclosure.
   */
  public static sanitize(rawText: string): string {
    if (!rawText) return '';

    // Replace closing tags or opening tags of untrusted wrapper to prevent escape
    let sanitized = rawText
      .replace(/<\/page\s*untrusted>/gi, '&lt;/page untrusted&gt;')
      .replace(/<page\s*untrusted>/gi, '&lt;page untrusted&gt;');

    // Neutralize standard fake role tokens if present
    sanitized = sanitized
      .replace(/<\|im_start\|>/gi, '[escaped_im_start]')
      .replace(/<\|im_end\|>/gi, '[escaped_im_end]')
      .replace(/\[INST\]/gi, '[escaped_INST]')
      .replace(/\[\/INST\]/gi, '[escaped_/INST]');

    return sanitized;
  }

  /**
   * Wraps page-derived text in the canonical `<page untrusted>` XML enclosure.
   */
  public static wrapUntrusted(text: string): string {
    const cleaned = ContentSanitizer.sanitize(text);
    return `<page untrusted>\n${cleaned}\n</page untrusted>`;
  }
}
