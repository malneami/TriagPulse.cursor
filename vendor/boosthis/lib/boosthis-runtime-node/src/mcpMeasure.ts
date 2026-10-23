/** MCP per-tool measurement — Node runtime (canonical cross-runtime source).
 *
 * An MCP server over HTTP is half-visible already: the middleware times
 * `POST /mcp` as ONE opaque route, so a 40ms `tools/list` and a 4s tool call
 * are the same row. This module derives a PER-TOOL label so they can be told
 * apart, mirroring the label-bounding approach of the hosted endpoint
 * (`mcpSampleLabel` / `MCP_SAMPLE_TOOLS` in the api-server) verbatim:
 *
 *   CARDINALITY + PII ARE BOUNDED ON PURPOSE. Both the JSON-RPC method and
 *   the tool name arrive from an UNTRUSTED caller. Methods outside a fixed
 *   protocol set collapse to `mcp.other`; tool names outside the
 *   developer-registered roster collapse to `mcp.call.other`. Tool ARGUMENTS
 *   are never read. An open label set would be a denial-of-service on our own
 *   fixed-size sample ring — a caller minting endless distinct names would
 *   evict every real sample.
 *
 * Coverage model (honest, by transport):
 *   • HTTP MCP servers: AUTO. The middleware relabels `POST <any-path>/mcp` requests
 *     per tool when a parsed JSON body is available (e.g. express.json ran).
 *   • stdio MCP servers: EXPLICIT. No HTTP layer exists, so the developer (or
 *     their AI) wraps each handler in `mcpTool(name, fn)` — one line.
 *
 * Registering a tool name is developer CODE (not caller input), so
 * `mcpTool()` self-registers its name and `registerMcpTools()` pre-registers
 * a roster for the auto-HTTP path. Both are capped and validated.
 */

import { record } from "./samples";
import { rateDuration, type Rating } from "./thresholds";
import { routeLabelHasPII } from "./no-pii";

/** Fixed JSON-RPC protocol methods worth timing separately. CLOSED set. */
const MCP_METHODS: ReadonlySet<string> = new Set([
  "initialize",
  "initialized",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "prompts/list",
  "prompts/get",
  "notifications/initialized",
  "notifications/cancelled",
]);

/** Label prefix for tool-call samples; the axis + dashboard group on this. */
export const MCP_CALL_PREFIX = "mcp.call.";
/** Suffix marking a FAILED tool call (handler threw / 5xx). Closed 2x set. */
export const MCP_ERROR_SUFFIX = ".error";

/** Roster ceiling — even developer code can't mint unbounded labels. */
export const MCP_MAX_TOOLS = 64;
/** Tool names must look like code identifiers: short, no spaces, no PII. */
const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

const registered = new Set<string>();

/** Validate one developer-supplied tool name. Returns the canonical name or
 *  null when it can't be a label (bad shape / PII-shaped / roster full). */
function validToolName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!TOOL_NAME_RE.test(trimmed)) return null;
  if (routeLabelHasPII(MCP_CALL_PREFIX + trimmed) !== null) return null;
  return trimmed;
}

/** Pre-register the MCP tool roster (developer code — a CLOSED set) so the
 *  auto-HTTP path can label `tools/call` per tool. Invalid or over-cap names
 *  are silently skipped; their calls bucket to `mcp.call.other`. */
export function registerMcpTools(names: readonly string[]): void {
  if (!Array.isArray(names)) return;
  for (const n of names) {
    if (registered.size >= MCP_MAX_TOOLS) return;
    const ok = validToolName(n);
    if (ok) registered.add(ok);
  }
}

/** @internal test hook. */
export function _resetMcpToolsForTests(): void {
  registered.clear();
}

/** Derive the bounded sample label for one inbound JSON-RPC message.
 *  Returns null when the value isn't a JSON-RPC-shaped object at all (so the
 *  caller can skip recording rather than mint a meaningless bucket). Batch
 *  arrays collapse to `mcp.batch` — one request, one sample. */
export function mcpAutoLabel(msg: unknown): string | null {
  if (Array.isArray(msg)) return msg.length > 0 ? "mcp.batch" : null;
  if (msg === null || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  const method = typeof m["method"] === "string" ? (m["method"] as string) : "";
  if (!method) return null;
  if (!MCP_METHODS.has(method)) return "mcp.other";
  if (method !== "tools/call") return "mcp." + method.replace(/\//g, "_");
  const params = m["params"] as Record<string, unknown> | undefined;
  const raw = typeof params?.["name"] === "string" ? (params["name"] as string) : "";
  return labelForTool(raw);
}

/** Bounded label for a tool name: registered → `mcp.call.<name>`, anything
 *  else → `mcp.call.other`. NEVER echoes unregistered caller text. */
export function labelForTool(name: string): string {
  return registered.has(name)
    ? MCP_CALL_PREFIX + name
    : MCP_CALL_PREFIX + "other";
}

/** Record one MCP sample. Failed calls land under a distinct `.error`
 *  label (rated poor) so per-tool ERROR RATE is visible next to latency;
 *  successful calls rate on the shared TTI duration thresholds. */
export function recordMcpSample(
  label: string,
  durationMs: number,
  isError: boolean,
): void {
  const name = isError ? label + MCP_ERROR_SUFFIX : label;
  const rating: Rating = isError ? "poor" : rateDuration(durationMs);
  // Labels here are closed-set by construction, but keep the shared guard as
  // the final backstop (same posture as trackPerf).
  if (routeLabelHasPII(name) === null) {
    record(name, durationMs, rating);
  }
}

/** Explicit per-tool wrapper — the ONE line a stdio MCP server needs (also
 *  fine over HTTP). Self-registers the name (developer code, bounded by the
 *  same roster cap) so the auto-HTTP path recognizes it too. A throwing
 *  handler records under `<label>.error` and rethrows unchanged. */
export function mcpTool<TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult> | TResult,
): (...args: TArgs) => Promise<TResult> {
  registerMcpTools([name]);
  return async (...args: TArgs): Promise<TResult> => {
    const label = labelForTool(validToolName(name) ?? "");
    const start = performance.now();
    let failed = false;
    try {
      return await fn(...args);
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      try {
        recordMcpSample(label, performance.now() - start, failed);
      } catch {
        // instrumentation must never take down the host.
      }
    }
  };
}

/** True when a request path is an MCP endpoint (`/mcp` or any path ending in `/mcp`). */
export function isMcpPath(path: string): boolean {
  return path === "/mcp" || path.endsWith("/mcp");
}
