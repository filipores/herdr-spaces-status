import { setupStatus, setupExitCode } from "../integrations/setup.mjs";

const usage = `Usage: node scripts/status-setup.mjs [--install-pi HOST ...]

Checks local and every registered Herdr machine using hc (read-only by default).
Repeat --install-pi HOST to approve creating a missing Pi question bridge on that host.
Existing files are never overwritten. No package updates, config edits or session restarts.
Exit 0: no detected file/config gaps. Exit 1: action needed, including reload after install.
A real question/answer/cancel per host is still required; exit 0 is NOT runtime verification.`;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
  } else {
    const installPi = [];
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] !== "--install-pi" || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(usage);
      installPi.push(args[i + 1]);
    }
    const results = setupStatus({ installPi });
    for (const r of results) console.log(`${r.host} | ${r.client} | ${r.state}\n  ${r.detail}`);
    console.log("\nScope: this user's global Pi profile and standard OpenCode config per host; project/session overrides and native-client runtime are not verified. Repeat after adding/reconnecting hosts or updating clients.");
    process.exitCode = setupExitCode(results);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
