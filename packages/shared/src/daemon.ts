import { z } from 'zod';
import { HostToolNameSchema } from './host-tools.js';

/*
 * The app's local service (plan 3.1, section 4.2). One per user. Clients are
 * the `aether` command and the optional MCP forwarder. Frames are one JSON
 * object per line over a named pipe (Windows) or a Unix socket.
 */

export const DAEMON_PROTOCOL_VERSION = 1;

/** ~/.aether/daemon.json, readable only by the owner. Removed on a clean exit. */
export const DaemonConfigSchema = z.object({
  version: z.literal(DAEMON_PROTOCOL_VERSION),
  pid: z.number().int().min(1),
  endpoint: z.string().min(1),
  token: z.string().min(32),
  appVersion: z.string(),
  startedAt: z.number().int(),
});

export const DaemonClientKindSchema = z.enum(['cli', 'mcp', 'test']);

/** First frame from a client; the connection closes unless the token matches. */
export const DaemonHelloSchema = z.object({
  type: z.literal('hello'),
  protocol: z.literal(DAEMON_PROTOCOL_VERSION),
  token: z.string().min(32),
  client: z.object({ kind: DaemonClientKindSchema, name: z.string().max(80), version: z.string().max(40) }),
});

export const DaemonWelcomeSchema = z.object({
  type: z.literal('welcome'),
  session: z.string().min(1),
  appVersion: z.string(),
});

export const DaemonRequestSchema = z.object({
  type: z.literal('request'),
  id: z.number().int().min(1),
  tool: HostToolNameSchema,
  params: z.unknown(),
});

/** A tool result as both connectors render it: text for the model, images, and engine metadata. */
export const ToolResultSchema = z.object({
  text: z.string(),
  isError: z.boolean(),
  images: z.array(z.object({ mimeType: z.literal('image/png'), data: z.string() })).max(1).optional(),
  /** Engine metadata only (timings, tab counts, held state); never page content. */
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const DaemonResponseSchema = z.object({
  type: z.literal('response'),
  id: z.number().int().min(1),
  result: ToolResultSchema,
});

/** A connection-level failure: bad token, bad frame, protocol mismatch. The service closes after sending it. */
export const DaemonFatalSchema = z.object({
  type: z.literal('fatal'),
  code: z.enum(['bad_token', 'bad_frame', 'protocol', 'shutting_down']),
  message: z.string(),
});

export const DaemonClientFrameSchema = z.union([DaemonHelloSchema, DaemonRequestSchema]);
export const DaemonServerFrameSchema = z.union([DaemonWelcomeSchema, DaemonResponseSchema, DaemonFatalSchema]);

export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;
export type DaemonHello = z.infer<typeof DaemonHelloSchema>;
export type DaemonWelcome = z.infer<typeof DaemonWelcomeSchema>;
export type DaemonRequest = z.infer<typeof DaemonRequestSchema>;
export type DaemonResponse = z.infer<typeof DaemonResponseSchema>;
export type DaemonFatal = z.infer<typeof DaemonFatalSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type DaemonClientFrame = z.infer<typeof DaemonClientFrameSchema>;
export type DaemonServerFrame = z.infer<typeof DaemonServerFrameSchema>;
