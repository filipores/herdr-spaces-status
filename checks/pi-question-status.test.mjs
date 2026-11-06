import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import install from "../integrations/pi/question-status.ts";

const channel = "rpiv:ask-user:blocked";
const working = { app: "pi", state: "working", message: "Synthetic session" };
const blocked = { app: "pi", state: "blocked", kind: "question", message: "Waiting for an answer" };

async function setup({ mode = "tui", herdr = true, idle = true } = {}) {
  const events = new EventEmitter();
  const handlers = new Map();
  const reports = [];
  const original = (status) => reports.push(status);
  const terminal = { setProgramStatus: original };
  let customCalls = 0;
  const context = {
    mode, isIdle: () => idle,
    ui: {
      async custom(factory, options) {
        customCalls++;
        assert.deepEqual(options, { overlay: true });
        let closed = false;
        factory({ terminal }, null, null, () => { closed = true; });
        assert.equal(closed, true, "terminal acquisition must not leave a UI open");
      },
    },
  };
  const previous = process.env.HC_TERMINAL_ID;
  if (herdr) process.env.HC_TERMINAL_ID = "synthetic-terminal";
  else delete process.env.HC_TERMINAL_ID;
  try {
    install({
      on: (name, handler) => handlers.set(name, handler),
      events: { on: (name, handler) => {
        events.on(name, handler);
        return () => events.off(name, handler);
      } },
    });
  } finally {
    if (previous === undefined) delete process.env.HC_TERMINAL_ID;
    else process.env.HC_TERMINAL_ID = previous;
  }
  const lifecycle = (name) => handlers.get(name)?.({}, context);
  await lifecycle("session_start");
  return {
    reports, terminal, original, events, lifecycle,
    get customCalls() { return customCalls; },
    get last() { return reports.at(-1); },
    wait: (active, toolCallId = "question-1") => events.emit(channel, { active, toolCallId }),
  };
}

test("question wait is blocked; answer/cancel restores the native working report", async () => {
  const h = await setup();
  h.terminal.setProgramStatus(working);
  h.wait(true);
  assert.deepEqual(h.last, blocked);
  h.wait(false);
  assert.deepEqual(h.reports, [working, blocked, working]);
});

test("overlapping questionnaires close by ID, not by count", async () => {
  const h = await setup();
  h.terminal.setProgramStatus(working);
  h.wait(true, "a");
  h.wait(true, "a");
  h.wait(true, "b");
  h.wait(false, "a");
  h.wait(false, "a");
  h.wait(false, "unknown");
  assert.deepEqual(h.last, blocked);
  h.wait(false, "b");
  assert.deepEqual(h.last, working);
});

for (const status of [
  { app: "pi", state: "working", message: "Compacting context" },
  { app: "pi", state: "done", message: "Renamed session" },
  { app: "pi", state: "error", message: "Synthetic provider error" },
]) {
  test(`native ${status.state} during a question stays blocked and is restored exactly`, async () => {
    const h = await setup();
    h.terminal.setProgramStatus(working);
    h.wait(true);
    h.terminal.setProgramStatus(status);
    assert.deepEqual(h.last, blocked);
    h.wait(false);
    assert.deepEqual(h.last, status);
  });
}

test("native permission/auth blocks retain their kind and survive question closure", async () => {
  const h = await setup();
  const permission = { app: "pi", state: "blocked", kind: "permission", message: "Allow?" };
  h.terminal.setProgramStatus(permission);
  h.wait(true);
  assert.deepEqual(h.last, permission);
  h.wait(false);
  assert.deepEqual(h.last, permission);
  h.wait(true);
  h.terminal.setProgramStatus(working);
  assert.deepEqual(h.last, blocked);
});

test("legacy questionnaire 2.11 events without IDs block until answered or cancelled", async () => {
  const h = await setup();
  h.terminal.setProgramStatus(working);
  h.events.emit(channel, { active: true });
  assert.deepEqual(h.last, blocked);
  h.terminal.setProgramStatus(working);
  assert.deepEqual(h.last, blocked);
  h.events.emit(channel, { active: false });
  assert.deepEqual(h.last, working);
  const count = h.reports.length;
  h.events.emit(channel, { active: false });
  assert.equal(h.reports.length, count);
});

test("paired legacy waits and ID-based waits do not clear each other", async () => {
  const h = await setup();
  h.terminal.setProgramStatus(working);
  h.events.emit(channel, { active: true });
  h.events.emit(channel, { active: true });
  h.wait(true, "modern");
  h.events.emit(channel, { active: false });
  h.wait(false, "modern");
  assert.deepEqual(h.last, blocked);
  h.events.emit(channel, { active: false });
  assert.deepEqual(h.last, working);
});

test("reload clears legacy waits and restores the latest native report", async () => {
  const h = await setup();
  h.terminal.setProgramStatus(working);
  h.events.emit(channel, { active: true });
  h.terminal.setProgramStatus({ app: "pi", state: "done" });
  assert.deepEqual(h.last, blocked);
  await h.lifecycle("session_start");
  assert.deepEqual(h.last, { app: "pi", state: "done" });
  assert.equal(h.events.listenerCount(channel), 1);
  h.terminal.setProgramStatus(working);
  assert.deepEqual(h.last, working);
});

test("malformed or unmatched events never change a native status", async () => {
  const h = await setup();
  h.terminal.setProgramStatus(working);
  for (const data of [null, undefined, {}, "bad", { active: true, toolCallId: null },
    { active: true, toolCallId: "" }, { active: "true", toolCallId: "a" },
    { active: false, toolCallId: "unknown" }]) h.events.emit(channel, data);
  assert.deepEqual(h.reports, [working]);
});

test("ordinary native reports and terminal clearing are not changed", async () => {
  const h = await setup();
  const statuses = ["idle", "working", "done", "error", "blocked", "clear"]
    .map(state => ({ app: "pi", state, message: "Preserve native fields" }));
  for (const status of statuses) h.terminal.setProgramStatus(status);
  assert.deepEqual(h.reports, statuses);
  h.wait(true);
  const clear = { state: "clear" };
  h.terminal.setProgramStatus(clear);
  assert.deepEqual(h.last, clear);
});

test("shutdown restores the latest native state and removes the hook and listener", async () => {
  const h = await setup();
  const done = { app: "pi", state: "done", message: "Completed" };
  h.terminal.setProgramStatus(working);
  h.wait(true);
  h.terminal.setProgramStatus(done);
  await h.lifecycle("session_shutdown");
  assert.equal(h.terminal.setProgramStatus, h.original);
  assert.deepEqual(h.last, done);
  assert.equal(h.events.listenerCount(channel), 0);
  const count = h.reports.length;
  h.wait(true);
  h.wait(false);
  await h.lifecycle("session_shutdown");
  assert.equal(h.reports.length, count);
});

test("a new session has no stale questions or duplicate listeners", async () => {
  const h = await setup();
  h.wait(true, "old");
  await h.lifecycle("session_shutdown");
  await h.lifecycle("session_start");
  h.terminal.setProgramStatus(working);
  assert.equal(h.events.listenerCount(channel), 1);
  h.wait(true, "new");
  h.wait(false, "old");
  assert.deepEqual(h.last, blocked);
  h.wait(false, "new");
  assert.deepEqual(h.last, working);
});

for (const idle of [true, false]) {
  test(`reload before the next native report restores ${idle ? "idle" : "working"}`, async () => {
    const h = await setup({ idle });
    h.wait(true);
    assert.deepEqual(h.last, blocked);
    h.wait(false);
    assert.deepEqual(h.last, { app: "pi", state: idle ? "idle" : "working" });
  });
}

for (const options of [{ mode: "rpc" }, { mode: "json" }, { mode: "print" }, { herdr: false }]) {
  test(`no terminal hook for ${JSON.stringify(options)}`, async () => {
    const h = await setup(options);
    assert.equal(h.customCalls, 0);
    assert.equal(h.events.listenerCount(channel), 0);
    h.wait(true);
    h.terminal.setProgramStatus(working);
    assert.equal(h.terminal.setProgramStatus, h.original);
    assert.deepEqual(h.reports, [working]);
  });
}
