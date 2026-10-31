import { writeSync } from "node:fs";
import { createEffect, createSignal } from "solid-js";

async function tui(api) {
  if (!process.env.HC_TERMINAL_ID || !process.stdout.isTTY) return;
  // shortcut: validated against this TUI API; recheck before enabling on another release.
  if (api.app.version !== "1.19.5") {
    api.ui.toast({ variant: "warning", message: "Herdr status: unsupported OpenCode version; bridge disabled." });
    return;
  }

  let last = "";
  const report = (state, kind) => {
    const sequence = `\x1b]7501;state=${state}:app=opencode${kind ? `:kind=${kind}` : ""}\x1b\\`;
    if (sequence === last) return;
    writeSync(1, sequence);
    last = sequence;
  };
  const [sessions, setSessions] = createSignal([]);
  const track = (sessionID) => {
    if (typeof sessionID !== "string") return;
    setSessions((ids) => ids.includes(sessionID) ? ids : [...ids, sessionID]);
  };
  for (const type of ["permission.asked", "question.asked"]) {
    const unsubscribe = api.event.on(type, (event) => track(event.properties.sessionID));
    api.lifecycle.onDispose(unsubscribe);
  }
  api.lifecycle.onDispose(() => report("clear"));

  // Restore waits that predate attachment, including requests from child sessions.
  const pending = await Promise.all([api.client.permission.list(), api.client.question.list()]);
  if (api.lifecycle.signal.aborted) return;
  for (const result of pending) {
    if (!Array.isArray(result.data)) throw new Error("Herdr status: pending requests could not be loaded.");
    result.data.forEach((request) => track(request.sessionID));
  }

  api.slots.register({
    slots: {
      app() {
        createEffect(() => {
          if (!api.state.ready) return;
          const route = api.route.current;
          const selected = route.name === "session" ? route.params?.sessionID : undefined;
          if (!selected) { report("idle"); return; }
          const state = api.state.session;
          const root = state.get(selected)?.parentID || selected;
          const family = [root, ...sessions().filter((sid) => sid !== root && state.get(sid)?.parentID === root)];
          if (family.some((sid) => state.permission(sid).length)) { report("blocked", "permission"); return; }
          if (family.some((sid) => state.question(sid).length)) { report("blocked", "question"); return; }
          const status = state.status(root)?.type;
          if (status === "busy" || status === "retry") { report("working"); return; }
          const message = state.messages(root).at(-1);
          if (message?.role === "assistant" && message.error) {
            report(message.error.name === "MessageAbortedError" ? "idle" : "error");
            return;
          }
          report(message?.role === "assistant" && message.time.completed ? "done" : "idle");
        });
        return null;
      },
    },
  });
}

export default { id: "herdr-spaces-glow-status", tui };
