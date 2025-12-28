---
title: "Keeping Secrets out of your Agent's Context"
date: "2025-12-27"
tags: ["AI", "javascript"]
description: "Reliably preventing sensitive data from leaking into Claude Code"
draft: true
---

During the last year of interfacing predominantly through agents for both professional and personal development workflows, one of the things i've been impressed by is the ability of agents to accomplish the same task in mutliple different ways. If I ask a computer-use agent to <insert example that has multiple ambiguous tool uses or paths. or multiple different bash commans (grep, bash, read, open)> , it may have many valid solutions. Using different native tools through `bash` (grep, find, etc) as well as built-in tools exposed to the model (such as `Read()`). This decision-making and constant adjustment to feedback is a superpower, but can sometimes provide too much access to your sensitive data.

Almost every development project has a `.env` file or equivalent that manages sensitive keys for your code to use. Modern agents operate exactly the same as if *you* were the one running the command. This is fine for source code, but is undesirable for secrets! Claude Code provides a permissioning object in the `claude.json` schema for blocking specific tool uses that works extremely well for things like blocking `Read(./.env)`, but falls apart when the `Bash()` tool can creatively work around such limitations by using any command-line tool it can find at its disposal. Once this gets into the context window its potentially exposed to things like model provider logs or conversation history. Not ideal.

## Hook Redaction

I wanted to find a way to more generalizably prevent unwanted access to these files <fix this sentence make it better (MAYBE REMOVE)>.

If Claude Code's tool deny-list can realistically be bypassed, we need a better mechanism for blocking these reads. All frontier model agent providers provide some sort of tooling for lifecycle hooks, and in the case of Claude Code this takes the form of the [Hooks API](https://code.claude.com/docs/en/hooks-guide). These hooks allow you to intercept, read, block, and - most importantly in our case - modify tool inputs, outputs, and behavior as needed. The [PreToolUse](https://code.claude.com/docs/en/hooks#supported-hook-events) hook event explicitly deals with making context-aware decisions based on the intent of tool uses before they execute. If we can utilize basic heuristics to dynamically modify what the tool sees, we can provide a better solution.

The approach is straightforward:

1. Hook intercepts `Read` and `Bash` tool calls
2. Check if the target file matches sensitive patterns (`.env`, `*.pem`, `credentials.json`, etc.)
3. Create a redacted temp copy on-the-fly
4. Rewrite `file_path` to point to the redacted version
5. Claude sees the redacted content, original stays untouched

## Implementation

The hook runs as a Node.js script that receives JSON from stdin and outputs modified JSON to stdout. Claude Code pipes tool call metadata through this interface before execution.

The hook output structure looks like this:

```javascript
{
  hookSpecificOutput: {
    permissionDecision: 'allow',
    updatedInput: {
      file_path: '/tmp/redacted-a1b2c3-.env'
    }
  }
}
```

By returning `updatedInput`, we can rewrite any parameter the tool was about to use. The agent has no idea the path changed—it just reads the redacted temp file instead.

### Handling Read

The `Read` tool is the simple case. We check if the file path matches sensitive patterns, create a redacted copy, and swap the path:

```typescript
function handleReadTool(input: HookInput): object | null {
  const filePath = input.tool_input.file_path;

  if (!filePath || !isSensitiveFile(filePath)) {
    return null;
  }

  const redactedPath = createRedactedFile(filePath);
  if (!redactedPath) {
    return null;
  }

  return {
    hookSpecificOutput: {
      permissionDecision: 'allow',
      updatedInput: {
        file_path: redactedPath,
      },
    },
  };
}
```

Returning `null` means "no modification"—let the original call through.

### Handling Bash

Bash is where it gets interesting. Agents are creative. Even if you block `Read(.env)`, nothing stops the agent from running `cat .env` or `head -n 50 .env.local` or `grep API_KEY credentials.json`.

To catch these, we need to:
1. Detect if the command reads files (`cat`, `head`, `tail`, `grep`, `awk`, `sed`, etc.)
2. Extract any sensitive file paths from the command string
3. Rewrite the command to use the redacted temp file

```typescript
const FILE_READ_COMMANDS = ['cat', 'head', 'tail', 'less', 'more', 'grep', 'awk', 'sed', 'bat', 'rg'];

function isFileReadCommand(command: string): boolean {
  return FILE_READ_COMMANDS.some(cmd => {
    const patterns = [
      new RegExp(`^${cmd}\\s`),       // cat .env
      new RegExp(`\\|\\s*${cmd}\\s`), // | cat
      new RegExp(`;\\s*${cmd}\\s`),   // ; cat
      new RegExp(`&&\\s*${cmd}\\s`),  // && cat
    ];
    return patterns.some(p => p.test(command));
  });
}
```

Once we identify a file-reading command, we scan for sensitive file patterns and rewrite:

```typescript
function handleBashTool(input: HookInput): object | null {
  const command = input.tool_input.command;

  if (!command || !isFileReadCommand(command)) {
    return null;
  }

  const filePath = extractSensitiveFilePath(command);
  if (!filePath || !isSensitiveFile(filePath)) {
    return null;
  }

  const redactedPath = createRedactedFile(filePath);
  if (!redactedPath) {
    return null;
  }

  const newCommand = command.replace(filePath, redactedPath);
  return {
    hookSpecificOutput: {
      permissionDecision: 'allow',
      updatedInput: {
        command: newCommand,
      },
    },
  };
}
```

So `cat .env` becomes `cat /tmp/redacted-a1b2c3-.env`. The agent gets the output it expects, just with secrets scrubbed.

## Pattern Detection

The redaction logic uses a list of regex patterns, ordered from specific to generic. Specific patterns like `sk_live_` need to match before the generic `KEY=value` fallback, otherwise you'd lose the structured replacement.

```typescript
export const SECRET_PATTERNS: SecretPattern[] = [
  // openai
  { regex: /sk-proj-[a-zA-Z0-9-_]{20,}/g, replace: '<REDACTED:OPENAI_PROJECT_KEY>' },
  { regex: /sk-[a-zA-Z0-9]{20,}/g, replace: '<REDACTED:OPENAI_KEY>' },

  // github
  { regex: /ghp_[a-zA-Z0-9]{36}/g, replace: '<REDACTED:GITHUB_PAT>' },
  { regex: /github_pat_[a-zA-Z0-9_]{22,}/g, replace: '<REDACTED:GITHUB_PAT>' },

  // aws
  { regex: /AKIA[0-9A-Z]{16}/g, replace: '<REDACTED:AWS_ACCESS_KEY>' },

  // stripe
  { regex: /sk_live_[a-zA-Z0-9]{24,}/g, replace: '<REDACTED:STRIPE_SECRET>' },

  // connection strings (preserve structure)
  { regex: /(postgres(ql)?:\/\/)[^:]+:[^@]+@/gi, replace: '$1<USER>:<REDACTED>@' },
  { regex: /(mongodb(\+srv)?:\/\/)[^:]+:[^@]+@/gi, replace: '$1<USER>:<REDACTED>@' },

  // pem keys
  {
    regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED |)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g,
    replace: '-----BEGIN PRIVATE KEY-----\n<REDACTED>\n-----END PRIVATE KEY-----'
  },

  // generic fallback (must come last)
  {
    regex: /^([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|PWD|PASS)[A-Z0-9_]*)\s*=\s*["']?(?!<REDACTED)(.{8,})["']?$/gim,
    replace: '$1=<REDACTED>'
  },
];
```

Connection strings get special treatment—credentials are replaced while the rest of the URI stays intact, so the agent can still understand the database structure without seeing `admin:hunter2`.

## What Claude Sees

Your actual `.env`:

```
OPENAI_API_KEY=sk-proj-abc123secretkey789xyz
STRIPE_SECRET_KEY=sk_live_supersecretstripekey
DATABASE_URL=postgres://admin:hunter2@prod.db.com/main
DEBUG=true
PORT=3000
```

What Claude receives:

```
OPENAI_API_KEY=<REDACTED:OPENAI_PROJECT_KEY>
STRIPE_SECRET_KEY=<REDACTED:STRIPE_SECRET>
DATABASE_URL=postgres://<USER>:<REDACTED>@prod.db.com/main
DEBUG=true
PORT=3000
```

Non-secrets like `DEBUG=true` pass through untouched. The agent can still understand your config—it just can't see the actual values that matter.

## Caveats

This catches roughly 95% of typical agent file access patterns. But there are gaps:

- **Dynamic path construction**: `cat $(echo ".env")` might slip through
- **Subprocesses**: If the agent runs a Python or Node script that reads `.env` internally, the hook won't intercept it
- **Write operations**: This only protects reads—if the agent already knows a secret from earlier context, it can still write it somewhere
- **Encoded paths**: Base64 or other encodings won't be caught

For the common case of "Claude, help me debug my environment config"—it works.

## Try It

```bash
git clone https://github.com/yourusername/claude-redact-env
cd claude-redact-env
npm install && npm run build
node dist/cli.js install
```

Then fully restart Claude Code (Cmd+Q / Ctrl+Q—not just a new session). Hooks only load on startup.

The source is on [GitHub](https://github.com/yourusername/claude-redact-env) if you want to extend the patterns or poke at the implementation.