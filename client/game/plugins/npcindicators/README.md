# NPC Indicators

Native browser RuneLite plugin. Registration belongs to the host plugin registry.
Enable **NPC Indicators** in the plugin hub, then open its **NPC Indicators** sidebar icon. The panel uses the same generated settings as the hub: **NPC names**, **Default colour**, and **Fill opacity**. The icon appears only while the plugin is enabled and is removed on disable.

Enter one exact NPC name per line (case insensitive), for example `Goblin|#00ff00`. Commas also separate names. A missing or invalid colour uses the configured default colour. Empty configuration highlights nothing.

This port supports scene tile indicators; it does not implement RuneLite's NPC model outlines. Markers follow live NPC tiles on the player's plane, updating after actor interpolation each frame. The current transformed definition supplies the name; invisible/null transformations are excluded. Owned marker slots 62000–62127 are rebuilt on ticks and cleared on scene changes or shutdown without clearing other plugins' markers. Overlapping NPCs retain their shared tile when one moves. The first 128 unique names are supported.

Verification from `client`: `node_modules/.bin/tsx tests/npc-indicators.test.ts` and `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
