/**
 * Creature of Fenkenstrain's saved state and the variables live sends for it
 * (docs/quests/creature-of-fenkenstrain). Live keeps the quest in three places:
 *
 * - varp 399 `fenk_quest`: 0 before, 1 parts, 2 needle and thread, 3 conductor, 4 conductor repaired,
 *   5 creature loose, 6 creature convinced, 8 complete. Quest Helper keys on it, and the cache shows
 *   Fenkenstrain (2014 / in the tower 2015), the creature (2016), Rologarth (2017) and the lab table
 *   (5182) by it.
 * - varbit 13715 `creatureoffenkenstrain` (varp 3403 bits 2-5), the quest list's: 0, then 2-7 for
 *   stages 1-6, 9 complete.
 * - varp 400, every bit of it the quest's: the parts and the needle and thread handed in, the star in
 *   the memorial, the gardener spoken to, the last grave dug, the three doors unlocked, the bridges and
 *   the gardener showing the way (varbit 185, which swaps the gardener 2013 for his guide 2012).
 *   Completion clears it (capture tick 2225).
 *
 * The saved stage keeps the old numbering (0-6 as varp 399, 7 complete) so saves carry over;
 * varp 400 is saved whole and sent whole on login.
 */
module.exports = function createState(api, getQuest) {
  const STAGE = Object.freeze({
    NOT_STARTED: 0,
    PARTS: 1,
    NEEDLE_AND_THREAD: 2,
    CONDUCTOR: 3,
    CONDUCTOR_REPAIRED: 4,
    CREATURE_LOOSE: 5,
    CREATURE_CONVINCED: 6,
    COMPLETE: 7,
  });

  const VARP_FENK_QUEST = 399;
  const VARP_FENK_STATE = 400;
  /** Varp 400's varbits, as the cache lays them out: id, first bit, last bit. */
  const FIELD = Object.freeze({
    ARMS: [186, 0, 0], // fenk_arms
    LEGS: [187, 1, 1], // fenk_legs
    TORSO: [188, 2, 2], // fenk_torso
    HEAD: [189, 3, 3], // fenk_head
    NEEDLE: [190, 4, 4], // fenk_needle
    THREADS: [191, 5, 7], // fenk_threads_given
    COFFIN: [192, 8, 8], // fenk_coffin: the star amulet sits in the memorial
    SPOKEN_TO_GARDENER: [193, 9, 9], // fenk_spoken_to_gardener: the amulet's box has been shown
    DIG_RESULT: [197, 17, 19], // fenk_digresult: the part grave last dug, 1 head .. 4 legs
    UNLOCKED_TOWER: [198, 20, 20], // fenk_unlocked_tower
    UNLOCKED_CAVERN: [199, 21, 21], // fenk_unlocked_cavern
    UNLOCKED_SHED: [200, 22, 22], // fenk_unlocked_shed
    BRIDGE_NORTH: [4441, 24, 26], // fenk_built_bridge_north
    BRIDGE_SOUTH: [5023, 27, 29], // fenk_built_bridge_south
    GARDENER_DIRECTIONS: [185, 31, 31], // fenk_gardener_directions: the gardener is showing the way
  });

  const STATE_ATTRIBUTE = "creature-of-fenkenstrain:state";
  api.persistAttribute(STATE_ATTRIBUTE, 0);

  // The previous implementation's attributes, read once on login and folded into varp 400.
  const LEGACY = Object.freeze({
    PARTS_GIVEN: "quest.creature_of_fenkenstrain.parts_given",
    PARTS_FOUND: "quest.creature_of_fenkenstrain.parts_found",
    SEWING: "quest.creature_of_fenkenstrain.sewing",
    FLAGS: "quest.creature_of_fenkenstrain.flags",
  });
  for (const key of Object.values(LEGACY)) api.persistAttribute(key, 0);

  function stage(player) {
    return getQuest().getStage(player);
  }

  /** Varp 399 as live sends it for a saved stage. */
  function questVarp(value) {
    return value >= STAGE.COMPLETE ? 8 : value;
  }

  /** Varbit 13715 (the quest list) for a saved stage. */
  function questListValue(value) {
    if (value <= 0) return 0;
    return value >= STAGE.COMPLETE ? 9 : value + 1;
  }

  function word(player) {
    return Number(player.getAttribute(STATE_ATTRIBUTE)) >>> 0;
  }

  function get(player, [, low, high]) {
    const width = high - low + 1;
    return (word(player) >>> low) & ((2 ** width) - 1);
  }

  function set(player, [varbit, low, high], value) {
    const width = high - low + 1;
    const mask = ((2 ** width) - 1) * 2 ** low;
    const next = ((word(player) & ~mask) | ((value * 2 ** low) & mask)) >>> 0;
    player.setAttribute(STATE_ATTRIBUTE, next | 0);
    player.getPacketSender().sendVarbit(varbit, value);
  }

  function clear(player) {
    player.setAttribute(STATE_ATTRIBUTE, 0);
    // Live clears each varbit on the completion tick (2225); the whole varp is the same thing.
    player.getPacketSender().sendConfig(VARP_FENK_STATE, 0);
  }

  function publish(player) {
    const sender = player.getPacketSender();
    sender.sendConfig(VARP_FENK_QUEST, questVarp(stage(player)));
    sender.sendConfig(VARP_FENK_STATE, word(player) | 0);
  }

  /** The old plugin's bits (head 1, torso 2, arms 4, legs 8; needle bit 0 + threads; star flag 2). */
  function migrate(player) {
    const given = Number(player.getAttribute(LEGACY.PARTS_GIVEN)) || 0;
    const sewing = Number(player.getAttribute(LEGACY.SEWING)) || 0;
    const flags = Number(player.getAttribute(LEGACY.FLAGS)) || 0;
    const found = Number(player.getAttribute(LEGACY.PARTS_FOUND)) || 0;
    if (!given && !sewing && !flags && !found) return;
    if (word(player) === 0 && stage(player) < STAGE.COMPLETE) {
      if (given & 1) set(player, FIELD.HEAD, 1);
      if (given & 2) set(player, FIELD.TORSO, 1);
      if (given & 4) set(player, FIELD.ARMS, 1);
      if (given & 8) set(player, FIELD.LEGS, 1);
      if (sewing & 1) set(player, FIELD.NEEDLE, 1);
      set(player, FIELD.THREADS, Math.min(5, sewing >>> 1));
      if (flags & 2) set(player, FIELD.COFFIN, 1);
    }
    for (const key of Object.values(LEGACY)) player.setAttribute(key, 0);
  }

  return { STAGE, FIELD, VARP_FENK_QUEST, VARP_FENK_STATE, stage, questVarp, stateValue: (player) => word(player) | 0, questListValue, get, set, clear, publish, migrate };
};
