/**
 * claude-agents-just-bash
 *
 * A library for running Anthropic Agents SDK (Claude Code) within a
 * just-bash sandboxed virtual filesystem environment.
 *
 * @example Basic usage
 * ```typescript
 * import { SandboxedAgent } from 'claude-agents-just-bash';
 *
 * const agent = new SandboxedAgent({
 *   sandbox: {
 *     files: { '/data/input.txt': 'Hello World' },
 *     python: true,
 *   },
 *   claude: {
 *     model: 'claude-opus-4-5',
 *   },
 * });
 *
 * for await (const message of agent.run('Read /data/input.txt and tell me what it contains')) {
 *   if (message.type === 'assistant') {
 *     console.log(message.message.content);
 *   }
 * }
 *
 * const { files } = await agent.exportFiles('/home/user');
 * ```
 */

// Main agent class
export { SandboxedAgent } from "./agent.js";

// MCP server utilities
export {
  createJustBashMcpServer,
  MCP_SERVER_NAME,
  MCP_BASH_TOOL_NAME,
} from "./mcp.js";

// Filesystem export utilities
export {
  exportFiles,
  exportFile,
  exportFileBuffer,
  writeFilesToDisk,
} from "./export.js";

// Re-export all extensible just-bash primitives for advanced usage
export {
  // Core
  Bash,
  defineCommand,
  // Filesystem implementations
  InMemoryFs,
  OverlayFs,
  ReadWriteFs,
  MountableFs,
  // AST transforms
  BashTransformPipeline,
  TeePlugin,
  CommandCollectorPlugin,
  serialize as serializeBash,
  parse as parseBash,
  // Security
  DefenseInDepthBox,
  SecurityViolationError,
  SecurityViolationLogger,
  createConsoleViolationCallback,
  // Sandbox API (Vercel-compatible)
  Sandbox as BashSandbox,
  SandboxCommand as BashSandboxCommand,
} from "just-bash";

// Re-export key Claude Agent SDK types/functions for advanced usage
export {
  query as agentQuery,
  createSdkMcpServer,
  tool as defineMcpTool,
  forkSession,
  listSessions,
  getSessionInfo,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";

// Types
export type {
  SandboxedAgentOptions,
  SandboxOptions,
  ClaudeOptions,
  RunOptions,
  ExportedFiles,
  ExecutionLimits,
  SDKMessage,
  SDKResultMessage,
  AgentOptions,
  AgentDefinition,
  CustomCommand,
  CommandName,
  IFileSystem,
  NetworkConfig,
  JavaScriptConfig,
  BashTransformResult,
  TransformPlugin,
} from "./types.js";

// Additional just-bash types
export type {
  BashOptions,
  BashLogger,
  ExecOptions,
  FsStat,
  InitialFiles,
  FileContent,
  MountableFsOptions as MountableFsOptionsType,
  MountConfig,
  OverlayFsOptions,
  ReadWriteFsOptions,
  AllowedUrl,
  NetworkConfig as NetworkAccessConfig,
  CommandCollectorMetadata,
  TeePluginOptions,
} from "just-bash";
