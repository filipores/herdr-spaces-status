# Client integrations

[Spaces Status](../README.md) can show orange only when the client reports `blocked`. These optional bridges fill specific reporting gaps; they do not infer questions from assistant prose, answer dialogs or grant permissions.

## Compatibility

Tested in interactive sessions with Herdr Core **0.1.15**:

| Client | Tested version | Status support |
| --- | --- | --- |
| Claude Code | 2.1.316 | Native questions and permissions; no bridge needed. |
| Codex CLI | 0.166.0 | Native questions and permissions. Use `codex --no-daemon` in Herdr, as required by Core. Questions were tested in Plan mode. |
| Pi | 1.4.0 | Optional bridge for `@juicesharp/rpiv-ask-user-question` questionnaires. |
| OpenCode | 1.19.5 | Optional TUI bridge; this release sent no native status in testing. |

Support depends on the **client**, not the model selected inside it. Verify a missing status report before installing a bridge; do not duplicate native reporting. Revalidate compatibility after client updates and remove bridges when native support covers the gap.

## Required host setup

The mod runs on the display machine, but status is emitted where the agent runs. A local bridge does **not** cover Pi sessions on an SSH server. Run this from the repository with Node **22.18+** and `hc` available:

```sh
node scripts/status-setup.mjs
```

This is read-only by default. It discovers **all** registered machines with `hc machine ls --json`, then checks the local user and each connected remote user through `hc exec`. Remote checks use `sh -lc` to load the login PATH; Node and the relevant client must be available there. It does not register/connect machines, update packages, edit settings or restart sessions.

After the user explicitly approves named hosts, create missing Pi bridges there, for example:

```sh
node scripts/status-setup.mjs --install-pi local --install-pi my-server
```

Use actual names from `hc machine ls`; repeat the flag for each approved host. Existing identical files are left alone; differing files and symlinks are never overwritten. This installs only the bundled Pi bridge, not Pi or the questionnaire package. OpenCode remains a manual, version-gated step below.

Results are reported **per host/client**:

| Result | Meaning / next step |
| --- | --- |
| `matched` | File/config matches this repo; loading and runtime behavior still unverified. |
| `installed` | New Pi bridge created; `/reload` in existing Pi sessions or start a new session. |
| `missing` | Required Pi bridge absent; approve installation for this host. |
| `conflict` / `review` / `error` | Resolve the reported file, compatibility, configuration or execution issue manually. |
| `unreachable` | Registered host was not checked; reconnect and rerun. |
| `not-detected` | No supported global Pi questionnaire package found; not a runtime success claim. |

Exit **1** means action is needed (including reload after installation); **0** means no detected file/config gaps, **not** that orange works end-to-end. After reload, verify a real questionnaire on each used host: open → orange, answer → working, reopen/cancel → no stuck orange. Test native Claude Code/Codex separately. Do not inject questions or reload into someone's active task without permission; report verification pending instead.

**Scope:** the current remote account's global Pi profile (`PI_CODING_AGENT_DIR`, otherwise `~/.pi/agent`) and standard OpenCode config (`XDG_CONFIG_HOME`, otherwise `~/.config`). Supported Pi package declarations are npm or local paths for `@juicesharp/rpiv-ask-user-question`; setup checks its event contract and Pi 1.4/1.5. Resource filters or unknown versions require review. Project-only packages, session flags, other profiles, git-packaged questionnaires and custom OpenCode paths require manual checks. Native status is not inferred from installed files. Repeat this preflight when hosts are added/reconnected or clients are updated; no background installer is added to the sidebar.

## Pi

[Source](pi/question-status.ts) · [Tests](../checks/pi-question-status.test.mjs)

The questionnaire tool's custom UI can leave Pi reporting `working` while it awaits input. This bridge connects its `rpiv:ask-user:blocked` events to native terminal status, only in interactive Herdr sessions (`HC_TERMINAL_ID`). Concurrent questions are tracked by ID; native permission/auth blocks retain priority, and the latest native report is restored when questions close.

Install separately, **only with explicit permission**. Stop if the destination exists; do not overwrite another extension. From the repository root:

```sh
mkdir -p ~/.pi/agent/extensions
cp -n integrations/pi/question-status.ts ~/.pi/agent/extensions/herdr-question-status.ts
```

Run `/reload` in each existing Pi session; new sessions load it automatically. This does not edit Herdr's managed integration.

**Limits:** interactive behavior was tested on Pi 1.4.0; setup also recognizes Pi 1.5 and was checked against its installed profiles. Revalidate runtime behavior after client updates. It temporarily decorates `terminal.setProgramStatus` because that version has no public blocked-source API for custom dialogs. It does not cover other custom dialogs, RPC, JSON or print mode. No polling, prompt contents, credentials or external commands are involved.

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

Run the [repository checks](../README.md#checks) before changing either bridge or setup. They cover pending dialogs, concurrency, state restoration, session isolation, cleanup, host discovery, remote login PATH, explicit install approval, no-overwrite behavior and incomplete-host reporting.

Native checks used real clients with isolated profiles and synthetic local provider responses. Questions and approvals resumed `working` after confirmation; cancellations left no stuck `blocked` state. OpenCode was also checked for provider errors and normal exit. No real model calls or personal profiles were used. Remote attachment and authentication dialogs were not part of these interactive checks.
