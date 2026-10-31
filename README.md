# Spaces Glow

Quiet status signals for the Herdr desktop app's Spaces sidebar.

![Spaces Glow](preview.png)

- **Working:** a thin silver-gray contour gently breathes. No spinner, no flashing row fill.
- **Done:** a green glow draws your attention to an unseen result.
- **Blocked:** an orange glow means an agent needs you.
- **Idle:** no glow or animation.

Selection keeps its normal, static background. A space with several agents can keep its working contour alongside a done or blocked glow. Both expanded and compact sidebars are supported.

## Install

Requires the **Herdr desktop app**, not the terminal-only `herdr` program. Tested with Herdr App **0.1.10** on macOS.

Ask your agent:

> Install https://github.com/filipores/herdr-spaces-glow as a replacement for my Spaces sidebar. Read RECIPE.md and the code first. Preserve my layout, keybindings, and terminals; clone a shipped layout before changing it. Do not overwrite an existing mod with the same name.

For manual installation:

1. Read [RECIPE.md](RECIPE.md), particularly **Watch out** and the external-command disclosure.
2. Copy `mods/spaces-glow/` into your Herdr app home's `mods/` directory. Stop if that name already exists.
3. In your **personal** layout, replace the Spaces block's `"content": { "mod": "spaces" }` with `"content": { "mod": "spaces-glow" }`. Keep the sidebar node's `id` as `"sidebar"` for compact-mode detection. Clone a shipped layout first; never edit Herdr's originals.
4. Run `herdr-app check ~/.config/herdr-app/mods/spaces-glow`, then inspect the running app for errors with `herdr-app status`.

The manifest uses `place: "none"`: copying the mod alone intentionally does **not** add a second sidebar. No layout or keybinding files are distributed.

**Undo:** point that block back to `"spaces"`. Your terminals and the rest of the layout are untouched.

## What it accesses

This is a customized copy of Herdr's Spaces mod. It reads Herdr's live spaces, agents and machines; runs read-only `git status`/`git rev-parse` commands; watches local Git metadata; and calls `hc machine ls`. Git reads can run on machines you have connected to Herdr. Clicks retain the original space selection, creation, reordering and context menus. It saves avatar colors and folded-machine preferences in Herdr's local state.

No analytics, credential handling, package dependencies or new animation polling. Herdr's existing Git/machine refresh behavior remains.

## Checks

From this repository:

```sh
node --experimental-vm-modules checks/spaces-glow.cjs
herdr-app check mods/spaces-glow
```

The Node check covers 68 cases: status colors, unchanged selection backgrounds, contour-only animation, dark/light color inputs, compact rows, mixed agent states and isolation between spaces. The native render check and actual app verification remain necessary.

## Limits

- `done` means an agent finished while you were not looking. It does **not** guarantee task success; Herdr changes it to `idle` once seen.
- The copied Spaces implementation does not automatically receive upstream improvements.
- Runtime icons and context menus come from Herdr's shipped `workspace-chrome` and `menu` mods.
- Light-mode inputs are tested, but Light Mode, VoiceOver and system Reduce Motion behavior have not been visually/accessibility tested. Herdr's mod API exposes no documented Reduce Motion preference here.
- The preview uses synthetic space names and statuses, not a real workspace.

## License

[Apache-2.0](LICENSE). Derived from [Herdr's Spaces mod](https://github.com/herdrdev/herdr-app/blob/v0.1.9/defaults/mods/spaces/main.js); see [NOTICE](NOTICE). Independent community mod, not an official Herdr release.
