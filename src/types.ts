/**
 * Types for the claude-agents-just-bash library.
 */

import type {
  BashOptions,
  CustomCommand,
  IFileSystem,
  NetworkConfig,
  JavaScriptConfig,
  BashTransformResult,
  TransformPlugin,
} from "just-bash";

/** Execution limits for the just-bash sandbox (alias of BashOptions['executionLimits']). */
export type ExecutionLimits = NonNullable<BashOptions["executionLimits"]>;
import type {
  Options as AgentOptions,
  AgentDefinition,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Options for configuring the sandboxed bash environment (just-bash).
 */
export interface SandboxOptions {
  /**
   * Initial files to populate in the sandbox filesystem.
   * Keys are absolute paths, values are file content strings or lazy providers.
   */
  files?: Record<string, string | (() => string | Promise<string>)>;

  /**
   * Initial environment variables for the sandbox.
   */
  env?: Record<string, string>;

  /**
   * Working directory inside the sandbox. Defaults to '/home/user'.
   */
  cwd?: string;

  /**
   * Custom filesystem implementation. If provided, overrides 'files'.
   * Supports InMemoryFs, OverlayFs, ReadWriteFs, MountableFs from just-bash.
   */
  fs?: IFileSystem;

  /**
   * Execution limits to prevent runaway compute.
   */
  executionLimits?: ExecutionLimits;

  /**
   * Enable Python support (python3/python commands via CPython WASM).
   */
  python?: boolean;

  /**
   * Enable JavaScript support (js-exec command via QuickJS WASM).
   * Pass a config object to provide bootstrap code.
   */
  javascript?: boolean | JavaScriptConfig;

  /**
   * Network access configuration for the sandbox.
   * Disabled by default. Configure allowed URL prefixes to enable.
   */
  network?: NetworkConfig;

  /**
   * Custom commands to register in the bash environment.
   */
  customCommands?: CustomCommand[];

  /**
   * AST transform plugins for instrumenting bash scripts.
   */
  transformPlugins?: TransformPlugin<unknown>[];

  /**
   * Restrict which built-in bash commands are available.
   * If not provided, all built-in commands are available.
   */
  commands?: string[];
}

/**
 * Options for configuring the Claude agent (Anthropic Agents SDK).
 */
export interface ClaudeOptions {
  /**
   * Anthropic API key. Defaults to ANTHROPIC_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Claude model to use. Defaults to the SDK default.
   */
  model?: string;

  /**
   * System prompt for the agent.
   * Can be a string or preset configuration.
   */
  systemPrompt?: string | { type: "preset"; preset: "claude_code"; append?: string };

  /**
   * Maximum number of conversation turns.
   */
  maxTurns?: number;

  /**
   * Maximum budget in USD for the query.
   */
  maxBudgetUsd?: number;

  /**
   * Custom sub-agent definitions.
   */
  agents?: Record<string, AgentDefinition>;

  /**
   * Whether to include partial/streaming message events.
   */
  includePartialMessages?: boolean;

  /**
   * Whether to persist the session to disk. Defaults to false for sandboxed runs.
   */
  persistSession?: boolean;

  /**
   * Abort controller for cancelling the query.
   */
  abortController?: AbortController;
}

/**
 * Full options for SandboxedAgent.
 */
export interface SandboxedAgentOptions {
  /**
   * Sandbox (just-bash) configuration.
   */
  sandbox?: SandboxOptions;

  /**
   * Claude agent configuration.
   */
  claude?: ClaudeOptions;
}

/**
 * Options for a single run() call.
 */
export interface RunOptions {
  /**
   * Abort controller for this specific run.
   */
  abortController?: AbortController;

  /**
   * Override max turns for this run.
   */
  maxTurns?: number;
}

/**
 * Result of exporting files from the sandbox.
 */
export interface ExportedFiles {
  /**
   * Map of file paths to their content.
   */
  files: Record<string, string>;

  /**
   * List of binary files that could not be exported as strings.
   */
  binaryFiles: string[];
}

export type {
  BashOptions,
  CustomCommand,
  IFileSystem,
  NetworkConfig,
  JavaScriptConfig,
  BashTransformResult,
  TransformPlugin,
  SDKMessage,
  SDKResultMessage,
  AgentOptions,
  AgentDefinition,
};
