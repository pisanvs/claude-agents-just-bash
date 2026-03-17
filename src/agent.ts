/**
 * SandboxedAgent - A sandboxed Claude agent backed by just-bash.
 *
 * Combines the Anthropic Agents SDK (claude-agent-sdk) with just-bash to
 * create isolated agent instances where Claude executes bash commands inside
 * a virtual in-memory filesystem instead of the real host filesystem.
 */

import { Bash, BashTransformPipeline } from "just-bash";
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createJustBashMcpServer, MCP_BASH_TOOL_NAME } from "./mcp.js";
import {
  exportFiles,
  exportFile,
  exportFileBuffer,
  writeFilesToDisk,
} from "./export.js";
import type {
  SandboxedAgentOptions,
  SandboxOptions,
  ClaudeOptions,
  RunOptions,
  ExportedFiles,
  TransformPlugin,
} from "./types.js";

export class SandboxedAgent {
  /**
   * The underlying just-bash instance. Access this to manipulate the
   * sandbox filesystem directly, register commands, or add transforms.
   */
  public readonly bash: Bash;

  private readonly claudeOptions: ClaudeOptions;

  constructor(options: SandboxedAgentOptions = {}) {
    const sandbox: SandboxOptions = options.sandbox ?? {};
    this.claudeOptions = options.claude ?? {};

    // Build Bash constructor options
    this.bash = new Bash({
      ...(sandbox.files ? { files: sandbox.files as Record<string, string> } : {}),
      ...(sandbox.env ? { env: sandbox.env } : {}),
      ...(sandbox.cwd ? { cwd: sandbox.cwd } : {}),
      ...(sandbox.fs ? { fs: sandbox.fs } : {}),
      ...(sandbox.executionLimits
        ? { executionLimits: sandbox.executionLimits }
        : {}),
      python: sandbox.python ?? false,
      javascript: sandbox.javascript ?? false,
      ...(sandbox.network ? { network: sandbox.network } : {}),
      ...(sandbox.customCommands
        ? { customCommands: sandbox.customCommands }
        : {}),
      ...(sandbox.commands ? { commands: sandbox.commands } : {}),
    });

    // Register any AST transform plugins
    if (sandbox.transformPlugins) {
      for (const plugin of sandbox.transformPlugins) {
        this.bash.registerTransformPlugin(plugin as TransformPlugin<unknown>);
      }
    }
  }

  /**
   * Run a prompt through the sandboxed Claude agent.
   *
   * The agent will use just-bash as its only execution environment.
   * All bash commands issued by Claude will run inside the virtual sandbox.
   *
   * @param prompt - The user prompt to send to the agent
   * @param runOptions - Optional per-run overrides
   * @returns Async iterable of SDK messages from the agent
   *
   * @example
   * ```typescript
   * const agent = new SandboxedAgent();
   * for await (const message of agent.run('Write a hello world script')) {
   *   if (message.type === 'result') {
   *     console.log('Final result:', message.result);
   *   }
   * }
   * ```
   */
  run(
    prompt: string,
    runOptions: RunOptions = {}
  ): AsyncIterable<SDKMessage> & {
    getResult(): Promise<SDKResultMessage>;
  } {
    const mcpServer = createJustBashMcpServer(this.bash);

    const agentQuery = query({
      prompt,
      options: {
        // Disable ALL built-in Claude Code tools — agent uses only our MCP bash
        tools: [],

        // Auto-allow our sandboxed bash tool (no permission prompts)
        allowedTools: [MCP_BASH_TOOL_NAME],

        // Register the just-bash MCP server
        mcpServers: {
          [mcpServer.name]: mcpServer,
        },

        // Don't persist session by default (ephemeral sandboxed run)
        persistSession: this.claudeOptions.persistSession ?? false,

        // Model selection
        ...(this.claudeOptions.model ? { model: this.claudeOptions.model } : {}),

        // API key (optional, if provided)
        ...(this.claudeOptions.apiKey
          ? { apiKey: this.claudeOptions.apiKey }
          : {}),

        // System prompt
        ...(this.claudeOptions.systemPrompt
          ? { systemPrompt: this.claudeOptions.systemPrompt }
          : {}),

        // Turn limits
        maxTurns:
          runOptions.maxTurns ??
          this.claudeOptions.maxTurns,

        // Budget
        ...(this.claudeOptions.maxBudgetUsd
          ? { maxBudgetUsd: this.claudeOptions.maxBudgetUsd }
          : {}),

        // Sub-agents
        ...(this.claudeOptions.agents
          ? { agents: this.claudeOptions.agents }
          : {}),

        // Streaming events
        includePartialMessages:
          this.claudeOptions.includePartialMessages ?? false,

        // Abort control
        ...(runOptions.abortController ??
        this.claudeOptions.abortController
          ? {
              abortController:
                runOptions.abortController ??
                this.claudeOptions.abortController,
            }
          : {}),
      },
    });

    // Expose a convenience method to await the final result message
    const getResult = async (): Promise<SDKResultMessage> => {
      let resultMessage: SDKResultMessage | undefined;
      for await (const message of agentQuery) {
        if (message.type === "result") {
          resultMessage = message;
        }
      }
      if (!resultMessage) {
        throw new Error("Agent did not produce a result message");
      }
      return resultMessage;
    };

    return Object.assign(agentQuery, { getResult });
  }

  /**
   * Export all files from the sandbox filesystem.
   *
   * @param pathPrefix - Optional prefix to filter files (e.g. '/home/user')
   * @returns Object with text files map and list of binary file paths
   *
   * @example
   * ```typescript
   * const { files, binaryFiles } = await agent.exportFiles('/home/user');
   * for (const [path, content] of Object.entries(files)) {
   *   console.log(`${path}:\n${content}`);
   * }
   * ```
   */
  exportFiles(pathPrefix?: string): Promise<ExportedFiles> {
    return exportFiles(this.bash, pathPrefix);
  }

  /**
   * Export a specific file from the sandbox filesystem as a string.
   *
   * @param filePath - Absolute path inside the sandbox (e.g. '/home/user/script.sh')
   * @returns File content as a UTF-8 string
   */
  exportFile(filePath: string): Promise<string> {
    return exportFile(this.bash, filePath);
  }

  /**
   * Export a specific file from the sandbox filesystem as binary data.
   *
   * @param filePath - Absolute path inside the sandbox
   * @returns File content as a Uint8Array
   */
  exportFileBuffer(filePath: string): Promise<Uint8Array> {
    return exportFileBuffer(this.bash, filePath);
  }

  /**
   * Export all sandbox files to a directory on the real filesystem.
   *
   * @param outputDir - Destination directory path (will be created if needed)
   * @param options.stripPrefix - Path prefix to strip from sandbox paths
   *
   * @example
   * ```typescript
   * await agent.exportFilesToDisk('./output', { stripPrefix: '/home/user' });
   * ```
   */
  async exportFilesToDisk(
    outputDir: string,
    options: { stripPrefix?: string; pathPrefix?: string } = {}
  ): Promise<ExportedFiles> {
    const exported = await exportFiles(this.bash, options.pathPrefix);
    await writeFilesToDisk(exported, outputDir, {
      stripPrefix: options.stripPrefix,
    });
    return exported;
  }

  /**
   * Convenience method: run an agent prompt and wait for the final result,
   * then export files to a directory.
   *
   * @param prompt - The user prompt
   * @param outputDir - Directory to export files to
   * @param options - Run and export options
   * @returns The agent result message
   */
  async runAndExport(
    prompt: string,
    outputDir: string,
    options: RunOptions & { stripPrefix?: string; pathPrefix?: string } = {}
  ): Promise<{ result: SDKResultMessage; exported: ExportedFiles }> {
    const { stripPrefix, pathPrefix, ...runOptions } = options;

    // Stream through messages and capture result
    let resultMessage: SDKResultMessage | undefined;
    for await (const message of this.run(prompt, runOptions)) {
      if (message.type === "result") {
        resultMessage = message;
      }
    }

    if (!resultMessage) {
      throw new Error("Agent did not produce a result message");
    }

    const exported = await this.exportFilesToDisk(outputDir, {
      stripPrefix,
      pathPrefix,
    });

    return { result: resultMessage, exported };
  }

  /**
   * Create a BashTransformPipeline for transforming bash scripts before execution.
   * Useful for instrumenting scripts with logging or collecting metadata.
   *
   * @returns A new BashTransformPipeline instance
   */
  createTransformPipeline(): BashTransformPipeline {
    return new BashTransformPipeline();
  }
}
