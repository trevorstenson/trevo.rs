---
title: "Keeping Secrets Out of Your Agent's Context"
date: "2025-12-27"
tags: ["AI", "javascript"]
description: "Reliably preventing sensitive data from leaking into Claude Code"
---

Over the last year, I've spent a lot of time working with agents for both work and side projects. One thing that consistently impresses me is their ability to accomplish the same task in multiple different ways. If I ask an agent to "find where my database connection string is defined", it might run `grep`, check `.env`, or just start listing files. It has options. This flexibility is a superpower, but it also means it can be surprisingly good at finding things I don't want it to see.

Almost every development project has a `.env` file or equivalent that manages sensitive keys for your code to use. Modern agents operate exactly the same as if *you* were the one running the command. This is fine for source code, but is undesirable for secrets! Claude Code provides a permissioning object in the `claude.json` schema for blocking specific tool uses that works extremely well for things like blocking `Read(./.env)`, but falls apart when the `Bash()` tool can creatively work around such limitations by using any command-line tool it can find at its disposal. Once this gets into the context window its potentially exposed to things like model provider logs or conversation history. Not ideal.

## Hook Redaction

Since the static deny-list is easily sidestepped by a creative agent, we need a mechanism that's a bit more reliable. This is where the [Hooks API](https://code.claude.com/docs/en/hooks-guide) comes in. It allows us to intercept tool calls like `Read()` or `Bash()` and modify their inputs before they actually run. By listening for the [PreToolUse](https://code.claude.com/docs/en/hooks#supported-hook-events) event, we can monitor the agent's intent and dynamically swap out sensitive file paths for safe ones.

The approach is straightforward:

1. Hook intercepts `Read` and `Bash` tool calls
2. Check if the target file matches sensitive patterns (`.env`, `*.pem`, `credentials.json`, etc.)
3. Create a redacted temp copy on-the-fly
4. Rewrite `file_path` to point to the redacted version
5. Claude sees the redacted content, original stays untouched

The goal is to maintain the data structure and relevant information while only redacting the sensitive parts. Here is what that transformation looks like in practice:

Your actual `.env`:

```bash
OPENAI_API_KEY=sk-proj-abc123secretkey789xyz
STRIPE_SECRET_KEY=sk_live_supersecretstripekey
DATABASE_URL=postgres://admin:hunter2@prod.db.com/main
DEBUG=true
PORT=3000
```

What Claude receives:

```bash
OPENAI_API_KEY=<REDACTED:OPENAI_PROJECT_KEY>
STRIPE_SECRET_KEY=<REDACTED:STRIPE_SECRET>
DATABASE_URL=postgres://<USER>:<REDACTED>@prod.db.com/main
DEBUG=true
PORT=3000
```

Non-secrets like `DEBUG=true` pass through untouched. The agent can still understand your config, as the redacted values maintain most of their structure, and highlight the core meaning of what they represent.

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

By returning `updatedInput`, we can rewrite any parameter the tool was about to use. The agent has no idea the path changed, and just reads the redacted temp file instead.

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

Returning `null` means means no modification occurs and the original file is read.

### Handling Bash

Bash is where it gets interesting. Even if you block `Read(.env)`, nothing stops the agent from running `cat .env` or `head -n 50 .env.local` or `grep API_KEY credentials.json`.

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

Connection strings are a bit different. I just scrub the credentials and leave the rest of the URI alone. This way, the agent can still figure out the database structure without ever seeing `admin:hunter2`.

## Caveats

This catches a large majority of Claude Code's file access patterns, but there are definitely gaps:

- **Dynamic path construction**: `cat $(echo ".env")` might slip through
- **Subprocesses**: If the agent runs a Python or Node script that reads `.env` internally, the hook won't intercept it
- **Encoded paths**: Base64 or other encodings won't be caught

For my usecases, this is more than enough in its current state.

## Try It

Check out the source code on [GitHub](https://github.com/trevorstenson/claude-redact-env) if you want to see the full implementation.

```bash
git clone https://github.com/trevorstenson/claude-redact-env
cd claude-redact-env
npm install && npm run build
node dist/cli.js install
```
