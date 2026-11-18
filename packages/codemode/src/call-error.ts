import type { CodeModeErrorCode } from '@aether/shared';

/**
 * A space.* call the engine rejects. The script receives it as an Error with
 * the same message and `code`; the message must be engine text, never page
 * content, because it crosses outside the untrusted wrapper.
 */
export class CodeModeCallError extends Error {
  public readonly code: CodeModeErrorCode;

  public constructor(code: CodeModeErrorCode, message: string) {
    super(message);
    this.name = 'CodeModeCallError';
    this.code = code;
  }
}
