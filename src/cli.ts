#!/usr/bin/env node
/**
 * claude-sandbox CLI
 *
 * Dispatch sandboxed Claude agents from the command line.
 *
 * Usage:
 *   claude-sandbox "Write a TypeScript sorting function"
 *   claude-sandbox run "Analyze this data" --root ./project --export ./output
 *   claude-sandbox run --prompt "Fix this code" --python --js --max-turns 20
 *   claude-sandbox run "Generate a report" --output-dir ./results --json
 */

import { Command, Option } from "commander";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { SandboxedAgent } from "./agent.js";
import { OverlayFs, ReadWriteFs } from "just-bash";
import type { SandboxOptions, ClaudeOptions } from "./types.js";

// Read package.json for version
const require = createRequire(import.meta.url);
let version = "1.0.0";
try {
  const pkg = require("../package.json") as { version: string };
  version = pkg.version;
} catch {
  // fallback
}

const program = new Command();

program
  .name("claude-sandbox")
  .description(
    "Run Claude agents in a sandboxed just-bash virtual environment."
  )
  .version(version);

/**
 * Shared sandbox and Claude options used by the run command.
 */
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option(
      "--root <path>",
      "Mount a real directory as the project root using OverlayFS (reads from disk, writes stay in memory)"
    )
    .option(
      "--rw-root <path>",
      "Mount a real directory with read-write access (writes go to disk)"
    )
    .option(
      "--cwd <path>",
      "Working directory inside the sandbox (default: /home/user)"
    )
    .option("--python", "Enable Python (python3/python commands via WASM)")
    .option(
      "--js, --javascript",
      "Enable JavaScript (js-exec command via QuickJS WASM)"
    )
    .option(
      "--network <urls...>",
      "Allow network access to specific URL prefixes (e.g. https://api.example.com)"
    )
    .option("--allow-all-network", "Allow unrestricted network access (unsafe)")
    .option(
      "--files <json>",
      "Initial files as JSON string: '{\"path\": \"content\", ...}'"
    )
    .option(
      "--env <vars...>",
      "Environment variables for the sandbox (KEY=VALUE format)"
    )
    .option(
      "--model <model>",
      "Claude model to use (e.g. claude-opus-4-5, claude-sonnet-4-5)"
    )
    .option("--system <prompt>", "System prompt for the agent")
    .option(
      "--max-turns <n>",
      "Maximum number of conversation turns",
      parseInt
    )
    .option(
      "--max-budget <usd>",
      "Maximum budget in USD",
      parseFloat
    )
    .option(
      "--output-dir <path>",
      "Export sandbox files to this directory after the agent finishes"
    )
    .option(
      "--export-prefix <prefix>",
      "Sandbox path prefix to include when exporting (e.g. /home/user)"
    )
    .option(
      "--strip-prefix <prefix>",
      "Strip this prefix from exported file paths (e.g. /home/user)"
    )
    .option(
      "--json",
      "Output final result as JSON (includes all SDK messages)"
    )
    .option(
      "--quiet",
      "Suppress progress output, only show the final result"
    )
    .option(
      "--no-persist",
      "Do not persist the session to disk (default: true for sandboxed runs)"
    );
}

/**
 * Parse shared options into SandboxOptions and ClaudeOptions.
 */
function parseOptions(opts: Record<string, unknown>): {
  sandbox: SandboxOptions;
  claude: ClaudeOptions;
} {
  const sandbox: SandboxOptions = {};
  const claude: ClaudeOptions = {};

  // Filesystem configuration
  if (opts.root) {
    const rootPath = resolve(opts.root as string);
    const overlay = new OverlayFs({ root: rootPath });
    sandbox.fs = overlay;
    if (!opts.cwd) {
      sandbox.cwd = overlay.getMountPoint();
    }
  } else if (opts.rwRoot) {
    const rwPath = resolve(opts.rwRoot as string);
    const rwfs = new ReadWriteFs({ root: rwPath });
    sandbox.fs = rwfs;
    if (!opts.cwd) {
      sandbox.cwd = "/home/user";
    }
  }

  if (opts.cwd) sandbox.cwd = opts.cwd as string;

  // Initial files
  if (opts.files) {
    try {
      sandbox.files = JSON.parse(opts.files as string) as Record<string, string>;
    } catch {
      console.error("Error: --files must be valid JSON");
      process.exit(1);
    }
  }

  // Environment variables
  if (opts.env) {
    const envVars: Record<string, string> = {};
    for (const envStr of opts.env as string[]) {
      const eqIdx = (envStr as string).indexOf("=");
      if (eqIdx === -1) {
        console.error(`Error: invalid env var format '${envStr}' (expected KEY=VALUE)`);
        process.exit(1);
      }
      envVars[(envStr as string).substring(0, eqIdx)] = (envStr as string).substring(eqIdx + 1);
    }
    sandbox.env = envVars;
  }

  // Optional runtimes
  if (opts.python) sandbox.python = true;
  if (opts.javascript || opts.js) sandbox.javascript = true;

  // Network configuration
  if (opts.allowAllNetwork) {
    sandbox.network = { dangerouslyAllowFullInternetAccess: true } as SandboxOptions["network"];
  } else if (opts.network) {
    sandbox.network = {
      allowedUrlPrefixes: opts.network as string[],
    };
  }

  // Claude options
  if (opts.model) claude.model = opts.model as string;
  if (opts.system) claude.systemPrompt = opts.system as string;
  if (opts.maxTurns) claude.maxTurns = opts.maxTurns as number;
  if (opts.maxBudget) claude.maxBudgetUsd = opts.maxBudget as number;

  // Session persistence (default off for sandboxed runs)
  if (opts.persist && opts.noPersist) {
    console.error("Error: cannot use both --persist and --no-persist flags at the same time");
    process.exit(1);
  }

  if (opts.persist) {
    claude.persistSession = true;
  } else if (opts.noPersist) {
    claude.persistSession = false;
  } else {
    // Default behavior: do not persist sessions for sandboxed runs
    claude.persistSession = false;
  }

  return { sandbox, claude };
}

/**
 * The main `run` command.
 */
const runCmd = new Command("run")
  .description("Run a prompt through a sandboxed Claude agent")
  .argument("[prompt]", "The prompt to send to the agent")
  .option("-p, --prompt <text>", "The prompt (alternative to positional argument)")
  .action(async (promptArg: string | undefined, opts: Record<string, unknown>) => {
    const prompt = promptArg || (opts.prompt as string | undefined);

    if (!prompt) {
      console.error(
        "Error: provide a prompt as an argument or with --prompt"
      );
      process.exit(1);
    }

    const parentOpts = runCmd.optsWithGlobals() as Record<string, unknown>;
    const { sandbox, claude } = parseOptions(parentOpts);

    const agent = new SandboxedAgent({ sandbox, claude });

    const isJson = Boolean(parentOpts.json);
    const isQuiet = Boolean(parentOpts.quiet);
    const outputDir = parentOpts.outputDir as string | undefined;
    const exportPrefix = parentOpts.exportPrefix as string | undefined;
    const stripPrefix = parentOpts.stripPrefix as string | undefined;

    const collectedMessages: unknown[] = [];
    let resultText = "";

    try {
      for await (const message of agent.run(prompt)) {
        if (isJson) {
          collectedMessages.push(message);
        }

        if (!isQuiet) {
          switch (message.type) {
            case "assistant": {
              // Print assistant text content
              const content = (
                message as {
                  message: { content: Array<{ type: string; text?: string }> };
                }
              ).message.content;
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  process.stdout.write(block.text);
                }
              }
              break;
            }
            case "result": {
              const resultMsg = message as {
                subtype: string;
                result: string;
                is_error: boolean;
                total_cost_usd: number;
              };
              resultText = resultMsg.result;
              if (!isJson && resultMsg.result) {
                if (!isQuiet) {
                  process.stdout.write("\n\n--- Result ---\n");
                  console.log(resultMsg.result);
                  if (resultMsg.total_cost_usd) {
                    console.error(
                      `\nCost: $${resultMsg.total_cost_usd.toFixed(6)}`
                    );
                  }
                }
              }
              break;
            }
            case "system": {
              const sysMsg = message as { subtype: string; cwd?: string };
              if (!isQuiet && sysMsg.subtype === "init") {
                console.error("[claude-sandbox] Agent initialized");
              }
              break;
            }
          }
        }
      }
    } catch (err) {
      if (isJson) {
        console.error(
          JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        );
      } else {
        console.error(
          "\nError:",
          err instanceof Error ? err.message : String(err)
        );
      }
      process.exit(1);
    }

    // Export files if requested
    let exportedFiles: { files: Record<string, string>; binaryFiles: string[] } | undefined;
    if (outputDir) {
      exportedFiles = await agent.exportFilesToDisk(outputDir, {
        pathPrefix: exportPrefix,
        stripPrefix: stripPrefix ?? exportPrefix,
      });

      if (!isQuiet && !isJson) {
        const count = Object.keys(exportedFiles.files).length;
        console.error(
          `\n[claude-sandbox] Exported ${count} file(s) to ${outputDir}`
        );
        if (exportedFiles.binaryFiles.length > 0) {
          console.error(
            `[claude-sandbox] ${exportedFiles.binaryFiles.length} binary file(s) skipped: ${exportedFiles.binaryFiles.join(", ")}`
          );
        }
      }
    }

    if (isJson) {
      const output: Record<string, unknown> = {
        messages: collectedMessages,
        result: resultText,
      };
      if (exportedFiles) {
        output.exported = exportedFiles;
      }
      console.log(JSON.stringify(output, null, 2));
    }
  });

addSharedOptions(runCmd);

program.addCommand(runCmd);

// Allow `claude-sandbox "prompt"` as a shorthand for `claude-sandbox run "prompt"`
program
  .argument("[prompt]", "Shorthand: run this prompt directly")
  .action(async (prompt: string | undefined, _opts: unknown, cmd: Command) => {
    if (prompt) {
      // Delegate to the run command by re-parsing
      const args = ["run", prompt, ...process.argv.slice(3)];
      await program.parseAsync(args, { from: "user" });
    } else {
      program.help();
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
