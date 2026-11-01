export function navigationTarget(command, spaces, agents) {
  if (command === "first_done") {
    const agent = agents.find(a => a.status === "done");
    return agent && { name: "agent.focus", args: { terminal: agent.address } };
  }
  if (command === "next_working") {
    const start = spaces.findIndex(s => s.active) + 1;
    const ordered = [...spaces.slice(start), ...spaces.slice(0, start)];
    const space = ordered.find(s => agents.some(a => a.space === s.id && a.status === "working"));
    return space && { name: "space.select", args: { id: space.id } };
  }
}
