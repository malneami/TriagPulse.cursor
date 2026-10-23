/** Print a ready-to-paste MCP client config for the Node/Express rule server.
 *
 * Mirrors the Python CLI's `boosthis mcp-config` output so connecting the
 * plugin is copy-paste, not hand-assembly. Run with:
 *   `pnpm --filter @workspace/boosthis-runtime-node run mcp-config`
 */

const args = ["--filter", "@workspace/boosthis-runtime-node", "run", "mcp"];
const env = {
  BOOSTHIS_PROJECT_ROOT: "<absolute path to the app that has the kit installed>",
};

const config = {
  mcpServers: {
    "boosthis-node": {
      command: "pnpm",
      args,
      env,
    },
  },
};

// An AI tool starts this command directly, with no shell. On Windows `pnpm`
// is a script (pnpm.cmd), which only starts through cmd /c.
const windowsConfig = {
  mcpServers: {
    "boosthis-node": {
      command: "cmd",
      args: ["/c", "pnpm", ...args],
      env,
    },
  },
};

process.stdout.write(
  "# Paste this into your AI tool's MCP config\n" +
    "# (Claude Desktop: claude_desktop_config.json \u00b7 Cursor: .cursor/mcp.json \u00b7 Replit AI: MCP settings)\n\n" +
    JSON.stringify(config, null, 2) +
    "\n\n" +
    "# On Windows, `pnpm` is a script (pnpm.cmd) that an AI tool cannot start\n" +
    "# without a shell. There, paste this form instead; it starts the same\n" +
    "# server through cmd /c:\n\n" +
    JSON.stringify(windowsConfig, null, 2) +
    "\n\n" +
    "# BOOSTHIS_PROJECT_ROOT names the app whose state this server may read.\n" +
    "# Kit state is kept per application root, so two services on one machine\n" +
    "# never see each other's install \u2014 and your AI tool starts this server\n" +
    "# from its own working directory, not the app's. Point it at the app and\n" +
    "# the live tools below pick up that install's id and read token with\n" +
    "# nothing to copy; leave it out and they serve the on-device note.\n\n" +
    "# Optional \u2014 let the AI read this app's LIVE per-route meter (the four\n" +
    "# live-data tools: session_summary / recent_samples / budgets /\n" +
    "# what_should_i_look_at_next). Add an \"env\" block to the boosthis-node\n" +
    "# server above with credentials from this kit's own localhost-only\n" +
    "# GET /_boosthis/connect, or from the \"Connect AI\" card on this\n" +
    "# project's row in the Boosthis dashboard. On Windows, keep the cmd /c\n" +
    "# form's \"command\" and \"args\" and add the same block:\n" +
    "#\n" +
    "#   \"boosthis-node\": {\n" +
    "#     \"command\": \"pnpm\",\n" +
    "#     \"args\": [\"--filter\", \"@workspace/boosthis-runtime-node\", \"run\", \"mcp\"],\n" +
    "#     \"env\": {\n" +
    "#       \"BOOSTHIS_INSTALL_ID\": \"<install id from the dashboard>\",\n" +
    "#       \"BOOSTHIS_READ_TOKEN\": \"<read token from the dashboard>\"\n" +
    "#     }\n" +
    "#   }\n" +
    "#\n" +
    "# Without these the live-data tools return a note pointing at the dashboard.\n" +
    "# To read over Boosthis's HOSTED MCP instead, the dashboard's card prints a\n" +
    "# ready-to-paste { \"url\": \"\u2026/mcp\", \"headers\": { \"Authorization\": \"Bearer\n" +
    "# <YOUR_PROJECT_KEY>\" } } config; pass the install id + read token as tool\n" +
    "# arguments. (Optional: set BOOSTHIS_ENDPOINT to point at a self-hosted server.)\n",
);
