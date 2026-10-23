/** Stdio entrypoint for the Boosthis Node MCP server.
 *
 * Run with:  `pnpm --filter @workspace/boosthis-runtime-node run mcp`
 * Or wire into Claude Desktop / Cursor MCP config:
 *   { "command": "pnpm",
 *     "args": ["--filter", "@workspace/boosthis-runtime-node", "run", "mcp"] }
 * On Windows `pnpm` is a script (pnpm.cmd) that an AI tool cannot start
 * without a shell, so there the same entry starts it through cmd /c:
 *   { "command": "cmd",
 *     "args": ["/c", "pnpm", "--filter", "@workspace/boosthis-runtime-node", "run", "mcp"] }
 * (run `… run mcp-config` to print both ready-to-paste config blocks.)
 *
 * Reads newline-delimited JSON-RPC 2.0 from stdin, writes responses to
 * stdout. All logs MUST go to stderr — stdout is the transport.
 */

import { handleRequest, type JsonRpcRequest } from "./mcp";
import { configureLiveData, isLiveDataConfigured } from "./liveData";
import { storage } from "./storage";

// Wire the live-read tools (boosthis.snapshot / boosthis.crash_risk) for THIS
// install. Precedence: explicit env vars first (BOOSTHIS_* / BOOSTEN_* alias),
// then fall back to the install id + self-scoped read token the app process
// persisted when it called enableTelemetry. storage.getSync avoids a top-level
// await. When neither is present the tools serve the on-device note
// (fail-open), so a bare stdio server still works.
//
// That fallback reads the app's state file, and state is kept per application
// root (`<base>/boosthis-<scope>/`) so two services on one machine cannot see
// each other. This server is a SEPARATE process, usually started by an AI tool
// from its own working directory, so it only lands in the app's scope when it
// is told which app it belongs to: set BOOSTHIS_PROJECT_ROOT to the app's
// directory (the printed `mcp-config` does this). Without it there is nothing
// to read and the credentials must be passed in explicitly — deliberately, in
// preference to hunting through other applications' state.
{
  const env = process.env;
  let installId =
    env.BOOSTHIS_INSTALL_ID || env.BOOSTEN_INSTALL_ID || "";
  let readToken =
    env.BOOSTHIS_READ_TOKEN || env.BOOSTEN_READ_TOKEN || "";
  if (!installId) {
    installId = storage.getSync("installId") || "";
  }
  if (installId && !readToken) {
    readToken = storage.getSync(`readToken:${installId}`) || "";
  }
  configureLiveData({
    installId,
    token: readToken,
    baseUrl: env.BOOSTHIS_ENDPOINT || env.BOOSTEN_ENDPOINT || undefined,
  });
}

process.stderr.write(
  "boosthis-node MCP server starting. Note: the in-process sample buffer " +
    "is empty when this is run standalone" +
    (isLiveDataConfigured()
      ? "; live-read tools (snapshot / crash_risk) are configured for this " +
        "install's uploaded data."
      : "; for live perf data, use mount() in your Express app instead, or " +
        "set BOOSTHIS_INSTALL_ID + BOOSTHIS_READ_TOKEN to read uploaded data.") +
    "\n",
);

let buffer = "";
// Hard cap on a single unframed line. MCP requests are JSON objects with
// small string arguments; legitimate traffic is well under this. The cap
// stops an upstream agent (or a stuck pipe) from pinning unbounded memory
// while we wait for a newline that may never arrive.
const MAX_LINE_BYTES = 1 << 20; // 1 MiB

// handleRequest is async (get_rule fetches its fix from the server per-rule),
// so requests are dispatched through a serial promise chain. Buffer slicing
// stays synchronous in the 'data' handler to avoid races; only the per-line
// parse + dispatch is deferred, and the chain preserves response ordering.
let chain: Promise<void> = Promise.resolve();
function dispatch(line: string): void {
  chain = chain
    .then(async () => {
      if (line.length > MAX_LINE_BYTES) {
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: line exceeds 1MiB cap" } }) + "\n",
        );
        return;
      }
      let req: unknown;
      try {
        req = JSON.parse(line);
      } catch {
        // JSON-RPC 2.0 §5.1 — malformed JSON must surface as a Parse error
        // response with id: null, not be silently dropped.
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n",
        );
        return;
      }
      const resp = await handleRequest(req);
      if (resp !== null) process.stdout.write(JSON.stringify(resp) + "\n");
    })
    // One bad line must never wedge the chain for every later request.
    .catch(() => {});
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    dispatch(line);
  }
  // Same cap applies to an unflushed in-progress line — drop the buffer
  // rather than letting a single message of any size eat the heap.
  if (buffer.length > MAX_LINE_BYTES) {
    process.stderr.write(
      `boosthis-node MCP: dropping ${buffer.length}-byte unframed input (exceeds 1MiB cap)\n`,
    );
    buffer = "";
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: unframed input exceeds 1MiB cap" } }) + "\n",
    );
  }
});

process.stdin.on("end", () => process.exit(0));
