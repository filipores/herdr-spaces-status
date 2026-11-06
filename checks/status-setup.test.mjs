import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { checkHost } from "../integrations/host-setup.mjs";
import { setupStatus, setupExitCode } from "../integrations/setup.mjs";

const piBridge = readFileSync(new URL("../integrations/pi/question-status.ts", import.meta.url), "utf8");
const openCodeBridge = readFileSync(new URL("../integrations/opencode/status.js", import.meta.url), "utf8");

function profile(t, { localPackage = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "spaces-status-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agentDir = join(home, ".pi/agent");
  const destination = join(agentDir, "extensions/herdr-question-status.ts");
  const packageDir = localPackage ? join(home, "tools/questions") : join(agentDir, "npm/node_modules/@juicesharp/rpiv-ask-user-question");
  const settings = { packages: [localPackage ? "../../tools/questions" : "npm:@juicesharp/rpiv-ask-user-question"] };
  const put = (path, value) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  };
  const save = () => put(join(agentDir, "settings.json"), settings);
  save();
  put(join(packageDir, "package.json"), { name: "@juicesharp/rpiv-ask-user-question" });
  put(join(packageDir, "events.ts"), 'export const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked";');
  put(join(packageDir, "ask-user-question.ts"), "pi.events.emit(ASK_USER_BLOCKED_EVENT, payload);");
  const check = (options = {}) => checkHost({ home, agentDir, configDir: join(home, ".config"), piBridge, openCodeBridge, getVersion: () => "1.5.0", ...options });
  return { home, agentDir, destination, packageDir, settings, put, save, check };
}

test("read-only check finds the missing bridge without creating it", (t) => {
  const p = profile(t);
  assert.equal(p.check()[0].state, "missing");
  assert.equal(existsSync(p.destination), false);
});

for (const localPackage of [false, true]) {
  test(`explicit install supports ${localPackage ? "local" : "npm"} questionnaire packages and is idempotent`, (t) => {
    const p = profile(t, { localPackage });
    const settingsBefore = readFileSync(join(p.agentDir, "settings.json"), "utf8");
    assert.equal(p.check({ installPi: true })[0].state, "installed");
    assert.equal(readFileSync(p.destination, "utf8"), piBridge);
    assert.equal(p.check({ installPi: true })[0].state, "matched");
    assert.equal(readFileSync(join(p.agentDir, "settings.json"), "utf8"), settingsBefore);
  });
}

test("custom profile paths expand tilde like Pi itself", (t) => {
  const p = profile(t);
  assert.equal(p.check({ agentDir: "~/.pi/agent", installPi: true })[0].state, "installed");
  assert.equal(readFileSync(p.destination, "utf8"), piBridge);
});

test("existing differing files and symlinks are never overwritten", (t) => {
  const p = profile(t);
  p.put(p.destination, "user-owned extension");
  assert.equal(p.check({ installPi: true })[0].state, "conflict");
  assert.equal(readFileSync(p.destination, "utf8"), "user-owned extension");
  rmSync(p.destination);
  const target = join(p.home, "shared.ts");
  p.put(target, piBridge);
  symlinkSync(target, p.destination);
  assert.equal(p.check({ installPi: true })[0].state, "conflict");
  assert.equal(readFileSync(target, "utf8"), piBridge);
});

test("no questionnaire means no unsolicited extension, even with install approval", (t) => {
  const p = profile(t);
  p.settings.packages = [];
  p.save();
  assert.equal(p.check({ installPi: true })[0].state, "not-detected");
  assert.equal(existsSync(p.destination), false);
});

for (const [name, change] of [
  ["excluded bridge", (p) => { p.settings.extensions = ["-extensions/herdr-question-status.ts"]; p.save(); }],
  ["disabled package", (p) => { p.settings.packages = [{ source: p.settings.packages[0], extensions: [] }]; p.save(); }],
  ["missing event contract", (p) => p.put(join(p.packageDir, "events.ts"), "// No blocked event")],
]) {
  test(`${name} needs review, not automatic installation`, (t) => {
    const p = profile(t);
    change(p);
    assert.equal(p.check({ installPi: true })[0].state, "review");
    assert.equal(existsSync(p.destination), false);
  });
}

test("invalid configuration is an error, not a healthy undetected profile", (t) => {
  const p = profile(t);
  for (const content of ["null", "[]", '{"private":"do-not-echo"']) {
    p.put(join(p.agentDir, "settings.json"), content);
    const result = p.check({ installPi: true })[0];
    assert.equal(result.state, "error");
    assert(!result.detail.includes("do-not-echo"));
    assert.equal(existsSync(p.destination), false);
  }
});

test("unknown Pi versions are not silently treated as compatible", (t) => {
  const p = profile(t);
  assert.equal(p.check({ installPi: true, getVersion: () => "2.0.0" })[0].state, "review");
  assert.equal(existsSync(p.destination), false);
});

test("OpenCode is an explicit manual step and its TUI config is untouched", (t) => {
  const p = profile(t);
  const path = join(p.home, ".config/opencode/tui.json");
  const bridge = join(p.home, ".config/opencode/herdr-status.js");
  p.put(bridge, openCodeBridge);
  p.put(path, { plugin: ["file:///unrelated.js"] });
  const before = readFileSync(path, "utf8");
  const getVersion = (program) => program === "pi" ? "1.5.0" : "1.19.5";
  assert.equal(p.check({ installPi: true, getVersion }).find((r) => r.client === "OpenCode").state, "review");
  assert.equal(readFileSync(path, "utf8"), before);
  p.put(path, { plugin: [pathToFileURL(bridge).href] });
  assert.equal(p.check({ getVersion }).find((r) => r.client === "OpenCode").state, "matched");
  assert.equal(p.check().find((r) => r.client === "OpenCode").state, "review");
});

function transport() {
  const calls = [];
  const run = (program, args, options) => {
    calls.push({ program, args, options });
    if (args[0] === "machine") return JSON.stringify({ machines: [
      { name: "claude", state: "connected" },
      { name: "filip", state: "disconnected" },
    ] });
    if (args.includes("claude")) return JSON.stringify([{ client: "Pi", state: "missing", detail: "Bridge missing" }]);
    return JSON.stringify([{ client: "Pi", state: "matched", detail: "Files match; runtime unverified" }]);
  };
  return { run, calls };
}

test("default check includes every registered host and never requests installation", () => {
  const { run, calls } = transport();
  const result = setupStatus({ run });
  assert.deepEqual(result.map((r) => [r.host, r.state]), [["local", "matched"], ["claude", "missing"], ["filip", "unreachable"]]);
  const probes = calls.filter((c) => c.options?.input);
  assert.equal(probes.length, 2);
  assert(probes.every((c) => c.options.input.includes('"installPi":false')));
});

test("only explicitly approved hosts receive an install request", () => {
  const { run, calls } = transport();
  setupStatus({ installPi: ["claude"], run });
  const probes = calls.filter((c) => c.options?.input);
  assert(probes.find((c) => c.args.includes("claude")).options.input.includes('"installPi":true'));
  assert(probes.find((c) => !c.args.includes("claude")).options.input.includes('"installPi":false'));
});

test("unknown host approval fails before any host is modified", () => {
  const { run, calls } = transport();
  assert.throws(() => setupStatus({ installPi: ["local", "cluade"], run }), /Unknown host/);
  assert.equal(calls.filter((c) => c.options?.input).length, 0);
});

test("discovery failure is not presented as a successful local-only check", () => {
  assert.throws(() => setupStatus({ run: () => { throw new Error("core offline"); } }), /discover/i);
});

test("remote checks use the login PATH, not the core daemon's minimal PATH", (t) => {
  const p = profile(t);
  const bin = join(p.home, "bin");
  p.put(join(bin, "pi"), "#!/bin/sh\nprintf '1.5.0\\n'\n");
  chmodSync(join(bin, "pi"), 0o755);
  p.put(join(p.home, ".profile"), `export PATH='${bin}:${dirname(process.execPath)}:/usr/bin:/bin'\n`);
  const results = setupStatus({ run: (program, args, options) => {
    if (args[0] === "machine") return JSON.stringify({ machines: [{ name: "remote", state: "connected" }] });
    if (program !== "hc") return JSON.stringify([{ client: "Pi", state: "not-detected", detail: "No local profile" }]);
    const [command, ...argv] = args.slice(args.indexOf("-i") + 1);
    return execFileSync(command, argv, { ...options, env: { HOME: p.home, PATH: "/usr/bin:/bin" } });
  } });
  assert.equal(results.find((r) => r.host === "remote").state, "missing");
});

test("CLI exit status never treats missing, failed or newly installed hosts as complete", () => {
  for (const state of ["missing", "conflict", "review", "error", "unreachable", "installed", "unexpected"]) {
    assert.equal(setupExitCode([{ state: "matched" }, { state }]), 1, state);
  }
  assert.equal(setupExitCode([{ state: "matched" }, { state: "not-detected" }]), 0);
});

test("a failed remote probe stays visible and does not erase other host results", () => {
  const { run } = transport();
  const result = setupStatus({ run: (program, args, options) => {
    if (args.includes("claude")) throw new Error("timeout");
    return run(program, args, options);
  } });
  assert.deepEqual(result.map((r) => r.state), ["matched", "error", "unreachable"]);
});
