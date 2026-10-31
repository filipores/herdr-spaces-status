# Client integrations

[Spaces Glow](../README.md) can show orange only when the client reports `blocked`. These optional bridges fill specific reporting gaps; they do not infer questions from assistant prose, answer dialogs or grant permissions.

## Compatibility

Tested in interactive sessions with Herdr Core **0.1.15**:

| Client | Tested version | Status support |
| --- | --- | --- |
| Claude Code | 2.1.316 | Native questions and permissions; no bridge needed. |
| Codex CLI | 0.166.0 | Native questions and permissions. Use `codex --no-daemon` in Herdr, as required by Core. Questions were tested in Plan mode. |
| Pi | 1.4.0 | Optional bridge for `@juicesharp/rpiv-ask-user-question` questionnaires. |
| OpenCode | 1.19.5 | Optional TUI bridge; this release sent no native status in testing. |

Support depends on the **client**, not the model selected inside it. Verify a missing status report before installing a bridge; do not duplicate native reporting. Revalidate compatibility after client updates and remove bridges when native support covers the gap.

## Pi

[Source](pi/question-status.ts) · [Tests](../checks/pi-question-status.test.mjs)

The questionnaire tool's custom UI can leave Pi reporting `working` while it awaits input. This bridge connects its `rpiv:ask-user:blocked` events to native terminal status, only in interactive Herdr sessions (`HC_TERMINAL_ID`). Concurrent questions are tracked by ID; native permission/auth blocks retain priority, and the latest native report is restored when questions close.

Install separately, **only with explicit permission**. Stop if the destination exists; do not overwrite another extension. From the repository root:

```sh
mkdir -p ~/.pi/agent/extensions
cp -n integrations/pi/question-status.ts ~/.pi/agent/extensions/herdr-question-status.ts
```

Run `/reload` in each existing Pi session; new sessions load it automatically. This does not edit Herdr's managed integration.

**Limits:** tested on Pi 1.4.0. It temporarily decorates `terminal.setProgramStatus` because that version has no public blocked-source API for custom dialogs. It does not cover other custom dialogs, RPC, JSON or print mode. No polling, prompt contents, credentials or external commands are involved.

**Undo:** remove `~/.pi/agent/extensions/herdr-question-status.ts` and run `/reload` again.

## OpenCode

[Source](opencode/status.js) · [Tests](../checks/opencode-status.test.mjs)

The TUI bridge observes the selected session family, including pending requests from child sessions. It reports working/retry, question/permission waits, completion, errors and interruption through OSC 7501. Unrelated session families do not affect this terminal.

Install separately, **only with explicit permission**. Stop if the destination exists. From the repository root:

```sh
mkdir -p ~/.config/opencode
cp -n integrations/opencode/status.js ~/.config/opencode/herdr-status.js
```

Add the copied file's absolute `file://` URL to the `plugin` array in `~/.config/opencode/tui.json`. Replace the placeholder below; preserve existing settings and plugin entries rather than replacing the file. This belongs in **`tui.json`**, not `opencode.json`.

```json
{
  "plugin": ["file:///absolute/path/to/herdr-status.js"]
}
```

Start a new OpenCode session inside Herdr. The bridge uses OpenCode's bundled Solid runtime; install no extra npm dependencies. It adds no visible UI, timers or external commands. At attachment it reads pending requests through the connected OpenCode API; only status and blocking kind reach the terminal, never question text or session names.

**Limits:** version-gated to **1.19.5**, with a warning on other versions. It runs only in a Herdr TTY. Authentication dialogs and unrelated background session families are not covered.

**Undo:** remove only this plugin entry from `tui.json`, then remove `herdr-status.js` and restart OpenCode. Keep unrelated configuration.

## Verification

Run the [repository checks](../README.md#checks) before changing either bridge. They cover pending dialogs, concurrency, state restoration, session isolation, cleanup and host guards.

Native checks used real clients with isolated profiles and synthetic local provider responses. Questions and approvals resumed `working` after confirmation; cancellations left no stuck `blocked` state. OpenCode was also checked for provider errors and normal exit. No real model calls or personal profiles were used. Remote attachment and authentication dialogs were not part of these interactive checks.
