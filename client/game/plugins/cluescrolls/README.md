# Clue Scroll

A port of RuneLite 1.13.6's Clue Scroll plugin. It is off by default (RuneLite has it on); turn it
on under Plugins.

When you read a clue scroll (or pick one up, per **Identify**), the plugin works out which clue it
is and shows the solution:

- **Panel** (movable, top left): the clue's kind and solution, the NPC or object to find, the
  emotes or song to play, the coordinates and their nearest landmark, STASH unit and item checks
  (✓/✗ against your inventory and worn items), the three-step cryptic's parts as they are
  found, and your own note for the clue ("Set note" on the panel's right-click menu, 1-3 for
  three-step clues). "Reset" forgets the clue.
- **In the world**: the dig spot, the object to search or the NPC to talk to are outlined, with
  the clue scroll or spade drawn above; a hint arrow points at the NPC, object or tile
  (**Display hint arrows**). Emote clue STASH units are outlined in red while you have items in
  them.
- **Emote and music tabs**: the emotes to perform ("1st"/"2nd") and the song to play are
  highlighted and scrolled into view once per clue.
- **World map**: a clue arrow with the scroll on it at the location, kept at the map's edge when
  off-screen (where it shows the plain scroll); hovering names it, clicking centres the map on it.
- **Hot-cold clues**: each strange device reading narrows the possible dig spots, listed on the
  panel and drawn on the world map, until the device shakes.
- **Charlie the Tramp, Sherlock and Falo the Bard**: their dialogue sets the challenge or riddle,
  and the completion message ticks it off.
- **Bank Tags**: items an active clue needs get the "clue" tag; a clue's reward casket gets
  "treasure chest" tags for the POH costume room.

The clue leaving your inventory (dropped, banked, completed) clears everything.

## Settings

As RuneLite, config group `cluescroll`: **Display hint arrows** (on) and **Identify** (On read /
If inactive / On pickup).

## Differences from RuneLite

- Off by default here; RuneLite enables it.
- The `::clue <text>` developer command works only in development builds (RuneLite: developer
  mode).
- RuneLite reads world objects as the scene spawns them; here named objects (impostor lookups
  through the varbit-driven multiloc) come from a scan of the scene's locs when a clue is set,
  and again a tick after a plane change or a scene rebuild.
- The scroll's text is read on the game tick after the clue interface opens (RuneLite: on the
  next client frame), so the panel can appear up to a tick later.
- The ✓/✗ requirement marks use the panel's own font (RuneLite draws them with a system font).
- Two clue texts in this cache are not in RuneLite 1.13.6's tables and get no help
  (`tests/clue-scroll-cache-crosscheck.test.ts` lists them): the easy cryptic "Someone watching
  the fights **in** the Emir's Arena" (RuneLite has "**at**") and the master hot-cold clue from
  Watson (RuneLite only knows Jorral's).
