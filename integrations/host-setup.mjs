import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const questionPackage = "@juicesharp/rpiv-ask-user-question";
const verify = "Run /reload or start a new Pi session, then verify a real question/answer/cancel in Herdr. Runtime is not verified by this check.";

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
    return value;
  } catch { throw new Error(`Cannot read JSON object: ${path}`); }
}

function getVersion(program) {
  try { return execFileSync(program, ["--version"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { throw new Error(`Cannot read ${program} version; check the host's PATH.`); }
}

function fileState(path, source) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return "missing"; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) return "conflict";
  return readFileSync(path, "utf8") === source ? "matched" : "conflict";
}

function questionnaire(settings, agentDir, home) {
  if (!Array.isArray(settings.packages ?? [])) throw new Error("Pi packages must be an array.");
  for (const entry of settings.packages ?? []) {
    const source = typeof entry === "string" ? entry : entry?.source;
    if (typeof source !== "string") throw new Error("Invalid Pi package source.");
    let path;
    if (source === `npm:${questionPackage}` || source.startsWith(`npm:${questionPackage}@`)) {
      path = join(agentDir, "npm/node_modules", questionPackage);
    } else if (isAbsolute(source) || source.startsWith(".") || source.startsWith("~/")) {
      path = source.startsWith("~/") ? join(home, source.slice(2)) : resolve(agentDir, source);
      if (readJson(join(path, "package.json"))?.name !== questionPackage) continue;
    } else continue;
    return { path, filtered: typeof entry === "object" && (entry.extensions !== undefined || entry.autoload === false) };
  }
  return null;
}

function setupPi({ agentDir, home, piBridge, installPi, getVersion }) {
  const result = (state, detail) => ({ client: "Pi", state, detail });
  const settings = readJson(join(agentDir, "settings.json")) ?? {};
  const pkg = questionnaire(settings, agentDir, home);
  if (!pkg) return result("not-detected", "No supported global questionnaire package configured. Check project-only packages and other profiles manually.");
  if (!Array.isArray(settings.extensions ?? [])) throw new Error("Pi extensions must be an array.");
  if (pkg.filtered || (settings.extensions ?? []).some((e) => typeof e !== "string" || (/^[!-]/.test(e) && !e.startsWith("-builtin:")))) {
    return result("review", "Package/resource filters may disable the questionnaire or bridge. Review Pi configuration; nothing installed.");
  }
  const version = getVersion("pi");
  if (!/^1\.(4|5)\.\d+$/.test(version)) return result("review", `Pi ${version}: bridge compatibility must be revalidated (checked with 1.4/1.5).`);
  const events = join(pkg.path, "events.ts");
  const producer = join(pkg.path, "ask-user-question.ts");
  if (!existsSync(events) || !existsSync(producer) ||
      !readFileSync(events, "utf8").includes('"rpiv:ask-user:blocked"') ||
      !readFileSync(producer, "utf8").includes("pi.events.emit(ASK_USER_BLOCKED_EVENT,")) {
    return result("review", "Questionnaire package is missing or its blocked-event contract is unknown. Nothing installed.");
  }
  const path = join(agentDir, "extensions/herdr-question-status.ts");
  const state = fileState(path, piBridge);
  if (state === "conflict") return result(state, `Existing file differs or is a symlink: ${path}. Review manually; never overwritten.`);
  if (state === "matched") return result(state, `${path} matches the repo. ${verify}`);
  if (!installPi) return result("missing", `${path} is missing. Approve this host with --install-pi HOST.`);
  mkdirSync(dirname(path), { recursive: true });
  // Exclusive creation also protects files created after the check.
  writeFileSync(path, piBridge, { flag: "wx", mode: 0o644 });
  return result("installed", `${path}. ${verify}`);
}

function checkOpenCode({ configDir, openCodeBridge, getVersion }) {
  const dir = join(configDir, "opencode");
  if (!existsSync(dir)) return [];
  const result = (state, detail) => [{ client: "OpenCode", state, detail }];
  const version = getVersion("opencode");
  if (version !== "1.19.5") return result("review", `OpenCode ${version}: the optional bridge is gated to 1.19.5. Review integrations/README.md; no config changed.`);
  const path = join(dir, "herdr-status.js");
  const config = readJson(join(dir, "tui.json"));
  if (fileState(path, openCodeBridge) !== "matched" || !Array.isArray(config?.plugin) || !config.plugin.includes(pathToFileURL(path).href)) {
    return result("review", "OpenCode bridge or tui.json registration missing/different. Follow integrations/README.md with explicit approval; setup never edits OpenCode config.");
  }
  return result("matched", "Bridge and TUI registration match. Start a new OpenCode session and verify a real question/permission/cancel; runtime unverified.");
}

// Runs in the target user's environment. Only the explicitly approved Pi install writes a file.
export function checkHost({
  home = homedir(), agentDir = process.env.PI_CODING_AGENT_DIR || join(home, ".pi/agent"),
  configDir = process.env.XDG_CONFIG_HOME || join(home, ".config"),
  piBridge, openCodeBridge, installPi = false, getVersion: version = getVersion,
}) {
  if (agentDir === "~") agentDir = home;
  else if (agentDir.startsWith("~/")) agentDir = join(home, agentDir.slice(2));
  const options = { home, agentDir, configDir, piBridge, openCodeBridge, installPi, getVersion: version };
  const results = [];
  for (const [client, check] of [["Pi", setupPi], ["OpenCode", checkOpenCode]]) {
    try { results.push(...[check(options)].flat()); }
    catch (error) { results.push({ client, state: "error", detail: error.message }); }
  }
  return results;
}
