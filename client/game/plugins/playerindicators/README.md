# Player Indicators

A port of RuneLite's Player Indicators
([wiki](https://github.com/runelite/runelite/wiki/Player-Indicators)). Turn it on in the
plugin list; it is off on fresh installs.

## Who is highlighted

Each group has a setting (Disabled, Enabled, or PvP: only in the Wilderness or a PvP area) and
a colour. A player takes the colour of the first group they are in whose setting is on:

| Group | Default | Colour |
| --- | --- | --- |
| Own player | Disabled | cyan |
| Friends | Enabled | green |
| Friends chat members | Enabled | purple |
| Team members (same cape team as you) | Enabled | blue |
| Clan members | Enabled | dark blue |
| Others (not in your friends chat or clan) | Disabled | red |

## What it draws

- **Name position:** above the head (default), at the model's centre, to its right, or off.
- **Draw tiles under players:** the tile the player stands on, in their colour.
- **Draw names on minimap:** the name next to the player's minimap dot.
- **Colorize player menu:** the player's right-click entries, including Use and Cast on them.
- The trade screen's "Trading with:" name, for a highlighted player.

Highlights draw over the scene and under interfaces, for players on your level.

## Storage

Config group `playerindicators`, with RuneLite's keys.

## Differences from RuneLite

- Off on fresh installs (RuneLite turns it on), as NPC Indicators is here.
- Only players on your level are highlighted.

- No party members: the client has no party.
- No friends chat or clan rank icons next to names or in menus.
- "Walk here" over a player keeps its colour.
- Players aboard boats (world entities) are not highlighted yet.
