"use strict";

/**
 * Kraken and Cave krakens in the Kraken Cove.
 *
 * Behaviour: https://oldschool.runescape.wiki/w/Kraken (Disturb the whirlpool to surface
 * the boss; four tentacles fight beside it) and
 * https://oldschool.runescape.wiki/w/Cave_kraken (Disturb to surface). Both the boss, its
 * tentacles and cave krakens can only be damaged with Magic (Wiki).
 *
 * Ids from the cache (rev 241, api.core.NpcIdentifiers): whirlpools 493 (cave), 496 (boss),
 * 5534 (tentacle) surfacing as 492 (Cave kraken), 494 (Kraken) and 5535 (Enormous Tentacle).
 * Surfacing animations from data/definitions/npc-animations.json (7135 cave/boss, 3860
 * tentacle). Combat stats, drops, spawns, Slayer level (87, enforced by Combat.Slayer),
 * cannon rules and teleports already exist in data/definitions and plugins; this plugin only
 * adds the missing wake (Disturb order, fishing explosive), style rules and typeless hits.
 * Deaths respawn as whirlpools via the engine (NPCDeathTask clears the transformation
 * before queuing the respawn). The cove is multicombat (Area.Kraken.js over the
 * Slayer-area box) so the boss and its tentacles can pile one player. Loot lands on
 * a fixed verified shore tile (Loot.Kraken.js), not under the body.
 *
 * Estimates (no capture yet): BOSS_WAKE_RADIUS and DISTURB_RANGE, the early-Disurb
 * "Nothing happens." message, explosive consumption, the throw animation (783) and
 * the 6-tick throw-to-wake delay. The boss-side crevice landing is RSPS-cross-checked
 * (see Crevice.Kraken.js). The cove refuses attacks off-task (Area.Kraken.js); the 25k
 * private room is owned and cleaned up by Instance.Kraken.js.
 */

const Shared = require("./kraken/Shared.Kraken");
const Disturb = require("./kraken/Disturb.Kraken");
const MagicOnly = require("./kraken/MagicOnly.Kraken");
const Typeless = require("./kraken/Typeless.Kraken");
const Crevice = require("./kraken/Crevice.Kraken");
const Fight = require("./kraken/Fight.Kraken");
const Area = require("./kraken/Area.Kraken");
const Respawn = require("./kraken/Respawn.Kraken");
const Loot = require("./kraken/Loot.Kraken");
const Instance = require("./kraken/Instance.Kraken");

module.exports = {
  name: "Kraken",
  description: "The Kraken and cave krakens in Kraken Cove: disturb the whirlpool to surface them, four tentacles beside the boss, and Magic-only damage.",
  members: true,
  register(api) {
    Shared.bind(api);
    Disturb.attach(api);
    MagicOnly.attach(api);
    Typeless.attach(api);
    Crevice.attach(api);
    Fight.attach(api);
    Area.attach(api);
    Instance.attach(api);
    Respawn.attach(api);
    Loot.attach(api);
  },
};
