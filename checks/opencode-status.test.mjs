import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../integrations/opencode/status.js", import.meta.url), "utf8");
const record = (state, kind) => `\x1b]7501;state=${state}:app=opencode${kind ? `:kind=${kind}` : ""}\x1b\\`;

async function setup(options = {}) {
  const reports = [], effects = [], disposers = [], warnings = [];
  const listeners = new Map();
  const controller = new AbortController();
  const nodes = {
    root: { id: "root", status: "busy", permissions: [], questions: [], messages: [] },
    child: { id: "child", parentID: "root", status: "busy", permissions: [], questions: [], messages: [] },
    other: { id: "other", status: "busy", permissions: [], questions: [], messages: [] },
  };
  if (options.restoredChild) nodes.child.questions = [{ id: "restored", sessionID: "child" }];
  let slotCount = 0;
  const dispose = () => { controller.abort(); disposers.forEach(fn => fn()); };
  const api = {
    app: { version: options.version ?? "1.19.5" },
    ui: { toast: value => warnings.push(value) },
    route: { current: { name: "session", params: { sessionID: "root" } } },
    state: {
      ready: true,
      session: {
        get: sid => nodes[sid],
        status: sid => ({ type: nodes[sid]?.status ?? "idle" }),
        permission: sid => nodes[sid]?.permissions ?? [],
        question: sid => nodes[sid]?.questions ?? [],
        messages: sid => nodes[sid]?.messages ?? [],
      },
    },
    event: { on: (type, handler) => {
      listeners.set(type, handler);
      return () => listeners.delete(type);
    } },
    lifecycle: { signal: controller.signal, onDispose: fn => disposers.push(fn) },
    client: {
      permission: { list: async () => ({ data: [] }) },
      question: { list: async () => {
        if (options.abortDuringLoad) dispose();
        if (options.snapshotError) return { error: "Unavailable" };
        return { data: nodes.child.questions };
      } },
    },
    slots: { register: plugin => {
      slotCount++;
      assert.equal(plugin.slots.app(), null, "the integration must not add visible UI");
      return "fixture-slot";
    } },
  };
  const context = vm.createContext({ process: {
    env: options.herdr === false ? {} : { HC_TERMINAL_ID: "synthetic" },
    stdout: { isTTY: options.tty ?? true },
  } });
  const dependencies = {
    "node:fs": { writeSync: (fd, data) => { assert.equal(fd, 1); reports.push(data); } },
    "solid-js": {
      createSignal: value => [() => value, fn => { value = fn(value); }],
      createEffect: fn => { effects.push(fn); fn(); },
    },
  };
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(name => new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
    for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
  }, { context }));
  await mod.evaluate();
  await mod.namespace.default.tui(api);
  const flush = () => effects.forEach(fn => fn());
  return {
    api, nodes, reports, warnings, listeners, dispose, flush,
    get slotCount() { return slotCount; },
    get last() { return reports.at(-1); },
    emit: (type, sessionID) => { listeners.get(type)?.({ properties: { sessionID } }); flush(); },
  };
}

test("question overrides working until every pending question is closed", async () => {
  const h = await setup();
  assert.equal(h.last, record("working"));
  h.nodes.root.questions = [{ id: "a" }, { id: "b" }]; h.flush();
  assert.equal(h.last, record("blocked", "question"));
  h.nodes.root.questions.shift(); h.flush();
  assert.equal(h.last, record("blocked", "question"));
  h.nodes.root.questions = []; h.flush();
  assert.equal(h.last, record("working"));
});

test("permission priority and child waits match the active session family", async () => {
  const h = await setup();
  h.nodes.root.questions = [{ id: "question" }];
  h.nodes.child.permissions = [{ id: "permission" }];
  h.emit("permission.asked", "child");
  assert.equal(h.last, record("blocked", "permission"));
  h.nodes.child.permissions = []; h.flush();
  assert.equal(h.last, record("blocked", "question"));
  h.nodes.root.questions = []; h.flush();
  assert.equal(h.last, record("working"));
});

test("attach restores an existing child questionnaire without a new asked event", async () => {
  const h = await setup({ restoredChild: true });
  assert.equal(h.last, record("blocked", "question"));
  h.nodes.child.questions = []; h.flush();
  assert.equal(h.last, record("working"));
});

test("unrelated sessions do not leak and navigation recomputes the state", async () => {
  const h = await setup();
  h.nodes.other.questions = [{ id: "other-wait" }];
  h.emit("question.asked", "other");
  assert.equal(h.last, record("working"));
  h.api.route.current.params.sessionID = "other"; h.flush();
  assert.equal(h.last, record("blocked", "question"));
  h.api.route.current.params.sessionID = "root"; h.flush();
  assert.equal(h.last, record("working"));
  h.api.route.current = { name: "home" }; h.flush();
  assert.equal(h.last, record("idle"));
});

for (const [name, status, message, expected] of [
  ["retry", "retry", null, "working"],
  ["completion", "idle", { role: "assistant", time: { completed: 1 } }, "done"],
  ["failure", "idle", { role: "assistant", error: { name: "APIError" }, time: {} }, "error"],
  ["interruption", "idle", { role: "assistant", error: { name: "MessageAbortedError" }, time: {} }, "idle"],
  ["new prompt", "idle", { role: "user", time: {} }, "idle"],
  ["empty session", "idle", null, "idle"],
]) {
  test(`maps ${name} to ${expected}`, async () => {
    const h = await setup();
    h.nodes.root.status = status;
    h.nodes.root.messages = message ? [message] : [];
    h.flush();
    assert.equal(h.last, record(expected));
  });
}

test("identical renders do not spam the terminal; disposal clears status and listeners", async () => {
  const h = await setup();
  h.flush(); h.flush();
  assert.deepEqual(h.reports, [record("working")]);
  h.dispose(); h.dispose();
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.reports, [record("working"), record("clear")]);
});

test("late bootstrap cannot publish after disposal", async () => {
  const h = await setup({ abortDuringLoad: true });
  assert.equal(h.slotCount, 0);
  assert.deepEqual(h.reports, [record("clear")]);
});

test("unavailable pending state is an explicit load error, not an invented idle state", async () => {
  await assert.rejects(setup({ snapshotError: true }), /pending requests could not be loaded/);
});

for (const options of [{ herdr: false }, { tty: false }, { version: "2.0.0" }]) {
  test(`does not compete with unsupported hosts: ${JSON.stringify(options)}`, async () => {
    const h = await setup(options);
    assert.equal(h.slotCount, 0);
    assert.equal(h.listeners.size, 0);
    assert.deepEqual(h.reports, []);
    assert.equal(h.warnings.length, options.version ? 1 : 0);
  });
}
