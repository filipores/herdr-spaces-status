import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProgramStatus } from "@earendil-works/pi-tui";

const BLOCKED_EVENT = "rpiv:ask-user:blocked";

export default function (pi: ExtensionAPI) {
  if (!process.env.HC_TERMINAL_ID) return;
  let dispose = () => {};

  pi.on("session_start", async (_event, ctx) => {
    dispose();
    if (ctx.mode !== "tui") return;

    // Finish before mounting: borrow the public terminal without showing a dialog.
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      const terminal = tui.terminal;
      const original = terminal.setProgramStatus;
      const pending = new Set<string>();
      let nativeStatus: ProgramStatus = {
        app: "pi",
        state: ctx.isIdle() ? "idle" : "working",
      };

      const publish = () => {
        const status: ProgramStatus = pending.size &&
          nativeStatus.state !== "blocked" && nativeStatus.state !== "clear"
          ? { app: "pi", state: "blocked", kind: "question", message: "Waiting for an answer" }
          : nativeStatus;
        original.call(terminal, status);
      };

      // shortcut: Pi 1.4 has no public blocked-source API; remove this hook when custom dialogs gain one.
      const report = (status: ProgramStatus) => {
        nativeStatus = status;
        publish();
      };
      terminal.setProgramStatus = report;
      const unsubscribe = pi.events.on(BLOCKED_EVENT, (data) => {
        const event = data as { active?: boolean; toolCallId?: string } | null;
        if (typeof event?.active !== "boolean" ||
          typeof event.toolCallId !== "string" || !event.toolCallId) return;

        if (event.active) {
          if (pending.has(event.toolCallId)) return;
          pending.add(event.toolCallId);
        } else if (!pending.delete(event.toolCallId)) return;
        publish();
      });

      dispose = () => {
        unsubscribe();
        if (terminal.setProgramStatus === report) terminal.setProgramStatus = original;
        if (pending.size) {
          pending.clear();
          publish();
        }
      };
      done();
      return { render: () => [], invalidate() {} };
    }, { overlay: true });
  });

  pi.on("session_shutdown", () => dispose());
}
