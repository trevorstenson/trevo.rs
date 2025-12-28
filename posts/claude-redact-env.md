---
title: "Hiding Secrets from Your AI Pair Programmer"
date: "2024-12-26"
tags: ["javascript", "claude", "security"]
description: "A Claude Code hook that automatically redacts secrets before the AI can see them"
draft: true
---

Over the holiday break, I've been doing what any reasonable person does with their time off: pair programming with an AI agent. Claude Code has become my go-to for hacking on side projects, and it's genuinely useful. But there's a problem I kept running into.

Claude just read my `.env` file. All of it. My OpenAI API key, my Stripe secret, my database password—now sitting in the conversation context.

AI coding agents operate with your permissions. When Claude reads a file, it reads it as *you*. This is fine for source code, but for secrets? Once they're in the context window, they're potentially exposed to model provider logs, conversation history, and whatever else happens on the backend. Not ideal.

## The Problem

Existing secret-detection tools like `detect-secrets` or Vault Radar are designed to prevent secrets from being *committed*. They're pre-commit hooks. But they don't help when an AI agent reads your `.env` during a coding session—the secrets are already in the conversation by the time you'd catch them.

What we need is just-in-time redaction: intercept the file read and swap in a sanitized version before the AI ever sees the original.

## Claude Code Hooks

Turns out, Claude Code has exactly the mechanism for this: [PreToolUse hooks](https://docs.anthropic.com/en/docs/claude-code/hooks). These let you run custom scripts before tool calls execute.

The key insight is that hooks can *modify* tool inputs, not just block them. You can intercept a `Read` tool call, change the `file_path` parameter, and Claude will read from the new path instead—without ever knowing the swap happened.

So the approach is simple:

1. Hook intercepts `Read` and `Bash` tool calls
2. Check if the target file matches sensitive patterns (`.env`, `*.pem`, `credentials.json`, etc.)
3. Create a redacted temp copy on-the-fly
4. Rewrite `file_path` to point to the redacted version
5. Claude sees the redacted content, original stays untouched

The hook returns something like this:

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

Claude has no idea the path was rewritten. It just gets the redacted file.

## What Claude Actually Sees

Here's the before and after. Your actual `.env`:

```
OPENAI_API_KEY=sk-proj-abc123secretkey789xyz
STRIPE_SECRET_KEY=sk_live_supersecretstripekey
DATABASE_URL=postgres://admin:hunter2@prod.db.com/main
DEBUG=true
PORT=3000
```

What Claude receives:

```
OPENAI_API_KEY=<REDACTED:OPENAI_KEY>
STRIPE_SECRET_KEY=<REDACTED:STRIPE_SECRET>
DATABASE_URL=postgres://<USER>:<REDACTED>@prod.db.com/main
DEBUG=true
PORT=3000
```

Non-secrets like `DEBUG=true` pass through untouched. Claude can still understand your config, it just can't see the actual credential values.

## What Gets Redacted

The tool catches the usual suspects:

- **API keys**: OpenAI (`sk-...`), GitHub (`ghp_...`, `github_pat_...`), AWS (`AKIA...`), Stripe (`sk_live_...`)
- **Connection strings**: Postgres, MySQL, MongoDB, Redis URIs with embedded passwords
- **Private keys**: PEM format RSA/EC keys
- **Generic patterns**: Anything matching `PASSWORD=`, `SECRET=`, `API_KEY=`, etc.
- **Sensitive files**: `.env`, `.env.*`, `credentials.json`, `secrets.yaml`, `.pgpass`, `.netrc`

## Caveats

This isn't bulletproof. For typical agent behavior—Claude asking to read your config files—it catches about 95% of cases. But there are gaps:

- Dynamic path construction (`cat $(echo ".env")`) might evade detection
- Subprocesses spawned by the agent don't go through Claude Code's tools
- This only protects reads; if the agent already knows a secret from earlier context, it can still write it

That said, for the common case of "Claude, check my environment config"—it works.

## Try It

If you want to set this up:

```bash
git clone https://github.com/yourusername/claude-redact-env
cd claude-redact-env
npm install && npm run build
node dist/cli.js install
```

Then fully restart Claude Code (Cmd+Q / Ctrl+Q—not just a new session). Hooks only load on startup.

The source is on [GitHub](https://github.com/yourusername/claude-redact-env) if you want to poke at it or add more patterns.

Happy holidays, and may your secrets stay secret.
