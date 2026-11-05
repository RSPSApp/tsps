# Mouse Tooltips

A port of RuneLite 1.13.5's Mouse Tooltips (`mousehighlight`). It is on by default, as in RuneLite.

The left-click option under the cursor shows as a tooltip just below it: "Attack Goblin (level-2)",
"Take Bones", "Wear Bronze axe". Trivial options (Walk here, Cancel, Continue, Set heading) and
sliding puzzle pieces get none, and the game's own tooltips win: while one is about to show
(`TOOLTIP_TIME`) or is showing (`TOOLTIP_BUILT`), there is no second one.
The current cache's visible near-pointer action tooltip also wins. Its separate top-left
mouseover label leaves the plugin available when the native pointer tooltip is absent or disabled.

The option is the one the game's mouseover text uses (`rs/cs2/minimenu.ts`, shared with the
MINIMENU_* script ops): a hovered component's op, else the world menu's first option.

## Settings

As RuneLite, config group `mousehighlight`: interface tooltips, chatbox tooltips and "Disable
spellbook tooltips", so they don't cover the spell descriptions.

## Tooltips

RuneLite's TooltipManager and TooltipOverlay are in `runelite/client/ui/overlay/tooltip`: a plugin
adds a tooltip source, and the overlay (hosted by the hidden Tooltips plugin) stacks this frame's
tooltips under the cursor in the tooltip font. Run Energy's tooltip shares it, under this one.

## Differences from RuneLite

- RuneLite skips RUNELITE_OVERLAY and CC_OP_LOW_PRIORITY entries (always right-click only); the
  hovered entry here doesn't carry its menu action, so they aren't told apart.
- The tooltip's background is RuneLite's standard overlay colour; RuneLite's "Overlay background
  colour" setting isn't ported.
