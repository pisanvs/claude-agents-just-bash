/**
 * Creates an in-process MCP server that wraps a just-bash Bash instance.
 * This server exposes a single 'bash' tool that executes commands
 * in the sandboxed virtual filesystem.
 */

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { Bash } from "just-bash";

/**
 * The name used for the just-bash MCP server.
 * Tool will be accessible as 'just-bash__bash' in the agent.
 */
export const MCP_SERVER_NAME = "just-bash";

/**
 * The fully-qualified tool name for use in allowedTools.
 */
export const MCP_BASH_TOOL_NAME = `${MCP_SERVER_NAME}__bash`;

/**
 * Creates an MCP server configuration backed by a just-bash Bash instance.
 *
 * The server exposes a single `bash` tool that:
 * - Executes commands in the sandboxed virtual filesystem
 * - Returns combined stdout/stderr output
 * - Reports exit code as part of the result
 *
 * @param bash - The just-bash Bash instance to use for execution
 * @returns MCP server config with instance, ready to pass to claude-agent-sdk
 */
export function createJustBashMcpServer(
  bash: Bash
): McpSdkServerConfigWithInstance {
  const bashTool = tool(
    "bash",
    [
      "Execute a bash command or script in the sandboxed virtual filesystem environment.",
      "The environment supports standard Unix commands, pipes, redirections, variables,",
      "loops, functions, and all standard shell features.",
      "Files written persist across calls. The environment may have Python, JavaScript,",
      "and network access depending on how it was configured.",
    ].join(" "),
    {
      command: z
        .string()
        .describe(
          "The bash command or script to execute. Supports full bash syntax including pipes, redirections, variables, and control flow."
        ),
      cwd: z
        .string()
        .optional()
        .describe(
          "Optional working directory override for this command. Must be an absolute path."
        ),
      stdin: z
        .string()
        .optional()
        .describe("Optional stdin to pass to the command."),
    },
    async ({ command, cwd, stdin }) => {
      try {
        const result = await bash.exec(command, {
          ...(cwd ? { cwd } : {}),
          ...(stdin !== undefined ? { stdin } : {}),
        });

        const output = [
          result.stdout,
          result.stderr ? `[stderr]: ${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const text =
          output ||
          (result.exitCode === 0 ? "(no output)" : `(exit code: ${result.exitCode})`);

        return {
          content: [{ type: "text" as const, text }],
          isError: result.exitCode !== 0,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    tools: [bashTool],
  });
}
