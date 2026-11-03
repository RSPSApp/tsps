# Implings

A port of RuneLite 1.13.5's Implings. It is on by default, as in RuneLite.

Each type of impling (baby, young, gourmet, earth, essence, eclectic, nature, magpie, ninja,
crystal, dragon, lucky) has a mode:

- **NONE**: not highlighted.
- **HIGHLIGHT**: a tile under the impling and its name above it, both in the type's colour, and
  a dot on the minimap.
- **NOTIFY**: highlighted as above, and "<Type> impling is in the area" when one spawns or an NPC
  changes into one (a red game message, plus a browser notification while the tab is in the
  background, once the browser allows them).

Dragon and lucky implings are highlighted by default; the rest are off. Both the overworld
implings and the Puro-Puro ones count.

In Puro-Puro, **Show spawn locations** marks the fixed impling spawn points (baby, young,
gourmet, earth, essence and eclectic) within 32 tiles, for every type whose mode is not NONE.

## Settings

As RuneLite, config group `implings` with RuneLite's keys: a mode and a colour (with alpha) per
type under "Impling type settings", then Show spawn locations, Impling spawn color and Show name
on minimap.

## Differences from RuneLite

- RuneLite draws through the shared NpcOverlayService. There is none here, so the plugin has its
  own overlay that draws what RuneLite asks the service for (tile, name, minimap dot, and the
  minimap name when set), with the service's default border width and fill.
- The notification is a game message and a browser notification instead of a tray notification.
