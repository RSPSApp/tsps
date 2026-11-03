# Wiki

A port of RuneLite 1.13.5's Wiki (`wiki`). It is on by default, as in RuneLite.

- **Lookup**: click the wiki button under the minimap, then an NPC, object, ground item or item in
  an interface, and its OSRS Wiki page opens in a new tab (`Special:Lookup` with its id, name and,
  for NPCs and objects, its tile). Nothing goes to the server.
- **Search**: right-click the button for "Search", type in the chatbox and press Enter for the
  wiki's search.
- Skills on the skills tab and combat achievement tasks get a **Wiki** option opening their page.

**Show wiki button under minimap** hides the button when off.

## How

The button is the game's own (`Orbs.WIKI_ICON`), whose target verb is "Lookup-entity". While it is
selected, the plugin takes every target click through the `onMenuOptionClicked` hook (RuneLite's
MenuOptionClicked), as RuneLite does: it looks up what the click names (the NPC's server index,
the object or ground item and its scene tile, or the interface item) and consumes the click, so no
target op goes to the server. The same hook takes the button's Search op.

## Differences from RuneLite

- RuneLite replaces the game's button with a widget of its own; here the game's is used as it is,
  so the game's "Show Wiki entity lookup" setting still hides it.
- No "Left-click search": the button transmits only its Search op (op 10), which the menu lists
  after the Lookup target, and moving it in front needs event flags only the server sets.
- No "DPS" option (RuneLite's DPS calculator export) and no search suggestions while typing.
- The links don't carry RuneLite's `utm_source=runelite`: this isn't RuneLite.
