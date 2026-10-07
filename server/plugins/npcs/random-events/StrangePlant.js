"use strict";

// Growth/owned picking adapted from LostCity macro_event_triffid.rs2 (MIT).
// Current OSRS keeps dismissal and removes the old hostile stage. See SOURCES.md.
const GROW_ANIMATION = 348;
const GROWTH_MS = 45 * 600;
const FRUIT_LIFETIME_TICKS = 3 * 60 * 60 * 1000 / 600;

function addDefinition(api, { definitions }) {
  definitions.push({ id: api.core.NpcIdentifiers.STRANGE_PLANT, kind: "plant", stationary: true,
    onSpawn: grow.bind(null, api), talk: pick.bind(null, api) });
}

function grow(api, active) {
  active.npc.performAnimation(new api.core.Animation(GROW_ANIMATION));
}

function pick(api, active, { valid, serve, finish }) {
  const player = active.player;
  if (!valid(active, player)) return;
  if (Date.now() - active.startedAt < GROWTH_MS) {
    player.sendMessage("The fruit isn't ready to be picked yet...");
    return;
  }
  const fruitId = api.core.ItemIdentifiers.STRANGE_FRUIT;
  if (player.getInventory().getFreeSlots() > 0) {
    if (serve(active, [fruitId])) player.sendMessage("You pick the fruit from the plant.");
    return;
  }
  const position = player.getLocation().clone();
  finish(active);
  const manager = api.getItemOnGroundManager();
  const drop = manager.registerLocation(player, new api.core.Item(fruitId, 1), position);
  drop.goesGlobal = false;
  // Existing floor-item clock expires at DESPAWN_DELAY; offset its starting tick
  // for the Wiki's three-hour private fruit drop without a new cleanup timer.
  drop.setTick(manager.DESPAWN_DELAY - FRUIT_LIFETIME_TICKS);
  player.sendMessage("You pick the fruit from the plant. It falls to the ground because your inventory is full.");
}

module.exports = { addDefinition };
