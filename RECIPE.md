# Spaces Status

A replacement Spaces sidebar for the Herdr desktop app, with agent status directly on each space. It replaces the separate Agents section for status monitoring. Keep familiar project names, worktree nesting and Git hints; add green and orange attention glows and a quiet silver contour for ongoing work. Only the contour breathes: selected backgrounds and text remain still.

![Spaces Status](preview.png)

## What you see

- The usual **Spaces** heading and **+** control, followed by your spaces. Connected machines get collapsible headings when more than the local machine is present.
- Regular rows are 30 px high, nested worktree rows 28 px, with 8 px corners and horizontal padding. Names sit beside an 18 px colored initial or a worktree branch icon; repository, branch and ahead/behind hints appear at the right when useful. The base text size is 13 px.
- **Done:** a green `#22c55e` outline with a soft halo and a faint green fill.
- **Blocked:** the same treatment in orange `#f59e0b`.
- **Working:** a 1 px neutral contour using the theme's foreground color. It breathes between 10% and 24% opacity over 3200 ms with `ease-in-out`. Three outer contours, offset by 1, 2 and 3 px and weighted 0.38, 0.16 and 0.06 relative to the core, soften its edge. There is no working-state fill or spinner.
- **Idle or no agent:** no attention glow and no animation.
- The selected row retains Herdr's static selection background. Activity must not make several rows look selected.
- Below a sidebar width of 160 px, rows become a 26 px-high compact rail with an index and status mark. The same outline/glow behavior remains; the working mark is neutral.

## How it behaves

- Read the space's aggregate status for the attention glow. Herdr supplies priority `blocked > done > working > idle`; do not reimplement it.
- Independently collect spaces containing at least one `working` agent from `agents()`. A working agent in another space must never light up this row. Machine-qualified IDs must remain distinct.
- In mixed spaces, keep the working contour even when another agent is done or blocked. The stronger green/orange signal remains visible.
- Herdr's unseen `done` state returns to `idle` after the user looks at it. Do not keep your own completion latch, change agent state, or imply that completion means success.
- Animate only decorative outline elements. Keep the center transparent and leave the selected background, labels, avatars and row geometry static. Use native opacity animation, not a JavaScript timer, rotation, scaling or a moving highlight.
- A click selects a space; drag reorders spaces on their machine; right-click opens the normal space menu. The header **+** creates a space. Machine headers fold and remember their state. Compact rows retain click-to-select.
- Preserve the original Git hints, worktree nesting, avatar colors and local preferences. Add no keybindings.

## Built from

- One mod: `mods/spaces-glow/main.js` and `mod.json`. The manifest is `place: "none"`; this replaces an existing Spaces block rather than automatically docking another panel. No `layouts/` folder or keys snippet is needed.
- The installation agent clones a shipped layout if necessary, then changes only the existing Spaces block's `content.mod` to `spaces-glow` in the user's personal layout. Keep the sidebar node's `id` as `sidebar` so its width can select regular or compact rendering.
- The implementation is a modified copy of Herdr App 0.1.11's `defaults/mods/spaces/main.js`, checked with Herdr App 0.1.11. Use `View`, `div` and `svg` from `gpui-kit`, plus `v_flex`/`h_flex` from `gpui-base`.
- Use `spaces()`, `agents()`, `panes()`, `machines()`, `layout()`, `theme()` and `window()` for live data. Use `shared`/`setShared` for avatar colors and `localStorage` for folded machines.
- Native `.loop("opacity", {from: 0.1, to: 0.24, period: 3200, easing: "ease-in-out"})` belongs on a decorative, absolutely positioned container with a stable per-space ID. Its only children are thin, increasingly transparent outline layers.
- The colored attention treatment uses an inner fill with hex alpha `18` and four 1 px outlines with alpha `70`, `38`, `20`, `10`, offset outward by 0–3 px. The working contour is a separate lower layer; it never adds a fill.
- Use Herdr's installed `mods/workspace-chrome/` SVGs and the shipped `menu` mod. Do not bundle the app, generated type declarations or personal configuration.
- Preserve the original commands: `space.select`, `space.move`, `space.new`, plus the normal context-menu overlay.
- **External access:** `exec` runs read-only `git status --porcelain=v2 --branch` (with optional locks disabled) and `git rev-parse` for each relevant repository, locally or on its Herdr machine. `watchFolder` watches local Git metadata. `hc machine ls --json` reads machine state. The inherited Git/machine refresh loops remain, but activity animation adds no polling. There is no analytics endpoint or credential access.

## Watch out

- This is for the native **Herdr App**, not the terminal-only Herdr configuration.
- The optional Pi and OpenCode bridges are separate from the mod; see [client integrations](integrations/README.md) for tested versions, setup and removal. Install them only with explicit permission, after verifying a real status gap. The sidebar itself must not infer or modify agent states.
- Never overwrite a user's existing mod, layout or keybindings. If `spaces-glow` already exists, stop or rename the new copy and its layout reference.
- Copying a `place: "none"` mod alone does not make it visible. Explicitly replace the existing Spaces block. Do not create a duplicate sidebar.
- A cloned layout still references its original mods. Point the Spaces block at the custom mod; leave every other block alone.
- Use the installed `AGENTS.md`, `herdr.d.ts` and `gpui-kit.d.ts` as API truth. The copies of these files generated by `herdr-app check` are not part of the distribution.
- Herdr replaces shipped mods at startup. This custom copy persists but does not automatically inherit upstream fixes.
- The neutral contour follows the foreground theme token; avoid hard-coded white that becomes invisible in Light Mode. Working must not reuse the selected background or turn into a full-row opacity pulse.
- State aggregation includes agents not represented by a visible pane. Read `agents()`, not only `panes()` or the aggregate space status, to find ongoing work.
- Light Mode, VoiceOver and system Reduce Motion have not been visually/accessibility tested. There is no documented Reduce Motion preference in this mod API; do not claim support that has not been verified.
- Machine folding is stored under the mod's own local-storage namespace; a new installation may start unfolded.
- The screenshot contains synthetic names/statuses and a frozen moment of the native contour animation. It is not a full-window screenshot of someone's terminals.

## Done when

- `herdr-app check mods/spaces-glow` passes with a compatible installed Herdr App.
- `node --experimental-vm-modules checks/spaces-glow.cjs` passes glow/pulse and drag/drop checks: no cross-machine move or move without hovering the target.
- Working-only rows show a thin neutral, softly breathing contour with no spinner and no animated fill. The same holds in compact mode and while selected.
- Done is green; blocked is orange; idle/no-agent has neither effect. Working mixed with done or blocked retains both signals. Another space's workers do not leak into this row.
- Across several native screenshots, outline pixels change but the row center and selected background stay constant. There are no layout shifts or native render errors.
- Normal selection, creation, reordering, context menus, machine folding and worktree/Git display still work as in the original Spaces mod.
- The user's other panels, layouts, keys and live terminals are untouched. Restoring `content.mod` to `spaces` removes the customization.
