# Integrations

Every integration does the same thing: turn "something happened in my agent" into a small JSON event and post it to `http://localhost:4317/events`. The built-in adapters live in `adapters/` and are covered by tests in `test/`.

## Claude Code

`ai-office setup claude --write` merges this into `~/.claude/settings.json` (a `.bak` copy of the old file is kept):

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "ai-office hook claude", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "ai-office hook claude", "timeout": 5 }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "ai-office hook claude", "timeout": 5 }] }]
  }
}
```

The real snippet also covers `UserPromptSubmit`, `PostToolUseFailure`, `Notification`, `Stop`, `SubagentStop`, `PreCompact` and `SessionEnd`, and uses the absolute path of your install so it does not depend on `PATH`.

| Hook | On the floor |
| --- | --- |
| `SessionStart` | The lead walks in. |
| `UserPromptSubmit` | Thinking, with your prompt as the activity. |
| `PreToolUse` | Working. The monitor shows the tool and a readable summary ("Running npm test", "Editing cart.ts"). |
| `PreToolUse` (while working) | Cats that keep reading or searching walk to a tool room: Read, Glob, Grep and LS to the library (냥서재), Bash to the server room (냥서버실), WebSearch, WebFetch and MCP tools to the search room (정보검색실). Editing stays at the desk. |
| `PreToolUse` on `Task` / `Agent` | A helper walks in and gets a briefing plane with the task description. |
| `PreToolUse` on `TodoWrite` | The current todo goes on the team whiteboard. |
| `PostToolUse` on `Task` / `Agent` | The helper sends a "Report ready" plane back and finishes. |
| `PostToolUseFailure` | A red "failed" bubble with the tool name over the cat for about 4 seconds. The next tool or `Stop` hook clears it; if none comes, the floor turns it back to thinking after 4 seconds. |
| `Notification` | Waiting: the lead waves for you. |
| `Stop` | Idle. |
| `SessionEnd` | The lead walks out. |

Run `ai-office setup claude --project` to print a snippet for one repository's `.claude/settings.json` instead.

## Codex

```toml
# ~/.codex/config.toml
notify = ["node", "/absolute/path/to/ai-office/bin/ai-office.mjs", "hook", "codex"]
```

`ai-office setup codex` prints the exact line for your install. Codex calls `notify` when a turn completes, so the desk updates once per reply. Codex accepts a single `notify` program. If you already use one, call both from a small wrapper script.

If your Codex build supports Claude-style hooks with `hook_event_name` payloads on stdin, use `ai-office hook codex` there and you get per-tool updates as well.

## Cursor

`ai-office setup cursor --write` merges observing hooks into `~/.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": "ai-office hook cursor" }],
    "afterFileEdit": [{ "command": "ai-office hook cursor" }],
    "afterShellExecution": [{ "command": "ai-office hook cursor" }],
    "afterMCPExecution": [{ "command": "ai-office hook cursor" }],
    "afterAgentResponse": [{ "command": "ai-office hook cursor" }],
    "afterAgentThought": [{ "command": "ai-office hook cursor" }],
    "stop": [{ "command": "ai-office hook cursor" }]
  }
}
```

Hooks that gate permissions (`beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`) are deliberately left out. Hook names have changed between Cursor releases, so if one is not recognised by your version, Cursor ignores it.

## Your own agents

### Python

```python
import json, urllib.request

def floor(**event):
    req = urllib.request.Request(
        "http://localhost:4317/events",
        data=json.dumps(event).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(req, timeout=1)
    except OSError:
        pass  # the floor is optional

floor(type="join", agent="researcher", team="Market scan", role="Research")
floor(type="tool", agent="researcher", tool="search", activity="Searching for competitor pricing")
floor(type="message", agent="researcher", to="writer", text="Found 12 sources")
floor(type="status", agent="researcher", status="done", activity="Handed off")
```

This drops straight into LangGraph nodes, CrewAI task callbacks, AutoGen message hooks, or any loop you wrote yourself. Use one `team` per graph or crew, and `parent` for agents that spawn others.

### TypeScript

```ts
const floor = (event: Record<string, unknown>) =>
  fetch('http://localhost:4317/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => {});

await floor({ type: 'tool', agent: 'planner', team: 'Release', tool: 'git', activity: 'Tagging v2.3.0' });
```

### Shell

```bash
ai-office emit --agent deploy-bot --team Release --status working --activity "Rolling out to eu-west"
ai-office emit --agent deploy-bot --to planner --text "Rollout done"
ai-office emit --agent deploy-bot --type leave
```

## Writing a new adapter

1. Add `adapters/<tool>.mjs` exporting a pure function from the tool's payload to an array of events.
2. Wire it into the `hook` command in `bin/ai-office.mjs`, and to `setup` if the tool has a config file.
3. Add cases to `test/protocol.test.mjs`.
4. A hook must never block, prompt, or fail the host tool. Keep the 1.2 second timeout and always exit 0.
