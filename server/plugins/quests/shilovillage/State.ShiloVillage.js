/**
 * Shilo Village's shared state: the ids, stages, tiles and helpers every unit file uses
 * (Village, AhZaRhoon, Bervirius, Rashiliyia, Npcs). `createState(api)` is called once by
 * ShiloVillage.Quest.js; the quest handle is set on it after registerQuest.
 *
 * Stages are the native zombiequeen varp (116), as the rev 242 capture sets them (RSProx capture
 * ShiloVillage, docs/quests/shilo-village/README.md): 0 not started; 1 Trufitus takes the belt
 * (t1926); 2 Trufitus's "Erm, I don't know where to look?" (t1935); 3 the mound searched (t2459);
 * 4 dug (t2464); 5 the light dropped in (t2511); 6 roped (t2547); 7 down into Ah Za Rhoon (t2566);
 * 8 out of it (t2885); 9 into Bervirius' tomb (t3519); 10 the bone key opens the carved doors
 * (t4022); 11 through the ancient gate with the Beads of the Dead (t4067); 12 the third bone
 * (t4592); 14 Rashiliyia's remains taken (t4850); 15 complete (t5257); 16 and 17 Trufitus's first
 * and second talks after it (t5788, t5794).
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
const { boxFor } = require("./Boxes.ShiloVillage");

module.exports = function createState(api) {
  const {
    Skill,
    Equipment,
    Location,
    GameObject,
    ObjectManager,
    ItemIdentifiers: I,
    NpcIdentifiers: N,
    ObjectIdentifiers: O,
    TaskManager,
    CountdownTask,
  } = api.core;
  const { startTranscript } = require("../QuestRuntime");

  const sv = {
    api,
    ObstacleRunner,
    boxFor,
    PAGE: "Shilo Village",
    MOSOL_PAGE: "Mosol Rei",
    TRUFITUS_PAGE: "Trufitus",
    YANNI_PAGE: "Yanni Salika",
    /** Set by ShiloVillage.Quest.js once the quest is registered. */
    quest: null,

    VARP: 116,
    STAGE: Object.freeze({
      NOT_STARTED: 0,
      STARTED: 1,
      TOLD_WHERE: 2,
      SEARCHED_MOUND: 3,
      DUG_MOUND: 4,
      LIT_MOUND: 5,
      ROPED_MOUND: 6,
      ENTERED_TEMPLE: 7,
      LEFT_TEMPLE: 8,
      ENTERED_BERVIRIUS: 9,
      UNLOCKED_TOMB: 10,
      ENTERED_WITH_BEADS: 11,
      UNLOCKED_TOMB_DOOR: 12,
      RETRIEVED_CORPSE: 14,
      COMPLETE: 15,
      TOLD_TRUFITUS: 16,
      TOLD_TRUFITUS_AGAIN: 17,
    }),

    NPC: Object.freeze({
      TRUFITUS: N.TRUFITUS, // 4625
      MOSOL_REI: N.MOSOL_REI, // 5340
      MOSOL_REI_COMPLETE: N.MOSOL_REI_2, // 8696
      SPIRIT_OF_ZADIMUS: N.SPIRIT_OF_ZADIMUS, // 5341
      RASHILIYIA: N.RASHILIYIA, // 5352
      NAZASTAROOL: [N.NAZASTAROOL, N.NAZASTAROOL_2, N.NAZASTAROOL_3], // 5353 zombie, 5354 skeleton, 5355 ghost
      UNDEAD_ONE: N.UNDEAD_ONE, // 5342
      UNDEAD_ONE_ARMED: 5344, // zqskeleton_armed, "Undead one"
      YANNI: N.YANNI_SALIKA, // 5361
    }),

    ITEM: Object.freeze({
      WAMPUM_BELT: I.WAMPUM_BELT, // 625
      ZADIMUS_CORPSE: I.ZADIMUS_CORPSE, // 610
      BONE_SHARD: I.BONE_SHARD, // 604
      BONE_KEY: I.BONE_KEY, // 605
      STONE_PLAQUE: I.STONE_PLAQUE, // 606
      TATTERED_SCROLL: I.TATTERED_SCROLL, // 607
      CRUMPLED_SCROLL: I.CRUMPLED_SCROLL, // 608
      RASHILIYIA_CORPSE: I.RASHILIYIA_CORPSE, // 609
      LOCATING_CRYSTAL: I.LOCATING_CRYSTAL, // 611
      LOCATING_CRYSTALS: [
        I.LOCATING_CRYSTAL, I.LOCATING_CRYSTAL_2, I.LOCATING_CRYSTAL_3, I.LOCATING_CRYSTAL_4, I.LOCATING_CRYSTAL_5,
      ], // 611-615
      BEADS_OF_THE_DEAD: I.BEADS_OF_THE_DEAD, // 616
      BONE_BEADS: I.BONE_BEADS, // 618
      SWORD_POMMEL: I.SWORD_POMMEL, // 623
      BERVIRIUS_NOTES: I.BERVIRIUS_NOTES, // 624
      BERVIRIUS_NOTES_2: I.BERVIRIUS_NOTES_2,
      BRONZE_WIRE: I.BRONZE_WIRE, // 1794
      CHISEL: I.CHISEL, // 1755
      COINS: I.COINS, // 995
      SPADE: I.SPADE, // 952
      ROPE: I.ROPE, // 954
      BONES: I.BONES, // 526
      BLACK_PRISM: I.BLACK_PRISM,
      LIT_CANDLE: I.LIT_CANDLE,
      LIT_BLACK_CANDLE: I.LIT_BLACK_CANDLE,
      LIT_TORCH: I.LIT_TORCH, // 594
    }),

    LOC: Object.freeze({
      BROKEN_CART: 2216, // multiloc on varp 116: 28930 (Look-at, Search) for 0-14, 28931 (Climb over) from 15
      VILLAGE_GATE: [2259, 2260], // zqshilogateclosedl/r, "Metal gate"
      INNER_GATE: [2261, 2262], // zqwoodengateclosed_l/r, "Wooden gate"
      INNER_GATE_OPEN: [2263, 2264],
      INVISWALL: 38848,
      METAL_GATE_OPEN_L: 1573, // inacmetalgateopenl
      METAL_GATE_OPEN_R: 1574, // inacmetalgateopenr
      MOUND_OF_EARTH: O.MOUND_OF_EARTH, // 2217
      FISSURE: O.FISSURE, // 2218
      ROPE_FISSURE: O.FISSURE_2, // 2219
      CAVE_IN: O.CAVE_IN, // 2220
      STRANGE_LOOKING_STONE: O.STRANGE_LOOKING_STONE, // 2221
      LOOSE_ROCKS: O.LOOSE_ROCKS, // 2222
      OLD_SACKS: O.OLD_SACKS, // 2223
      ANCIENT_GALLOWS: O.ANCIENT_GALLOWS, // 2224
      WATERFALL_ROCKS: O.WATERFALL_ROCKS_2, // 2225
      SMASHED_TABLE: O.SMASHED_TABLE, // 2226
      WELL_STACKED_ROCKS: O.WELL_STACKED_ROCKS, // 2234
      BERVIRIUS_DOLMEN: O.TOMB_DOLMEN, // 2235
      CLIMBING_ROCKS: O.CLIMBING_ROCKS, // 2236 (10851 is the Agility Pyramid's top)
      PALM_TREE: O.PALM_TREE, // 2237
      CARVED_DOORS: [O.CARVED_DOORS, O.CARVED_DOORS_2], // 2240, 2241
      TOMB_EXITS: [O.TOMB_EXIT, O.TOMB_EXIT_2, O.TOMB_EXIT_3, O.TOMB_EXIT_4], // 2242, 2243, 2253, 2254
      TOMB_DOORS: [O.TOMB_DOORS, O.TOMB_DOORS_2, O.TOMB_DOORS_3, O.TOMB_DOORS_4, O.TOMB_DOORS_5], // 2246-2250
      TOMB_DOORS_OPEN: [2251, 2252],
      ANCIENT_GATES: [O.ANCIENT_METAL_GATE, O.ANCIENT_METAL_GATE_2], // 2255, 2256
      TOMB_ROCKS: O.ROCKS_3, // 2257
      RASHILIYIA_DOLMEN: O.TOMB_DOLMEN_2, // 2258
      HIDDEN_TOMB_DOORS: [34657, 34673], // multilocs on varbit 8180: plants, carved doors, hillside entrance
    }),

    /** zqdoor_multi: 0 jungle plants, 1 carved doors, 2 hillside entrance (t3972, t4022). */
    VARBIT_TOMB_DOORS: 8180,
    TOMB_DOORS_HIDDEN: 0,
    TOMB_DOORS_CLOSED: 1,
    TOMB_DOORS_OPEN: 2,

    /**
     * The saved crafting/door/Nazastarool progress, "quest.shilo_village.mechanisms":
     * bit 0 read crumpled scroll, bit 1 found the bone lock, bit 2 table wood used, bit 3 searched
     * the palm trees, bit 4 "Don't warn me again" at the cart, bit 5 read the tattered scroll, bit 6
     * took Zadimus' corpse from the gallows (both for the journal), bits 7-8 bones placed, bits 9-11
     * Nazastarool form defeated.
     */
    MECH_ATTRIBUTE: "quest.shilo_village.mechanisms",
    MECH: Object.freeze({
      READ_CRUMPLED: 1 << 0,
      FOUND_BONE_DOOR: 1 << 1,
      USED_TABLE_WOOD: 1 << 2,
      SEARCHED_PALM: 1 << 3,
      CART_NO_WARNING: 1 << 4,
      READ_TATTERED: 1 << 5,
      FOUND_CORPSE: 1 << 6,
      DEFEATED_1: 1 << 9,
      DEFEATED_2: 1 << 10,
      DEFEATED_3: 1 << 11,
    }),
    BONES_SHIFT: 7,
    BONES_MASK: 0x3,

    held(player, itemId, amount = 1) {
      return player.getInventory().getAmount(itemId) >= amount;
    },
    give(player, itemId, amount = 1) {
      return player.getInventory().adds(itemId, amount);
    },
    take(player, itemId, amount = 1) {
      return player.getInventory().deleteNumber(itemId, amount);
    },
    /** Swaps the first `from` item in the inventory for `to` in the same slot (the corpse becomes the shard). */
    swapInSlot(player, from, to) {
      const inventory = player.getInventory();
      const slot = inventory.getItems().findIndex((item) => item?.getId?.() === from);
      if (slot < 0) return sv.give(player, to);
      inventory.setItem(slot, new api.core.Item(to, 1));
      inventory.refreshItems?.();
      return true;
    },
    level(player, skill) {
      return player.getSkillManager().getCurrentLevel(skill);
    },
    craftingLevel: (player) => sv.level(player, Skill.CRAFTING),
    agilityLevel: (player) => sv.level(player, Skill.AGILITY),
    hpLevel: (player) => sv.level(player, Skill.HITPOINTS),

    freeSlots(player) {
      const inventory = player.getInventory();
      if (typeof inventory.getFreeSlots === "function") return inventory.getFreeSlots();
      return inventory.isFull() ? 0 : 28;
    },

    mech(player) {
      return Number(player.getAttribute(sv.MECH_ATTRIBUTE)) || 0;
    },
    mechTest(player, bit) {
      return (sv.mech(player) & bit) !== 0;
    },
    mechSet(player, bit, on) {
      const value = sv.mech(player);
      player.setAttribute(sv.MECH_ATTRIBUTE, on ? value | bit : value & ~bit);
    },
    bonesPlaced(player) {
      return (sv.mech(player) >> sv.BONES_SHIFT) & sv.BONES_MASK;
    },
    setBonesPlaced(player, count) {
      const value = sv.mech(player);
      player.setAttribute(sv.MECH_ATTRIBUTE,
        (value & ~(sv.BONES_MASK << sv.BONES_SHIFT)) | ((count & sv.BONES_MASK) << sv.BONES_SHIFT));
    },

    stage(player) {
      return sv.quest.getStage(player);
    },
    complete(player) {
      return sv.quest.isComplete(player);
    },
    /** Raises the stage to `stage` (never lowers it, never past completion). */
    advance(player, stage) {
      if (sv.quest.isComplete(player) && stage <= sv.STAGE.COMPLETE) return;
      if (sv.quest.getStage(player) < stage) sv.quest.setStage(player, stage);
    },

    /** Plays a variant of the Shilo Village page (or `page`) with `npcId` as the speaker. */
    scene(player, npcId, variant, page = sv.PAGE) {
      return startTranscript(api, player, npcId, page, variant);
    },

    wearingBeads(player) {
      const item = player.getEquipment().get(Equipment.AMULET_SLOT);
      return item?.getId?.() === sv.ITEM.BEADS_OF_THE_DEAD;
    },

    teleport(player, [x, y, z = 0]) {
      player.moveTo(new Location(x, y, z));
    },

    at(player, x, y) {
      const here = player.getLocation();
      return here.getX() === x && here.getY() === y;
    },

    later(player, ticks, fn) {
      TaskManager.submit(new CountdownTask(player, ticks, fn));
    },

    /**
     * Opens a door or gate for everyone as live does: each closed leaf is replaced (an inviswall on the
     * doorway, the open leaves beside it), and `ticks` later the closed leaves come back. Leaves are
     * [id, x, y, z, rotation, shape = 0]. `remove` are open leaves with no closed leaf on their tile.
     */
    swingOpen({ closed, opened, ticks = 2, privateArea = null }) {
      const loc = ([id, x, y, z, face, shape = 0]) => new GameObject(id, new Location(x, y, z), shape, face, privateArea);
      for (const leaf of closed) ObjectManager.deregister(loc(leaf), true);
      for (const leaf of opened) ObjectManager.register(loc(leaf), true);
      const task = new api.core.Task(ticks, false);
      task.execute = () => {
        task.stop();
        for (const leaf of opened) ObjectManager.deregister(loc(leaf), true);
        for (const leaf of closed) ObjectManager.register(loc(leaf), true);
      };
      TaskManager.submit(task);
    },

    /**
     * A message box (229), or with `item` an object box (193) showing it, outside a transcript; `after`
     * runs once the player continues past it.
     */
    statement(player, text, after = null, item = null) {
      const { DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, ActionDialogue } = api.core;
      const chain = new DialogueChainBuilder();
      chain.add(item == null ? new StatementDialogue(0, text) : new ItemStatementDialogue(0, item, text));
      if (after) chain.add(new ActionDialogue(1, { execute: after }));
      player.getDialogueManager().startDialogues(chain);
    },
  };
  return sv;
};
