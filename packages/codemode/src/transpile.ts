import { stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';

/*
 * TypeScript to JavaScript by removing type syntax only (plan 3.1, section 7.1).
 * Types are replaced with spaces, so line and column numbers in runtime errors
 * still point at the host's source. Syntax that needs a real transform (enum,
 * namespace, parameter properties) is refused with a message saying so.
 */

const PREFIX = 'async function __aether_main() {\n';
const SUFFIX = '\n}';

export type TranspileResult = { ok: true; code: string } | { ok: false; message: string };

/** Silence Node's one-time "experimental" warning for this call only; every other warning still prints. */
function withoutExperimentalWarning<T>(body: () => T): T {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (/stripTypeScriptTypes/.test(text)) return;
    // biome-ignore lint/suspicious/noExplicitAny: forwarding the original overloaded signature unchanged
    (original as (...args: any[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return body();
  } finally {
    process.emitWarning = original;
  }
}

/**
 * The script is a function body: it may use top-level `await` and `return`.
 * It is stripped inside a function wrapper, because a bare `return` is not
 * valid at the top level of a script.
 */
export function transpile(source: string): TranspileResult {
  let stripped: string;
  try {
    stripped = withoutExperimentalWarning(() => stripTypeScriptTypes(`${PREFIX}${source}${SUFFIX}`, { mode: 'strip' }));
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      return { ok: false, message: `${message}. Use plain objects and union types instead of enum or namespace.` };
    }
    return { ok: false, message: `TypeScript syntax error: ${message}` };
  }
  if (!stripped.startsWith(PREFIX) || !stripped.endsWith(SUFFIX)) {
    return { ok: false, message: 'the script could not be prepared; it may close the function body early with an extra }' };
  }
  const code = stripped.slice(PREFIX.length, stripped.length - SUFFIX.length);
  const syntax = syntaxProblem(code);
  return syntax ? { ok: false, message: syntax } : { ok: true, code };
}

/**
 * Compile (never run) the body exactly as the sandbox will wrap it, so a
 * syntax error is reported with its line before any Space or tab is touched.
 */
function syntaxProblem(code: string): string | undefined {
  try {
    new Script(`(async () => {\n${code}\n})`, { filename: 'aether-script.ts', lineOffset: -1 });
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const line = /aether-script\.ts:(\d+)/.exec(error instanceof Error ? (error.stack ?? '') : '')?.[1];
    return `syntax error${line ? ` on line ${line}` : ''}: ${message}`;
  }
}
