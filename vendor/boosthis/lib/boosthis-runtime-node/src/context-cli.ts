/**
 * Print the AI-agent context block for pasting into a consumer project's
 * `replit.md`. Run with:
 *
 *   pnpm --filter @workspace/boosthis-runtime-node run context
 */

import { renderMarkdownContext } from "./context";

process.stdout.write(renderMarkdownContext());
process.stdout.write("\n");
