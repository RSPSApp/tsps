# NPC Indicators

Native browser RuneLite plugin. Registration belongs to the host plugin registry.
Enable **NPC Indicators** in the plugin hub, then configure **NPC names** with one exact name per line (case insensitive), for example `Goblin|#00ff00`. A missing colour uses the configured default colour. Empty configuration highlights nothing.

Markers follow live NPC tiles on the player's plane. The current transformed definition supplies the name; invisible/null transformations are excluded. Owned marker slots 62000–62127 are rebuilt on ticks and cleared on scene changes or shutdown without clearing other plugins' markers. The first 128 unique names are supported.

Verification from `client`: `node_modules/.bin/tsx tests/offline-utility-plugins.test.ts` and `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
