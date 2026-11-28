/**
 * Ids and helpers shared by Creature of Fenkenstrain's units. The castle's people are the cache's
 * multinpcs, spawned in the world and shown per player by varp 399 / varbit 185; their gamevals are
 * resolved here because the generated identifiers have no names for them.
 */
const PAGE = "Creature of Fenkenstrain";

module.exports = function createCommon(api, state) {
  const {
    ItemIdentifiers: I, CacheDefinitions, Equipment, TaskManager, Task,
    DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, ActionDialogue,
  } = api.core;

  const npc = (name) => CacheDefinitions.getNpcId(name);
  const loc = (name) => CacheDefinitions.getLocId(name);
  const seq = (name) => CacheDefinitions.getSeqId(name);

  const NPC = Object.freeze({
    /** The castle's Dr Fenkenstrain, shown while varp 399 is 0-7. */
    FENKENSTRAIN: npc("fenk_fenkenstrain"), // 2014
    /** Fenkenstrain hiding in the tower, shown once varp 399 is 8. */
    FENKENSTRAIN_IN_TOWER: npc("fenk_fenkenstrain_in_tower"), // 2015
    /** The creature on the tower's top floor, shown while varp 399 is 0-7. */
    CREATURE: npc("fenk_creature"), // 2016
    /** Lord Rologarth after the quest. */
    ROLOGARTH: npc("fenk_creature_released"), // 2017
    /** The gardener in his garden (varbit 185 0) ... */
    GARDENER: npc("fenk_gardener_multi_2"), // 2013
    /** ... and the one showing the way to his grave (varbit 185 1), spawned per player. */
    GARDENER_GUIDE: npc("fenk_gardener_multi"), // 2012
    ROAVAR: api.core.NpcIdentifiers.ROAVAR, // 6527
    /** The level 51 Experiment, with the cavern key on its collar. */
    KEY_EXPERIMENT: api.core.NpcIdentifiers.EXPERIMENT, // 1273
    /** The models the multinpcs resolve to (the transcripts' speaker ids). */
    FENKENSTRAIN_MODEL: api.core.NpcIdentifiers.DR_FENKENSTRAIN, // 1269
    CREATURE_MODEL: api.core.NpcIdentifiers.FENKENSTRAINS_MONSTER, // 1270
    ROLOGARTH_MODEL: api.core.NpcIdentifiers.LORD_ROLOGARTH, // 1271
    GARDENER_MODEL: api.core.NpcIdentifiers.GARDENER_GHOST, // 1272
  });
  /** The quest's castle people by their spawned (multinpc) id. */
  const CASTLE_NPCS = new Set([NPC.FENKENSTRAIN, NPC.FENKENSTRAIN_IN_TOWER, NPC.CREATURE, NPC.ROLOGARTH, NPC.GARDENER, NPC.GARDENER_GUIDE]);

  const ITEM = Object.freeze({
    STAR_AMULET: I.STAR_AMULET,
    MARBLE_AMULET: I.MARBLE_AMULET,
    OBSIDIAN_AMULET: I.OBSIDIAN_AMULET,
    CAVERN_KEY: I.CAVERN_KEY,
    TOWER_KEY: I.TOWER_KEY,
    SHED_KEY: I.SHED_KEY,
    CANE: I.GARDEN_CANE,
    BRUSHES: [I.GARDEN_BRUSH, I.EXTENDED_BRUSH, I.EXTENDED_BRUSH_2, I.EXTENDED_BRUSH_3],
    TORSO: I.TORSO,
    ARMS: I.ARMS,
    LEGS: I.LEGS,
    HEAD: I.DECAPITATED_HEAD, // fenk_head_empty
    HEAD_WITH_BRAIN: I.DECAPITATED_HEAD_2, // fenk_head_full
    BRAIN: I.PICKLED_BRAIN,
    MOULD: I.CONDUCTOR_MOULD,
    CONDUCTOR: I.CONDUCTOR,
    RING: I.RING_OF_CHAROS,
    RING_ACTIVATED: I.RING_OF_CHAROS_A_,
    JOURNAL: I.JOURNAL_3, // fenk_journal, the book picture on the bookcases' boxes
    LETTER: I.LETTER,
    NEEDLE: I.NEEDLE,
    COSTUME_NEEDLES: [I.COSTUME_NEEDLE, I.COSTUME_NEEDLE_2],
    THREAD: I.THREAD,
    BRONZE_WIRE: I.BRONZE_WIRE,
    SPADES: [I.SPADE, I.SPADE_2],
    GHOSTSPEAK_AMULETS: [I.GHOSTSPEAK_AMULET, I.GHOSTSPEAK_AMULET_2],
    COINS: I.COINS,
    ZOMBIE_HEAD: I.ZOMBIE_HEAD,
  });

  const LOC = Object.freeze({
    BOOKCASE: loc("fenk_bookcase"), // 5166
    MEMORIAL: loc("fenk_coffin"), // 5167
    GRAVE: loc("fenk_grave"), // 5168
    GRAVE_POOR: loc("fenk_grave_poor"), // 5169
    MAUSOLEUM_DOOR: loc("fenk_mausoleum_door"), // 5170
    TOWER_DOOR: loc("fenk_tower_door"), // 5172
    SHED_DOOR: loc("fenk_shed_door"), // 5174
    CONDUCTOR_BROKEN: loc("fenk_conductor_broken"), // 5176
    CONDUCTOR_REPAIRED: loc("fenk_conductor_repaired"), // 5177
    CUPBOARD: loc("fenk_broomcupboard"), // 5156
    CUPBOARD_OPEN: loc("fenk_broomcupboard_open"), // 5157
    CANE_PILE: loc("fenk_canepile"), // 5158
    CHEST_OPEN: loc("fenk_chest_open"), // 5163
    CLOCK: loc("fenk_clock"), // 5161
    SIGNPOST: loc("fenk_signpost"), // 5164
    FIREPLACE: loc("fenk_fireplace"), // 5165
  });

  const SEQ = Object.freeze({
    DIG: seq("human_dig_long"), // 831
    POKE: seq("fenk_human_poke"), // 1633, the brush up the chimney
    OPEN_HIGH_CUPBOARD: seq("human_openhighcupboard"), // 542
    BOOKCASE_OPEN: seq("fenk_bookcase_open"), // 1621, a loc anim
    CAPSTONE: seq("fenk_capstone_moves"), // 1620, a loc anim
    LIGHTNING: seq("fenk_lightning"), // 1632, a loc anim
  });

  const SOUND = Object.freeze({
    DIG: 1470, // digspade
    BOOKCASE: 1468, // bookcasedoor
    SCRAPE: 2410, // scrape, the memorial's lid
    BRUSHING: 1469, // brushing
    LIGHTNING: 1471, // lightning
    LOCKED: 2402, // locked, as a locked quest door opens
    CUPBOARD_OPEN: 58, // cupboard_open
  });

  const BUSY_VARBIT = 12393;

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function heldAny(player, ids) {
    return ids.some((id) => held(player, id));
  }

  function inBank(player, itemId) {
    return (player.getBanks?.() ?? []).some((bank) => bank?.getAmount?.(itemId) > 0);
  }

  function wearing(player, slot, ids) {
    const id = player.getEquipment?.().get?.(slot)?.getId?.();
    return ids.includes(id);
  }

  function wearingGhostspeak(player) {
    return wearing(player, Equipment.AMULET_SLOT, ITEM.GHOSTSPEAK_AMULETS);
  }

  /** The ring anywhere the player keeps it: carried, worn or banked (either version). */
  function ownsRing(player) {
    return [ITEM.RING, ITEM.RING_ACTIVATED].some((id) => held(player, id) || inBank(player, id))
      || wearing(player, Equipment.RING_SLOT, [ITEM.RING, ITEM.RING_ACTIVATED]);
  }

  /** The base (spawned) id of an NPC, so the castle's people are told from other quests' 1269. */
  function baseId(npcEntity) {
    return npcEntity?.getId?.();
  }

  function later(player, ticks, fn) {
    const task = new (class extends Task {
      constructor() { super(ticks, player, false); }
      execute() {
        this.stop();
        if (player.isRegistered?.() === false) return;
        fn();
      }
    })();
    TaskManager.submit(task);
    return task;
  }

  /**
   * A box as live sends it outside a conversation: an item box (objectbox 193) when `itemId` is
   * given, else a message box (229). `onContinue` runs once it is continued or closed any other way.
   */
  function box(player, text, itemId, onContinue) {
    const manager = player.getDialogueManager();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onContinue?.();
    };
    const shown = itemId === undefined || itemId === null
      ? new StatementDialogue(0, text)
      : new ItemStatementDialogue(0, itemId, text);
    const after = new ActionDialogue(1, { execute: () => {
      manager.reset?.();
      player.getPacketSender().sendInterfaceRemoval();
      finish();
    } });
    manager.startDialogues(new DialogueChainBuilder().add(shown).add(after));
    if (!onContinue) return;
    const watch = new (class extends Task {
      constructor() { super(1, player, false); }
      execute() {
        if (done) return this.stop();
        if (player.isRegistered?.() === false) { this.stop(); return finish(); }
        const current = manager.getCurrent?.();
        if (current !== shown && current !== after) { this.stop(); finish(); }
      }
    })();
    TaskManager.submit(watch);
  }

  /** A delay holding the player still with the client's busy varbit on, as live's do. */
  const holds = new WeakMap();
  function hold(player) {
    const token = {};
    holds.set(player, token);
    player.getMovementQueue().reset();
    player.getMovementQueue().setBlockMovement(true);
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
    return token;
  }
  function release(player, token) {
    if (holds.get(player) !== token) return;
    holds.delete(player);
    player.getMovementQueue().setBlockMovement(false);
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
  }
  const busy = (player) => holds.has(player);

  function at(location, x, y, z) {
    if (!location) return false;
    const lx = location.getX?.() ?? location.x;
    const ly = location.getY?.() ?? location.y;
    const lz = location.getZ?.() ?? location.z ?? 0;
    return lx === x && ly === y && (z === undefined || lz === z);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  return {
    PAGE, NPC, CASTLE_NPCS, ITEM, LOC, SEQ, SOUND,
    held, heldAny, inBank, wearingGhostspeak, ownsRing, baseId, later, box, hold, release, busy, at, questComplete,
  };
};

module.exports.PAGE = PAGE;
