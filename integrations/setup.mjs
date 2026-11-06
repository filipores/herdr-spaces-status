import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

export function setupStatus({ installPi = [], run = execFileSync } = {}) {
  let machines;
  try {
    const response = JSON.parse(run("hc", ["machine", "ls", "--json"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] }));
    machines = response.machines;
    if (!Array.isArray(machines) || machines.some((m) => !m || typeof m.name !== "string" || !m.name || m.name === "local" || typeof m.state !== "string") || new Set(machines.map((m) => m.name)).size !== machines.length) {
      throw new Error("Invalid machine list");
    }
  } catch {
    throw new Error("Cannot discover all Herdr hosts. Check `hc machine ls --json`; no installation attempted.");
  }
  const hosts = [{ name: "local", state: "connected" }, ...machines];
  for (const name of installPi) {
    if (!hosts.some((h) => h.name === name)) throw new Error(`Unknown host: ${name}. Use local or a name from hc machine ls.`);
  }
  const worker = read("./host-setup.mjs");
  const piBridge = read("./pi/question-status.ts");
  const openCodeBridge = read("./opencode/status.js");
  return hosts.flatMap((host) => {
    if (host.state !== "connected") return [{ host: host.name, client: "host", state: "unreachable", detail: `Herdr state: ${host.state}. Reconnect and rerun; this host has NOT been checked.` }];
    const input = `${worker}\nconsole.log(JSON.stringify(checkHost(${JSON.stringify({ piBridge, openCodeBridge, installPi: installPi.includes(host.name) })})));\n`;
    const program = host.name === "local" ? process.execPath : "hc";
    const args = host.name === "local" ? ["--input-type=module"] : ["exec", "--on", host.name, "--timeout", "15", "-i", "sh", "-lc", "exec node --input-type=module"];
    try {
      const results = JSON.parse(run(program, args, { input, encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }));
      if (!Array.isArray(results) || !results.length || results.some((r) => !r || typeof r.client !== "string" || typeof r.state !== "string" || typeof r.detail !== "string")) throw new Error("Invalid host result");
      return results.map((r) => ({ ...r, host: host.name }));
    } catch {
      return [{ host: host.name, client: "host", state: "error", detail: "Host check failed. Verify Node 22.18+ and PATH on this host, then rerun. If installation was requested, inspect the destination before retrying; no runtime verification was performed." }];
    }
  });
}

export function setupExitCode(results) {
  return results.some((r) => !["matched", "not-detected"].includes(r.state)) ? 1 : 0;
}
