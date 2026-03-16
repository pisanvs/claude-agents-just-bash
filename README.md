# claude-agents-just-bash

Run the [Anthropic Agents SDK](https://platform.claude.com/docs/en/agent-sdk/overview) (Claude Code) within a [just-bash](https://github.com/vercel-labs/just-bash) sandboxed virtual filesystem environment.

Instead of executing bash commands on your real host system, Claude's tool calls are routed through just-bash's in-memory virtual filesystem — giving you full isolation, reproducibility, and the ability to export the resulting filesystem as a final product.

## Features

- 🔒 **Sandboxed execution** — All Claude bash commands run in a just-bash virtual environment, never touching the real filesystem
- 🚀 **CLI first-class citizen** — `claude-sandbox` CLI for rapid agent dispatch
- 📁 **Filesystem export** — Export the sandbox filesystem (or a specific file) as a final product after agent execution
- 🔌 **All just-bash extensible features**:
  - Custom bash commands (`defineCommand`)
  - Multiple filesystem backends: `InMemoryFs`, `OverlayFs`, `ReadWriteFs`, `MountableFs`
  - Optional Python support (CPython WASM)
  - Optional JavaScript support (QuickJS WASM)
  - Network access control (URL prefix allow-list)
  - AST transform plugins (`BashTransformPipeline`, `TeePlugin`, `CommandCollectorPlugin`)
  - Execution limits (prevent runaway compute)
- 🤖 **Full Claude Agent SDK support** — sub-agents, custom system prompts, model selection, session management

## Installation

```sh
npm install claude-agents-just-bash

# Or install globally for the CLI
npm install -g claude-agents-just-bash
```

## Quick Start

### Library

```typescript
import { SandboxedAgent } from 'claude-agents-just-bash';

const agent = new SandboxedAgent({
  sandbox: {
    files: {
      '/data/input.txt': 'name,score\nAlice,95\nBob,87\nCarol,92',
    },
  },
  claude: {
    model: 'claude-sonnet-4-5',
    maxTurns: 10,
  },
});

// Stream messages from the agent
for await (const message of agent.run('Analyze the CSV in /data/input.txt and create a summary report')) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') process.stdout.write(block.text);
    }
  }
}

// Export the generated files
const { files } = await agent.exportFiles('/home/user');
for (const [path, content] of Object.entries(files)) {
  console.log(`\n=== ${path} ===\n${content}`);
}
```

### CLI

```sh
# Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run a basic agent
claude-sandbox "Write a TypeScript function that sorts an array by multiple criteria"

# Mount a real project directory (reads from disk, writes stay in-memory)
claude-sandbox run "Add JSDoc comments to all functions" --root ./src --export ./output

# Export sandbox files after agent finishes
claude-sandbox run "Generate a REST API with tests" \
  --python \
  --output-dir ./generated \
  --strip-prefix /home/user

# Get structured JSON output
claude-sandbox run "Create a config file" --json > result.json

# Use a specific model with a custom system prompt
claude-sandbox run "Review this code for security issues" \
  --root ./project \
  --model claude-opus-4-5 \
  --system "You are a security expert. Be thorough and precise." \
  --max-turns 20
```

## API Reference

### `SandboxedAgent`

Main class that combines the Claude Agent SDK with a just-bash sandbox.

```typescript
const agent = new SandboxedAgent(options?: SandboxedAgentOptions);
```

#### Constructor Options

```typescript
interface SandboxedAgentOptions {
  sandbox?: SandboxOptions;  // just-bash configuration
  claude?: ClaudeOptions;    // Claude Agent SDK configuration
}

interface SandboxOptions {
  files?: Record<string, string | (() => string | Promise<string>)>; // Initial files
  env?: Record<string, string>;          // Environment variables
  cwd?: string;                          // Working directory (default: /home/user)
  fs?: IFileSystem;                      // Custom filesystem (OverlayFs, ReadWriteFs, etc.)
  executionLimits?: ExecutionLimits;     // Prevent runaway compute
  python?: boolean;                      // Enable Python (python3/python)
  javascript?: boolean | JavaScriptConfig; // Enable js-exec
  network?: NetworkConfig;               // Network access (disabled by default)
  customCommands?: CustomCommand[];      // Custom bash commands
  transformPlugins?: TransformPlugin[];  // AST transform plugins
}

interface ClaudeOptions {
  apiKey?: string;          // Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
  model?: string;           // Claude model ID
  systemPrompt?: string;    // Custom system prompt
  maxTurns?: number;        // Max conversation turns
  maxBudgetUsd?: number;    // Max cost budget in USD
  agents?: Record<string, AgentDefinition>; // Custom sub-agents
  persistSession?: boolean; // Save session (default: false)
  abortController?: AbortController;
}
```

#### Methods

```typescript
// Stream messages from the agent
agent.run(prompt: string, options?: RunOptions): AsyncIterable<SDKMessage> & { getResult(): Promise<SDKResultMessage> }

// Export all sandbox files to memory
agent.exportFiles(pathPrefix?: string): Promise<ExportedFiles>

// Export a specific file as a string
agent.exportFile(filePath: string): Promise<string>

// Export a specific file as binary
agent.exportFileBuffer(filePath: string): Promise<Uint8Array>

// Export all sandbox files to disk
agent.exportFilesToDisk(outputDir: string, options?: { stripPrefix?: string; pathPrefix?: string }): Promise<ExportedFiles>

// Convenience: run and export in one call
agent.runAndExport(prompt: string, outputDir: string, options?): Promise<{ result, exported }>
```

### Filesystem Backends

All just-bash filesystem implementations are re-exported:

```typescript
import {
  InMemoryFs,   // Pure in-memory (default)
  OverlayFs,    // Copy-on-write over real directory
  ReadWriteFs,  // Direct read-write to real directory
  MountableFs,  // Multiple filesystems at different mount points
} from 'claude-agents-just-bash';

// OverlayFs: reads from disk, writes stay in memory
const agent = new SandboxedAgent({
  sandbox: {
    fs: new OverlayFs({ root: '/path/to/project' }),
    cwd: '/home/user/project',
  },
});

// ReadWriteFs: writes go to disk (use with caution)
const agent = new SandboxedAgent({
  sandbox: {
    fs: new ReadWriteFs({ root: '/tmp/workspace' }),
  },
});

// MountableFs: combine multiple filesystems
const fs = new MountableFs({ base: new InMemoryFs() });
fs.mount('/data', new OverlayFs({ root: '/shared/data', readOnly: true }));
fs.mount('/workspace', new ReadWriteFs({ root: '/tmp/work' }));

const agent = new SandboxedAgent({ sandbox: { fs } });
```

### Custom Commands

```typescript
import { SandboxedAgent, defineCommand } from 'claude-agents-just-bash';

const fetchCommand = defineCommand('fetch-api', async (args, ctx) => {
  // Custom logic here
  const url = args[0];
  return { stdout: `Fetching ${url}...\n`, stderr: '', exitCode: 0 };
});

const agent = new SandboxedAgent({
  sandbox: {
    customCommands: [fetchCommand],
  },
});
```

### AST Transform Plugins

```typescript
import {
  SandboxedAgent,
  BashTransformPipeline,
  TeePlugin,
  CommandCollectorPlugin,
} from 'claude-agents-just-bash';

const agent = new SandboxedAgent({
  sandbox: {
    transformPlugins: [new CommandCollectorPlugin()],
  },
});

// Metadata is available on exec results
const result = await agent.bash.exec('echo hello | grep hello');
console.log(result.metadata?.commands); // ['echo', 'grep']

// Standalone pipeline (works without agent)
const pipeline = new BashTransformPipeline()
  .use(new TeePlugin({ outputDir: '/tmp/logs' }))
  .use(new CommandCollectorPlugin());

const { script, metadata } = pipeline.transform('echo hello | grep hello');
```

### Network Access

```typescript
const agent = new SandboxedAgent({
  sandbox: {
    network: {
      allowedUrlPrefixes: ['https://api.github.com/'],
      allowedMethods: ['GET', 'HEAD'],
    },
  },
});
```

## CLI Reference

```
Usage: claude-sandbox [options] [command] [prompt]

Commands:
  run [options] [prompt]   Run a prompt through a sandboxed Claude agent

Options:
  -V, --version            output the version number
  -h, --help               display help for command

Run Options:
  -p, --prompt <text>      The prompt (alternative to positional argument)
  --root <path>            Mount a real directory (OverlayFS: reads from disk, writes in memory)
  --rw-root <path>         Mount a real directory with read-write access
  --cwd <path>             Working directory inside the sandbox
  --python                 Enable Python (python3/python commands)
  --js, --javascript       Enable JavaScript (js-exec command)
  --network <urls...>      Allow network access to specific URL prefixes
  --allow-all-network      Allow unrestricted network access (unsafe)
  --files <json>           Initial files as JSON: '{"path": "content"}'
  --env <vars...>          Environment variables (KEY=VALUE format)
  --model <model>          Claude model (e.g. claude-opus-4-5)
  --system <prompt>        System prompt for the agent
  --max-turns <n>          Maximum conversation turns
  --max-budget <usd>       Maximum budget in USD
  --output-dir <path>      Export sandbox files to this directory
  --export-prefix <prefix> Filter exports by path prefix
  --strip-prefix <prefix>  Strip prefix from exported paths
  --json                   Output result as JSON
  --quiet                  Suppress progress output
```

## How It Works

1. **Sandbox creation**: A just-bash `Bash` instance is created with your configured filesystem, environment, and optional runtimes
2. **MCP server**: An in-process MCP server is created that wraps the just-bash instance as a `bash` tool
3. **Agent dispatch**: The Claude Agent SDK's `query()` function is called with:
   - All built-in Claude Code tools disabled (`tools: []`)
   - Only the just-bash MCP server's `bash` tool exposed
4. **Sandboxed execution**: Claude executes commands via the MCP tool, which runs them in just-bash
5. **Export**: After completion, use `exportFiles()` / `exportFilesToDisk()` to extract results

## Requirements

- Node.js 18+
- An Anthropic API key (`ANTHROPIC_API_KEY` environment variable)
- The `@anthropic-ai/claude-agent-sdk` package is included as a dependency and brings everything needed — no separate `claude` CLI installation is required

## License

ISC

