/**
 * Cabin Fever (members).
 *
 * The words come from the "Cabin Fever" transcript page (plus the "Bill Teach"
 * page's post-quest variants); this plugin supplies the variant selector for Bill
 * Teach and the enemy pirates, the prose-condition answers, the ship fixture
 * interactions (lockers, powder barrels, hull holes, plunder containers, plunder
 * storage), the cannon repair/load/fire state machine, the rope swing between the
 * Adventurous and the enemy ship, the sail/arrival teleports, the end cutscene and
 * the post-quest 10,000-coin claim.
 *
 * Stages (varp 655 "fever_quest"; the cache has no varbit on it): 1 started,
 * 2 sailed (cutscene), 3 taking out the enemy cannon, 4 repairing the hull,
 * 5 plundering ten loads, 6 replacing the cannon barrel, 7 firing at the crew,
 * 8 sinking the enemy ship, 9 complete. The durable stage stays 1-9; the wire
 * is mapped to the cache contract (varp 655 completes at DB table 0 column 19
 * value 140; CS2 script 4024 reads varp 655). The state the client does read
 * also lives in the real Cabin Fever varbits on varps 656/657/658, which this
 * plugin drives and persists (evidence: the
 * multi-loc transforms in CacheDefinitions + scripts/lookup-gameval.ts):
 *   1741 fever_cannon (0 empty, 1 exploded, 2 stripped, 3 armed; resolves loc
 *   11213 into Cannon/Broken Cannon variants), 1742 powder, 1743 tamp, 1744 ammo,
 *   1745 fuse, 1746 clean, 1749 fever_enemy_cannon (loc 11218), 1750
 *   fever_holes_in_the_hull (enemy hull 11224-11226), 1751/1757/1758
 *   fever_hole_1/2/3 (the three Adventurous holes 11221-11223), 1752
 *   fever_plunder_points (0-10 stored), 1753/1754/1755 fever_crate/chest/barrel
 *   (11227/11230/11233 -> full/empty), 1756 fever_gunpowder_barrel (11237),
 *   1759 fever_holes_patched, 1760 fever_holes_proofed, 1761/1762 fever_fuse_1/2
 *   (the fuse loc 11316 at 11241/11242), 1763 fever_given_book, 1765 fever_gold.
 *
 * Source: OSRS Wiki "Cabin Fever", its Quick guide and "Transcript:Cabin Fever";
 * object ids/placements from the cache (scripts/dump-loc.ts, ObjectIdentifiers,
 * CacheDefinitions multi-loc transforms).
 *
 * Gaps / approximations:
 *  - The ship battle area is static here, not instanced: sailing teleports to the
 *    battle map deck (1815,4837 plane 1), and the end cutscene teleports to Mos
 *    Le'Harmless (3665,2982) instead of playing scenes.
 *  - Climbing nets (11244/11310) are not in Ladders.plugin.js, so this plugin
 *    moves the player between deck and mast top on their Climb options.
 *  - The rope swing is the wiki's use-rope-on-hoisted-sail with a 42 Agility
 *    gate; a failed swing plays the fall variant and drains run energy, and the
 *    success lands on the other ship's deck directly rather than via a net.
 *  - Plunder containers respawn after 15 s (wiki: up to 5 minutes); logging out
 *    respawns them, which is honoured on the login bootstrap.
 *  - The fire roll uses the wiki's Ranged-scaled hit chance for both the canister
 *    and cannonball shots, so a miss has to be cleaned and reloaded.
 *  - Lighting the fuse always succeeds with a tinderbox (the "fuse refuses to
 *    light" variant is unreachable); a bullseye lantern is refused, per the wiki.
 *  - The dump's empty-store branch reads "You have plunder to deposit." (the wiki
 *    text is inverted); it is played verbatim.
 *  - The fever rope on the enemy deck (wiki/Quest Helper: pick it up at
 *    1822,4827) is laid out for the player when they swing over without a
 *    spare rope, instead of being a permanent floor item for everyone.
 *  - The mid-battle return-to-port branches (fade out, "enemy reappears") and the
 *    teleport-out messages are not wired; the pirate taunts, the post-quest lift
 *    teleports, the lost-Book replacement and the 10,000-coin claim are.
 *  - Cache Fever rope/tinderbox floor piles convert to ordinary items on pickup;
 *    the lockers provide the remaining quest supplies.
 *  - The five journal objectives are keyed off the canonical stage, and every
 *    state-changing action, object and item handler checks that stage (and the
 *    items the step consumes) before it can advance. A canister hit kills the
 *    pirate in front of the cannon; its death is what counts the crew hit.
 *  - The Book o' Piracy is granted once, readable, and replaceable from Bill
 *    Teach after the quest. Quest supplies are removed on completion and on the
 *    next login of an already-completed save, keeping rope, hammer, tinderbox and
 *    swamp paste.
 */
module.exports = function registerCabinFeverQuest(api) {
  const {
    CountdownTask,
    HitDamage,
    HitMask,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    TaskManager,
    World,
  } = api.core;
  const { openBook, registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const BOOK = require("../data/cabin-fever-book");

  const PAGE = "Cabin Fever";
  const BILL_PAGE = "Bill Teach";
  const PANDEMONIUM_KEY = "pandemonium";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const BILL_PUB = NpcIdentifiers.BILL_TEACH; // 4011, The Green Ghost
  const BILL_PUB_2 = NpcIdentifiers.BILL_TEACH_2; // 4012, unplaced duplicate
  const BILL_PORT_SHIP_ROW = 4013; // Adventurous spawn row (3713,3497 plane 1); cache definition has no name/actions
  const BILL_SHIP = NpcIdentifiers.BILL_TEACH_3; // 4014, the battle ship
  const BILL_PORT_SHIP = BILL_SHIP; // the port row is respawned as 4014 at startup, so Talk-to exists
  const BILL_MOS_INN = NpcIdentifiers.BILL_TEACH_4; // 4015, The Other Inn, Mos Le'Harmless
  const BILL_MOS_SHIP = NpcIdentifiers.BILL_TEACH_5; // 4016, Mos Le'Harmless ship
  const BILL_NPC_IDS = new Set([
    BILL_PUB,
    BILL_PUB_2,
    BILL_PORT_SHIP_ROW,
    BILL_SHIP,
    BILL_MOS_INN,
    BILL_MOS_SHIP,
  ]);
  const MAMA = NpcIdentifiers.MAMA; // 4020, The Other Inn
  const MAMA_2 = NpcIdentifiers.MAMA_2; // 4021
  const MAMA_NPC_IDS = new Set([MAMA, MAMA_2]);
  const CF_PIRATE_BASE = 4043; // 4043-4052 are the battle ship pirates
  const CF_PIRATE_NPC_IDS = new Set(
    Array.from({ length: 10 }, (_, index) => CF_PIRATE_BASE + index)
  );
  const PIRATE_VARIANTS = Array.from(
    { length: 8 },
    (_, index) => `dealing-with-the-cannon-talking-to-enemy-pirates-pirate-${index + 1}`
  );

  const GANGPLANK_DOCK = ObjectIdentifiers.GANGPLANK_19; // 11209, Cross
  const ADVENTUROUS_CANNON = 11213; // multi-loc: 11214/11215/11216/11217 by varbit 1741
  const ENEMY_CRATE = 11227; // -> 11228 full / 11229 empty, Loot
  const ENEMY_CHEST = 11230; // -> 11231 closed / 11232 open, Plunder
  const ENEMY_BARREL = 11233; // -> 11234/11235, Ransack
  const PLUNDER_STORAGE = ObjectIdentifiers.PLUNDER_STORAGE; // 11236
  const ENEMY_POWDER_BARREL = 11237; // -> 11238/11239/11315 by varbit 1756
  const FUSE_OBJECT_IDS = new Set([11241, 11242]); // 11316 appears when lit/attached
  const POWDER_BARREL = ObjectIdentifiers.POWDER_BARREL_2; // 11245, Take-powder
  const REPAIR_LOCKER = ObjectIdentifiers.REPAIR_LOCKER; // 11246, Open
  const GUN_LOCKER = ObjectIdentifiers.GUN_LOCKER; // 11248, Open
  const CLIMBING_NET_UP = ObjectIdentifiers.CLIMBING_NET_2; // 11310, deck "Climb"
  const CLIMBING_NET_DOWN = ObjectIdentifiers.CLIMBING_NET; // 11244, mast top "Climb-down"
  const SAIL_OBJECT_IDS = new Set([
    ObjectIdentifiers.SAIL_9, // 11280
    ObjectIdentifiers.SAIL_10, // 11281
    ObjectIdentifiers.SAIL_11, // 11282
    ObjectIdentifiers.SAIL_12, // 11283
    ObjectIdentifiers.HOISTED_SAIL_7, // 11292
    ObjectIdentifiers.HOISTED_SAIL_8, // 11293
    ObjectIdentifiers.HOISTED_SAIL_9, // 11294
    ObjectIdentifiers.HOISTED_SAIL_10, // 11297
    ObjectIdentifiers.HOISTED_SAIL_11, // 11298
    ObjectIdentifiers.HOISTED_SAIL_12, // 11299
    ObjectIdentifiers.HOISTED_SAIL_13, // 11300
    ObjectIdentifiers.HOISTED_SAIL_14, // 11301
    ObjectIdentifiers.HOISTED_SAIL_15, // 11303
    ObjectIdentifiers.HOISTED_SAIL_16, // 11304
  ]);

  const FUSE = ItemIdentifiers.FUSE; // 7109
  const GUNPOWDER = ItemIdentifiers.GUNPOWDER; // 7108
  const CANISTER = ItemIdentifiers.CANISTER; // 7118
  const CF_CANNON_BALL = ItemIdentifiers.CANNON_BALL_2; // 7119
  const RAMROD = ItemIdentifiers.RAMROD; // 7120
  const REPAIR_PLANK = ItemIdentifiers.REPAIR_PLANK; // 7121
  const REPAIR_PLANK_ALT = ItemIdentifiers.REPAIR_PLANK_2; // 7148
  const PLUNDER = ItemIdentifiers.PLUNDER; // 7143
  const BOOK_O_PIRACY = ItemIdentifiers.BOOK_O_PIRACY; // 7144
  const CANNON_BARREL = ItemIdentifiers.CANNON_BARREL; // 7145
  const TACKS = ItemIdentifiers.TACKS; // 7150
  const CF_ROPE = ItemIdentifiers.ROPE_5; // 7155
  const CF_TINDERBOX = ItemIdentifiers.TINDERBOX_3; // 7156
  const SWAMP_PASTE = ItemIdentifiers.SWAMP_PASTE; // 1941
  const HAMMER = ItemIdentifiers.HAMMER; // 2347
  const TINDERBOX = ItemIdentifiers.TINDERBOX; // 590
  const ROPE = ItemIdentifiers.ROPE; // 954
  const STEEL_CANNONBALL = ItemIdentifiers.STEEL_CANNONBALL; // 2, "far too big"
  const COINS = ItemIdentifiers.COINS; // 995

  const REPAIR_PLANKS = new Set([REPAIR_PLANK, REPAIR_PLANK_ALT]);
  const CANNON_ITEMS = new Set([
    CANNON_BARREL,
    GUNPOWDER,
    RAMROD,
    CANISTER,
    CF_CANNON_BALL,
    STEEL_CANNONBALL,
    FUSE,
  ]);
  const SWING_ROPES = new Set([CF_ROPE, ROPE]);
  const TINDERBOXES = new Set([TINDERBOX, 591, CF_TINDERBOX, 2946]);
  const BULLSEYE_LANTERNS = new Set([4548, 4549, 4550]);

  const VARP_CABIN_FEVER = 655;
  const VARP_CANNON_VAR = 656;
  const VARP_EXTRA_VAR = 657;
  const VARP_STORAGE_VAR = 658;

  const VARBIT_CANNON = 1741; // fever_cannon
  const VARBIT_CANNON_POWDER = 1742;
  const VARBIT_CANNON_TAMP = 1743;
  const VARBIT_CANNON_AMMO = 1744;
  const VARBIT_CANNON_FUSE = 1745;
  const VARBIT_CANNON_CLEAN = 1746;
  const VARBIT_ENEMY_CANNON = 1749; // fever_enemy_cannon
  const VARBIT_HULL_HOLES = 1750; // fever_holes_in_the_hull
  const VARBIT_HOLE_1 = 1751;
  const VARBIT_PLUNDER = 1752; // fever_plunder_points
  const VARBIT_CRATE = 1753;
  const VARBIT_CHEST = 1754;
  const VARBIT_BARREL = 1755;
  const VARBIT_GUNPOWDER_BARREL = 1756;
  const VARBIT_HOLE_2 = 1757;
  const VARBIT_HOLE_3 = 1758;
  const VARBIT_HOLES_PATCHED = 1759;
  const VARBIT_HOLES_PROOFED = 1760;
  const VARBIT_FUSE_1 = 1761;
  const VARBIT_FUSE_2 = 1762;
  const VARBIT_GIVEN_BOOK = 1763;
  const VARBIT_GOLD = 1765;

  const HOLE_VARBIT_BY_OBJECT = new Map([
    [11221, VARBIT_HOLE_1],
    [11222, VARBIT_HOLE_2],
    [11223, VARBIT_HOLE_3],
  ]);

  // Varbit fever_cannon: 0 empty, 1 exploded, 2 stripped, 3 armed (Fire!).
  const CANNON_EMPTY = 0;
  const CANNON_EXPLODED = 1;
  const CANNON_STRIPPED = 2;
  const CANNON_ARMED = 3;
  // Cache transform/Quest Helper values: 1 is a cannonball, 2 is a canister.
  const CANNON_AMMO_CANISTER = 2;
  const CANNON_AMMO_BALL = 1;

  const STAGE_STARTED = 1;
  const STAGE_SAILING = 2;
  const STAGE_CANNON = 3;
  const STAGE_LEAKS = 4;
  const STAGE_PLUNDER = 5;
  const STAGE_FIX_CANNON = 6;
  const STAGE_FIRE = 7;
  const STAGE_SINK = 8;
  const STAGE_COMPLETE = 9;

  // The five journal objectives, in the only order the stages allow. `at` is the
  // stage on which the objective is complete; the journal strikes it through.
  const OBJECTIVES = [
    { at: STAGE_LEAKS, text: "Take rope and a fuse below deck and destroy the enemy cannon." },
    { at: STAGE_PLUNDER, text: "Repair the three holes in the Adventurous' hull." },
    { at: STAGE_FIX_CANNON, text: "Steal ten loads of plunder from the enemy ship." },
    { at: STAGE_SINK, text: "Hit the enemy pirates with canister shot." },
    { at: STAGE_COMPLETE, text: "Sink the enemy ship with three cannonball hits." },
  ];

  // The canister round kills the level 57 pirate it hits (52 hitpoints).
  const CANISTER_DAMAGE = 52;
  const ENEMY_SHIP_BOUNDS = { minX: 1819, maxX: 1827, minY: 4824, maxY: 4843 };

  // Cache DB (table 0, column 19) completes Cabin Fever at varp 655 value 140.
  // Internal stages stay 0-9; this is the durable stage -> wire mapping.
  const WIRE_COMPLETE = 140;
  const WIRE_STAGE_VALUES = new Map([
    [0, 0],
    [STAGE_STARTED, 10],
    [STAGE_SAILING, 20],
    [STAGE_CANNON, 30],
    [STAGE_LEAKS, 50],
    [STAGE_PLUNDER, 70],
    [STAGE_FIX_CANNON, 90],
    [STAGE_FIRE, 110],
    [STAGE_SINK, 130],
    [STAGE_COMPLETE, WIRE_COMPLETE],
  ]);

  function wireStageValue(stage) {
    const value = WIRE_STAGE_VALUES.get(stage | 0);
    if (value !== undefined) return value;
    return (stage | 0) >= STAGE_COMPLETE ? WIRE_COMPLETE : 0;
  }

  const FLAGS_ATTRIBUTE = "quest.cabin_fever.flags";
  const CREW_HITS_ATTRIBUTE = "cabin-fever:crew-hits";
  const VARP_CANNON_ATTRIBUTE = "quest.cabin_fever.var656";
  const VARP_EXTRA_ATTRIBUTE = "quest.cabin_fever.var657";
  const VARP_STORAGE_ATTRIBUTE = "quest.cabin_fever.var658";
  const FLAG_SHIP_TALKED = 1 << 0;
  const CREW_HITS_REQUIRED = 3;

  const ARRIVE_ACTION_ID = "cabin-fever:arrive";
  // How long a looted plunder container stays empty (wiki: up to 5 minutes).
  const PLUNDER_RESPAWN_TICKS = 25;
  const PIRATE_AGILITY = 42;

  // The port-ship spawn row lives at 3713,3497 plane 1; NPCs are spawned when
  // a player enters their region, not at server startup.
  const PORT_SHIP_REGION = (58 << 8) | 54;
  const PORT_SHIP_REGION_KEY = "1:58:54";
  const BATTLE_DECK = new Location(1815, 4837, 1); // beside Bill on the Adventurous
  const ENEMY_DECK = new Location(1823, 4836, 1); // beside the enemy powder barrel
  const MOS_LE_HARMLESS = new Location(3665, 2982, 0); // The Other Inn
  const PORT_PHASMATYS = new Location(3679, 3494, 0); // outside The Green Ghost
  const WEST_YARDARM = new Location(1816, 4830, 2);
  const EAST_YARDARM = new Location(1823, 4835, 2);
  const WEST_NET_LANDING = new Location(1817, 4831, 1);
  const EAST_NET_LANDING = new Location(1824, 4834, 1);
  // The fever rope lying on the enemy deck (wiki/Quest Helper: pick it up here).
  const ENEMY_ROPE_TILE = { x: 1822, y: 4827, z: 1 };
  const HOLD_TINDERBOX_TILE = { x: 1814, y: 4825, z: 0 };

  const PLUNDER_SOURCES = new Map([
    [ENEMY_CHEST, { varbit: VARBIT_CHEST, amount: 3, variant: "time-to-plunder-plundering-the-chest" }],
    [ENEMY_CRATE, { varbit: VARBIT_CRATE, amount: 2, variant: "time-to-plunder-looting-the-crate" }],
    [ENEMY_BARREL, { varbit: VARBIT_BARREL, amount: 1, variant: "time-to-plunder-ransacking-the-barrel" }],
  ]);

  /** Transient per-conversation results (never persisted). */
  const plunderOutcome = new WeakMap();
  const fireOutcome = new WeakMap();
  const lootedAt = new WeakMap();
  /** Pirate -> the player whose canister round is about to kill it. */
  const cannonTargets = new WeakMap();
  let lastPortShipBillCheck = -100;

  let quest;

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  /** The clicked option, from the resolved definition (case-insensitive). */
  function optionOf(event) {
    return String(
      event.option ??
        event.definition?.getInteractions?.()?.[event.clickType - 1] ??
        event.definition?.getActions?.()?.[event.clickType - 1] ??
        ""
    ).toLowerCase();
  }

  function varbitValue(player, varbitId) {
    return player.getPacketSender().getVarbit(varbitId);
  }

  function saveVarps(player) {
    const sender = player.getPacketSender();
    player.setAttribute(VARP_CANNON_ATTRIBUTE, sender.getVarp(VARP_CANNON_VAR));
    player.setAttribute(VARP_EXTRA_ATTRIBUTE, sender.getVarp(VARP_EXTRA_VAR));
    player.setAttribute(VARP_STORAGE_ATTRIBUTE, sender.getVarp(VARP_STORAGE_VAR));
  }

  function setVarbitValue(player, varbitId, value) {
    player.getPacketSender().sendVarbit(varbitId, value | 0);
    saveVarps(player);
  }

  /**
   * Erases the persisted Cabin Fever state. Every gameplay varbit (1741-1765)
   * lives inside varps 656/657/658, so zeroing those three configs resets the
   * hull, cannon, plunder and fuse states the client renders.
   */
  function resetQuestState(player) {
    const sender = player.getPacketSender();
    sender.sendConfig(VARP_CANNON_VAR, 0);
    sender.sendConfig(VARP_EXTRA_VAR, 0);
    sender.sendConfig(VARP_STORAGE_VAR, 0);
    player.setAttribute(FLAGS_ATTRIBUTE, 0);
    player.setAttribute(CREW_HITS_ATTRIBUTE, 0);
    player.setAttribute(VARP_CANNON_ATTRIBUTE, 0);
    player.setAttribute(VARP_EXTRA_ATTRIBUTE, 0);
    player.setAttribute(VARP_STORAGE_ATTRIBUTE, 0);
    plunderOutcome.delete(player);
    fireOutcome.delete(player);
    lootedAt.delete(player);
  }

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, flag) {
    return (flags(player) & flag) !== 0;
  }

  function setFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | flag);
  }

  function crewHits(player) {
    return Number(player.getAttribute(CREW_HITS_ATTRIBUTE)) || 0;
  }

  function setCrewHits(player, value) {
    player.setAttribute(CREW_HITS_ATTRIBUTE, Math.max(0, value | 0));
  }

  function giveSupply(player, itemId, amount) {
    const have = player.getInventory().getAmount(itemId);
    if (have >= amount) return false;
    player.getInventory().adds(itemId, amount - have);
    return true;
  }

  /** The Book o' Piracy is a kept reward: grant it once, never stack copies. */
  function giveBookOfPiracy(player) {
    if (held(player, BOOK_O_PIRACY)) return false;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) {
      inventory.forceAdd?.(player, new Item(BOOK_O_PIRACY, 1));
      return true;
    }
    inventory.adds(BOOK_O_PIRACY, 1);
    return true;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.AGILITY) >= 42 &&
      skills.getMaxLevel(Skill.CRAFTING) >= 45 &&
      skills.getMaxLevel(Skill.SMITHING) >= 50 &&
      skills.getMaxLevel(Skill.RANGED) >= 40 &&
      questComplete(player, "pirates_treasure") &&
      questComplete(player, "rum_deal") &&
      questComplete(player, "priest_in_peril")
    );
  }

  function isAtPortPhasmatys(player) {
    return (player.getLocation()?.getY?.() ?? 0) > 3200;
  }

  /** Runs `action` once the player's chatbox is clear (a menu still owns it). */
  function whenIdle(player, action) {
    if (!TaskManager || !CountdownTask) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 2, () => {
        if (player.isRegistered?.() === false) return;
        const chatting =
          player.getDialogueManager?.()?.isActive?.() === true ||
          api.core.MultiChatboxPrompt?.getPending?.(player) != null;
        if (chatting) {
          whenIdle(player, action);
          return;
        }
        action();
      })
    );
  }

  /** Plays a wiki variant from the Cabin Fever page (object/state driven). */
  function playVariant(player, variant) {
    startTranscript(api, player, BILL_SHIP, PAGE, variant);
  }

  function holesFixed(player) {
    return (
      varbitValue(player, VARBIT_HOLE_1) >= 2 &&
      varbitValue(player, VARBIT_HOLE_2) >= 2 &&
      varbitValue(player, VARBIT_HOLE_3) >= 2
    );
  }

  function syncHoleCounters(player) {
    const values = [VARBIT_HOLE_1, VARBIT_HOLE_2, VARBIT_HOLE_3].map((id) =>
      varbitValue(player, id)
    );
    setVarbitValue(player, VARBIT_HOLES_PATCHED, values.filter((value) => value >= 1).length);
    setVarbitValue(player, VARBIT_HOLES_PROOFED, values.filter((value) => value >= 2).length);
  }

  function rangedHitChance(player) {
    const level = player.getSkillManager().getMaxLevel(Skill.RANGED);
    // Jagex: 6% at level 1, 94% at 99 (wiki "Cabin Fever", success chance).
    return Math.min(0.94, Math.max(0.06, 0.06 + ((level - 1) * (0.94 - 0.06)) / 98));
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function pirateVariant(npcId, player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CANNON || stage >= STAGE_COMPLETE) return null;
    return PIRATE_VARIANTS[(npcId - CF_PIRATE_BASE) % PIRATE_VARIANTS.length];
  }

  function billVariant(npcId, player) {
    const stage = quest.getStage(player);
    if (npcId === BILL_PUB || npcId === BILL_PUB_2) {
      if (stage >= STAGE_COMPLETE) {
        return "standard-dialogue-after-completing-cabin-fever-inside-the-green-ghost";
      }
      if (stage >= STAGE_STARTED) return "speaking-to-bill-teach-again-at-the-pub";
      return "starting-the-quest";
    }
    if (stage >= STAGE_COMPLETE) {
      if (varbitValue(player, VARBIT_GOLD) === 0) {
        return "end-of-quest-cutscene-claiming-the-loot-from-bill-teach-after-the-quest";
      }
      return "standard-dialogue-after-completing-cabin-fever-on-board-the-adventurous";
    }
    switch (stage) {
      case STAGE_CANNON:
        if (varbitValue(player, VARBIT_ENEMY_CANNON) !== 0) {
          quest.setStage(player, STAGE_LEAKS);
          return "sort-out-the-leaks";
        }
        return "dealing-with-the-cannon-talking-to-bill-teach-on-the-deck";
      case STAGE_LEAKS:
        if (holesFixed(player)) {
          quest.setStage(player, STAGE_PLUNDER);
          return "sort-out-the-leaks-after-all-the-holes-have-been-fixed";
        }
        return "sort-out-the-leaks-talking-to-bill-teach-again-before-patching-the-leaks";
      case STAGE_PLUNDER:
        if (varbitValue(player, VARBIT_PLUNDER) >= 10) {
          quest.setStage(player, STAGE_FIX_CANNON);
          return "fixing-up-the-cannon";
        }
        return "time-to-plunder-talking-to-bill-teach-before-plundering";
      case STAGE_FIX_CANNON:
        if (varbitValue(player, VARBIT_CANNON) === CANNON_EMPTY) {
          quest.setStage(player, STAGE_FIRE);
          return "fixing-up-the-cannon-talking-to-bill-teach-after-replacing-the-barrel";
        }
        return "fixing-up-the-cannon-talking-to-bill-teach-before-fixing-the-cannon";
      case STAGE_FIRE:
        if (crewHits(player) >= CREW_HITS_REQUIRED) {
          quest.setStage(player, STAGE_SINK);
          return "sinking-the-enemy-ship";
        }
        return "talking-to-bill-teach-again-before-firing-the-cannon";
      case STAGE_SINK:
        return "sinking-the-enemy-ship-talking-to-bill-teach-before-sinking-the-enemy-ship";
      default:
        return null;
    }
  }

  function selectVariant(event) {
    const { npcId, player } = event;
    if (!player) return null;
    if (CF_PIRATE_NPC_IDS.has(npcId)) return pirateVariant(npcId, player);
    if (!BILL_NPC_IDS.has(npcId)) return null;
    return billVariant(npcId, player);
  }

  /** The enemy pirates speak only while the sabotage/plunder chain is live. */
  function talkToPirate(event) {
    const { player, npcId } = event;
    if (!player || !CF_PIRATE_NPC_IDS.has(npcId)) return false;
    const variant = pirateVariant(npcId, player);
    if (!variant || !startTranscript(api, player, npcId, PAGE, variant)) return false;
    event.handled = true;
    return true;
  }

  /** Mama's inn dialogue changes once Bill has given the player the book. */
  function talkToMama(event) {
    const { player, npcId } = event;
    if (!player || !MAMA_NPC_IDS.has(npcId)) return false;
    const variant = held(player, BOOK_O_PIRACY)
      ? "standard-dialogue-with-book-o-piracy"
      : "standard-dialogue-without-book-o-piracy";
    if (!startTranscript(api, player, npcId, "Mama", variant)) return false;
    event.handled = true;
    return true;
  }

  function readBookOfPiracy(event) {
    const { player, itemId } = event;
    if (!player || itemId !== BOOK_O_PIRACY || !held(player, BOOK_O_PIRACY)) return false;
    openBook(player, BOOK.title, BOOK.pages);
    event.handled = true;
    return true;
  }

  function inEnemyShipBounds(npc) {
    const location = npc?.getLocation?.();
    if (!location) return false;
    const x = location.getX?.() ?? location.x;
    const y = location.getY?.() ?? location.y;
    const z = location.getZ?.() ?? location.z;
    return (
      (z === 0 || z === 1) &&
      x >= ENEMY_SHIP_BOUNDS.minX &&
      x <= ENEMY_SHIP_BOUNDS.maxX &&
      y >= ENEMY_SHIP_BOUNDS.minY &&
      y <= ENEMY_SHIP_BOUNDS.maxY
    );
  }

  /** A living Cabin Fever pirate in front of the cannon. */
  function canisterTarget(player) {
    const npcs = World.getNpcs?.() ?? [];
    for (const npc of npcs) {
      if (!npc || cannonTargets.has(npc)) continue;
      const id = npc.getId?.();
      if (!CF_PIRATE_NPC_IDS.has(id)) continue;
      if (npc.isRegistered?.() === false) continue;
      if ((npc.getHitpoints?.() ?? 0) <= 0) continue;
      if (!inEnemyShipBounds(npc)) continue;
      return npc;
    }
    return null;
  }

  /**
   * A canister hit kills the pirate it catches. The 52-damage hit is resolved by
   * the NPC death task, which calls handleNpcDeath and records the crew hit.
   * Returns false when no pirate is lined up (the wiki's rat still counts, so
   * the caller records the hit directly in that case).
   */
  function hitPirateWithCanister(player) {
    const target = canisterTarget(player);
    if (!target) return false;
    cannonTargets.set(target, player);
    const combat = target.getCombat?.();
    // Attribute the kill to the player, so the NPC death task emits onNpcDeath.
    combat?.addDamage?.(player, CANISTER_DAMAGE);
    combat?.getHitQueue?.().addPendingDamage?.([
      new HitDamage(CANISTER_DAMAGE, HitMask.RED).setSource(player),
    ]);
    return true;
  }

  function handleNpcDeath(event) {
    const { npc } = event;
    if (!npc) return;
    const shooter = cannonTargets.get(npc);
    if (!shooter) return;
    cannonTargets.delete(npc);
    if (quest.getStage(shooter) !== STAGE_FIRE) return;
    setCrewHits(shooter, crewHits(shooter) + 1);
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!player) return null;
    switch (stepId) {
      case "tOUrYm":
        return !meetsRequirements(player);
      case "sI29_K":
        return questComplete(player, PANDEMONIUM_KEY);
      case "nYB5Ct":
      case "i_o3EW":
      case "nv5rAi":
        return plunderOutcome.get(player) === "recently";
      case "P2hlqW":
        return player.getInventory().getAmount(PLUNDER) === 0;
      case "lmQHxO":
        return varbitValue(player, VARBIT_PLUNDER) >= 10;
      case "bstDB6":
        return held(player, PLUNDER);
      case "w1Zyh9":
        return varbitValue(player, VARBIT_CANNON_CLEAN) === 0;
      case "_NOmCU":
        return varbitValue(player, VARBIT_CANNON_POWDER) === 1;
      case "67EEol":
        return (
          varbitValue(player, VARBIT_CANNON_POWDER) === 1 &&
          varbitValue(player, VARBIT_CANNON_TAMP) === 0
        );
      case "KdivQ3":
        return varbitValue(player, VARBIT_CANNON_AMMO) !== 0;
      case "yB3kDW":
        return (
          varbitValue(player, VARBIT_CANNON_AMMO) !== 0 &&
          varbitValue(player, VARBIT_CANNON_POWDER) === 1 &&
          varbitValue(player, VARBIT_CANNON_TAMP) === 1
        );
      case "vxCacB":
        return (
          varbitValue(player, VARBIT_CANNON_AMMO) !== 0 &&
          !(
            varbitValue(player, VARBIT_CANNON_POWDER) === 1 &&
            varbitValue(player, VARBIT_CANNON_TAMP) === 1
          )
        );
      case "u0ykQP":
      case "OZhmZH":
        return fireOutcome.get(player) === "hit";
      case "6SgoXA":
      case "S_IaKw":
        return fireOutcome.get(player) === "miss";
      case "3Wo2Mp":
        return isAtPortPhasmatys(player);
      case "_N7OXw":
        return !isAtPortPhasmatys(player);
      case "hO36Ny":
        return !held(player, BOOK_O_PIRACY);
      default:
        return null;
    }
  }

  /** A chosen condition branch with a gameplay side effect. */
  function handleConditionChosen(event) {
    const { player, stepId } = event;
    if (!player || stepId !== "bstDB6") return;
    if (quest.getStage(player) !== STAGE_FIX_CANNON) return;
    const extra = player.getInventory().getAmount(PLUNDER);
    if (extra > 0) player.getInventory().deleteNumber(PLUNDER, extra);
  }

  // ==========================================================================
  // Bill Teach and the pirates
  // ==========================================================================

  function startShipTalk(player, npcId) {
    if (hasFlag(player, FLAG_SHIP_TALKED)) {
      startTranscript(
        api,
        player,
        npcId,
        PAGE,
        "speaking-to-bill-teach-on-the-ship-talking-to-bill-teach-again-before-setting-sail"
      );
      return;
    }
    setFlag(player, FLAG_SHIP_TALKED);
    startTranscript(api, player, npcId, PAGE, "speaking-to-bill-teach-on-the-ship");
  }

  /** The port-ship Bill, including the 4013 row that resolves to 4011. */
  function isPortShipBill(event) {
    if (event.npcId === BILL_PORT_SHIP) return true;
    if (event.npcId !== BILL_PUB && event.npcId !== BILL_PORT_SHIP_ROW) return false;
    const location = event.location ?? event.npc?.getLocation?.();
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    const z = location?.z ?? location?.getZ?.();
    return z === 1 && x >= 3708 && x <= 3720 && y >= 3488 && y <= 3508;
  }

  /**
   * Bill on the Adventurous at Port Phasmatys (4013) is not in the dialogue id
   * index, so NpcDialogues would fall back to his pre-quest page: play the
   * quest's ship variant here and claim the click.
   */
  function talkToBill(event) {
    const { player } = event;
    if (!BILL_NPC_IDS.has(event.npcId) || !isPortShipBill(event)) return false;
    const stage = quest.getStage(player);
    if (stage !== STAGE_STARTED && stage !== STAGE_SAILING) return false;
    startShipTalk(player, BILL_SHIP);
    return true;
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || !BILL_NPC_IDS.has(npcId)) return;
    if (
      option === "Yes, I am a man of my word." ||
      option === "Yes, I am a woman of my word."
    ) {
      if (quest.getStage(player) === 0 && meetsRequirements(player)) {
        quest.setStage(player, STAGE_STARTED);
      }
      return;
    }
    if (option === "Let's go Cap'n!") {
      const stage = quest.getStage(player);
      if (stage === STAGE_STARTED || stage === STAGE_SAILING) sail(player);
    }
  }

  function sail(player) {
    quest.setStage(player, STAGE_SAILING);
    whenIdle(player, () => {
      startTranscript(api, player, BILL_SHIP, PAGE, "cutscene-on-the-ship", (steps) => [
        ...steps,
        { type: "action", action: "cabin-fever:arrive", id: ARRIVE_ACTION_ID },
      ]);
    });
  }

  function arriveOnBattleShip(player) {
    if (quest.getStage(player) !== STAGE_SAILING) return;
    quest.setStage(player, STAGE_CANNON);
    // The cutscene destroys the cannon: transform 1 is the broken (exploded) form.
    setVarbitValue(player, VARBIT_CANNON, CANNON_EXPLODED);
    setVarbitValue(player, VARBIT_CANNON_CLEAN, 1);
    player.moveTo(BATTLE_DECK);
  }

  // ==========================================================================
  // Dialogue actions
  // ==========================================================================

  function blowUpEnemyCannon(player) {
    if (quest.getStage(player) !== STAGE_CANNON) return false;
    if (varbitValue(player, VARBIT_ENEMY_CANNON) !== 0) return false;
    if (varbitValue(player, VARBIT_FUSE_1) !== 1 || varbitValue(player, VARBIT_FUSE_2) !== 1) {
      return false;
    }
    setVarbitValue(player, VARBIT_GUNPOWDER_BARREL, 1);
    setVarbitValue(player, VARBIT_ENEMY_CANNON, 1);
    setVarbitValue(player, VARBIT_FUSE_1, 0);
    setVarbitValue(player, VARBIT_FUSE_2, 0);
    return true;
  }

  function finishQuest(player) {
    if (quest.getStage(player) !== STAGE_SINK) return false;
    if (varbitValue(player, VARBIT_HULL_HOLES) < 3) return false;
    if (!quest.isComplete(player)) quest.complete(player);
    setVarbitValue(player, VARBIT_GIVEN_BOOK, 1);
    player.moveTo(MOS_LE_HARMLESS);
    return true;
  }

  function claimGold(player) {
    if (!quest.isComplete(player)) return false;
    if (varbitValue(player, VARBIT_GOLD) !== 0) return false;
    const inventory = player.getInventory();
    const before = inventory.getAmount(COINS);
    inventory.adds(COINS, 10000);
    // The claim is once-only, so it is only consumed when the coins landed:
    // a full inventory without a coins stack makes the add fail silently.
    if (inventory.getAmount(COINS) - before < 10000) {
      player.sendMessage("You need a free inventory space for the coins.");
      return false;
    }
    setVarbitValue(player, VARBIT_GOLD, 1);
    return true;
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case ARRIVE_ACTION_ID:
        event.handled = true;
        arriveOnBattleShip(player);
        return;
      case "jL6Wr9": // the barrel blows up, taking out the cannon
        event.handled = true;
        blowUpEnemyCannon(player);
        return;
      case "KyzlKD": // finds 3 loads of plunder
      case "nB1f3U": // two loads
      case "VtGqie": // one load
      case "iPgikU": // the cannon is emptied
      case "dvv3hz":
      case "LK2o0B":
      case "ZKsa3t": // the enemy takes 52 damage
      case "ASsVuT": // damage and barrel destruction already applied
        event.handled = true;
        return;
      case "z_5d-M": // "You don't need [...] right now."
        event.handled = true;
        player.sendMessage("You don't need a Ramrod right now.");
        return;
      case "7Zv7QG": // end-game cutscene begins
        if (quest.getStage(player) !== STAGE_SINK) return;
        if (varbitValue(player, VARBIT_HULL_HOLES) < 3) return;
        event.handled = true;
        whenIdle(player, () =>
          startTranscript(api, player, BILL_SHIP, PAGE, "end-of-quest-cutscene")
        );
        return;
      case "V-4Bls": // Congratulations! Quest complete!
        event.handled = true;
        finishQuest(player);
        return;
      case "RMIMnr": // awarded 10,000 coins
        event.handled = true;
        claimGold(player);
        return;
      case "5mdRTN": // replacement Book o' Piracy
        if (!quest.isComplete(player) || held(player, BOOK_O_PIRACY)) return;
        event.handled = true;
        giveBookOfPiracy(player);
        return;
      case "ovllfq": // lift to Mos Le'Harmless
        if (!quest.isComplete(player)) return;
        event.handled = true;
        player.moveTo(MOS_LE_HARMLESS);
        return;
      case "fvjsNS": // lift to Port Phasmatys
        if (!quest.isComplete(player)) return;
        event.handled = true;
        player.moveTo(PORT_PHASMATYS);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // The gangplank before the quest
  // ==========================================================================

  function handleGangplankClaim(request) {
    if (!request?.player || request.objectId !== GANGPLANK_DOCK) return;
    if (quest.getStage(request.player) !== 0) return;
    request.handled = true;
    startTranscript(
      api,
      request.player,
      BILL_PUB,
      PAGE,
      "starting-the-quest-trying-to-board-the-adventurous-before-starting-the-quest"
    );
  }

  /** The gangplank refuses a player who has not started the quest. */
  function crossGangplank(event) {
    if (event.objectId !== GANGPLANK_DOCK) return false;
    if (quest.getStage(event.player) !== 0) return false;
    handleGangplankClaim(event);
    return event.handled === true;
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function openRepairLocker(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CANNON || stage >= STAGE_COMPLETE) return;
    giveSupply(player, ROPE, 4);
    giveSupply(player, HAMMER, 1);
    giveSupply(player, REPAIR_PLANK, 6);
    giveSupply(player, TACKS, 30);
    giveSupply(player, SWAMP_PASTE, 3);
  }

  function openGunLocker(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CANNON || stage >= STAGE_COMPLETE) return;
    const broken =
      varbitValue(player, VARBIT_CANNON) === CANNON_EXPLODED ||
      varbitValue(player, VARBIT_CANNON) === CANNON_STRIPPED;
    if (stage >= STAGE_FIX_CANNON && broken && !held(player, CANNON_BARREL)) {
      if (player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You need a free inventory space for the cannon barrel.");
        return;
      }
      player.getInventory().adds(CANNON_BARREL, 1);
      playVariant(player, "fixing-up-the-cannon-taking-a-new-barrel-from-the-gun-locker");
      return;
    }
    if (stage === STAGE_FIX_CANNON) {
      playVariant(
        player,
        "fixing-up-the-cannon-taking-a-new-barrel-from-the-gun-locker-attempting-to-take-other-items-from-the-gun-locker"
      );
      return;
    }
    if (stage === STAGE_CANNON) {
      giveSupply(player, FUSE, 4);
      return;
    }
    if (stage === STAGE_FIRE) {
      giveSupply(player, RAMROD, 1);
      giveSupply(player, CANISTER, 1);
      giveSupply(player, FUSE, 4);
      return;
    }
    if (stage === STAGE_SINK) {
      giveSupply(player, RAMROD, 1);
      giveSupply(player, CF_CANNON_BALL, 4);
      giveSupply(player, FUSE, 4);
    }
  }

  function takePowder(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CANNON || stage >= STAGE_COMPLETE) return;
    if (giveSupply(player, GUNPOWDER, 1)) {
      player.sendMessage("You take some gunpowder");
    }
  }

  function attachFuse(player) {
    if (quest.getStage(player) !== STAGE_CANNON) return false;
    if (varbitValue(player, VARBIT_ENEMY_CANNON) !== 0) return false;
    if (varbitValue(player, VARBIT_FUSE_1) === 1) return false;
    if (!held(player, FUSE)) return false;
    player.getInventory().deleteNumber(FUSE, 1);
    setVarbitValue(player, VARBIT_FUSE_1, 1);
    // Transform 2 is the barrel with the fuse attached; 1 is the explosion.
    setVarbitValue(player, VARBIT_GUNPOWDER_BARREL, 2);
    playVariant(player, "dealing-with-the-cannon-using-fuse-on-the-barrel");
    return true;
  }

  function lightFuse(player, itemId) {
    if (quest.getStage(player) !== STAGE_CANNON) return false;
    if (varbitValue(player, VARBIT_FUSE_1) !== 1) return false;
    if (varbitValue(player, VARBIT_FUSE_2) === 1) return false;
    if (!TINDERBOXES.has(itemId) && !BULLSEYE_LANTERNS.has(itemId)) return false;
    if (BULLSEYE_LANTERNS.has(itemId)) {
      playVariant(
        player,
        "dealing-with-the-cannon-using-fuse-on-the-barrel-attempting-to-light-the-fuse-using-a-bullseye-lantern"
      );
      return true;
    }
    setVarbitValue(player, VARBIT_FUSE_2, 1);
    playVariant(player, "dealing-with-the-cannon-the-fuse-is-lit");
    return true;
  }

  function lootPlunder(player, source) {
    if (quest.getStage(player) !== STAGE_PLUNDER) return false;
    const now = World.getProcessCycle();
    const timestamps = lootedAt.get(player) ?? {};
    const looted = varbitValue(player, source.varbit) === 1;
    if (looted && now - (timestamps[source.varbit] ?? -Infinity) < PLUNDER_RESPAWN_TICKS) {
      plunderOutcome.set(player, "recently");
      playVariant(player, source.variant);
      return false;
    }
    if (player.getInventory().getFreeSlots() < source.amount) {
      player.sendMessage("You do not have enough free inventory space for that.");
      return false;
    }
    if (looted) setVarbitValue(player, source.varbit, 0);
    setVarbitValue(player, source.varbit, 1);
    timestamps[source.varbit] = now;
    lootedAt.set(player, timestamps);
    player.getInventory().adds(PLUNDER, source.amount);
    plunderOutcome.set(player, "found");
    playVariant(player, source.variant);
    return true;
  }

  function storePlunder(player) {
    if (quest.getStage(player) !== STAGE_PLUNDER) return false;
    const carried = player.getInventory().getAmount(PLUNDER);
    const stored = varbitValue(player, VARBIT_PLUNDER);
    if (stored >= 10) {
      playVariant(
        player,
        "time-to-plunder-counting-the-plunder-in-the-storage-attempting-to-plunder-more-after-filling-up-the-storage"
      );
      return false;
    }
    if (carried === 0) {
      playVariant(player, "time-to-plunder-storing-the-loot-in-the-storage");
      return false;
    }
    const space = 10 - stored;
    const amount = Math.min(carried, space);
    player.getInventory().deleteNumber(PLUNDER, amount);
    setVarbitValue(player, VARBIT_PLUNDER, stored + amount);
    if (carried > space) {
      player.sendMessage("You deposit as much plunder as you can.");
      return true;
    }
    player.sendMessage(
      `You deposit ${amount} load${amount === 1 ? "" : "s"} of plunder in the chest.`
    );
    return true;
  }

  function countPlunder(player) {
    if (quest.getStage(player) < STAGE_PLUNDER) return false;
    const stored = varbitValue(player, VARBIT_PLUNDER);
    if (stored >= 10) {
      player.sendMessage("This chest is full of plunder.");
      return true;
    }
    player.sendMessage(`This chest has ${stored} loads of plunder inside.`);
    return true;
  }

  function repairCannon(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FIX_CANNON || stage >= STAGE_COMPLETE) return false;
    const state = varbitValue(player, VARBIT_CANNON);
    if (state !== CANNON_EXPLODED && state !== CANNON_STRIPPED) return false;
    if (!held(player, CANNON_BARREL)) {
      player.sendMessage("You need a cannon barrel to repair this cannon.");
      return false;
    }
    player.getInventory().deleteNumber(CANNON_BARREL, 1);
    setVarbitValue(player, VARBIT_CANNON, CANNON_EMPTY);
    setVarbitValue(player, VARBIT_CANNON_CLEAN, 1);
    setVarbitValue(player, VARBIT_CANNON_POWDER, 0);
    setVarbitValue(player, VARBIT_CANNON_TAMP, 0);
    setVarbitValue(player, VARBIT_CANNON_AMMO, 0);
    setVarbitValue(player, VARBIT_CANNON_FUSE, 0);
    playVariant(player, "fixing-up-the-cannon-using-a-new-barrel-on-the-cannon");
    return true;
  }

  function handleCannonClick(player, option) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CANNON || stage >= STAGE_COMPLETE) return false;
    if (option === "repair") return repairCannon(player);
    if (option === "inspect") {
      if (stage < STAGE_FIRE) return false;
      playVariant(
        player,
        "talking-to-bill-teach-again-before-firing-the-cannon-using-the-cannon-in-the-correct-order-inspecting-the-cannon"
      );
      return true;
    }
    if (option === "empty-out") {
      if (stage !== STAGE_FIRE && stage !== STAGE_SINK) return false;
      setVarbitValue(player, VARBIT_CANNON_POWDER, 0);
      setVarbitValue(player, VARBIT_CANNON_TAMP, 0);
      setVarbitValue(player, VARBIT_CANNON_AMMO, 0);
      setVarbitValue(player, VARBIT_CANNON_FUSE, 0);
      setVarbitValue(player, VARBIT_CANNON, CANNON_EMPTY);
      playVariant(
        player,
        "talking-to-bill-teach-again-before-firing-the-cannon-using-the-cannon-in-the-correct-order-cleaning-the-cannon"
      );
      return true;
    }
    if (option === "fire!") {
      if (stage !== STAGE_FIRE && stage !== STAGE_SINK) return false;
      fireCannon(player);
      return true;
    }
    return false;
  }

  function emptyCannonLoad(player, keepClean) {
    setVarbitValue(player, VARBIT_CANNON_POWDER, 0);
    setVarbitValue(player, VARBIT_CANNON_TAMP, 0);
    setVarbitValue(player, VARBIT_CANNON_AMMO, 0);
    setVarbitValue(player, VARBIT_CANNON_FUSE, 0);
    setVarbitValue(player, VARBIT_CANNON, CANNON_EMPTY);
    if (!keepClean) setVarbitValue(player, VARBIT_CANNON_CLEAN, 0);
  }

  function fireCannon(player) {
    const stage = quest.getStage(player);
    if (stage !== STAGE_FIRE && stage !== STAGE_SINK) return false;
    if (varbitValue(player, VARBIT_CANNON) !== CANNON_ARMED) return false;
    const powder = varbitValue(player, VARBIT_CANNON_POWDER);
    const tamp = varbitValue(player, VARBIT_CANNON_TAMP);
    const ammo = varbitValue(player, VARBIT_CANNON_AMMO);
    const clean = varbitValue(player, VARBIT_CANNON_CLEAN);
    if (ammo === 0) {
      emptyCannonLoad(player, true);
      playVariant(
        player,
        powder === 0
          ? "talking-to-bill-teach-again-before-firing-the-cannon-firing-the-cannon-firing-the-cannon-without-adding-powder-or-ammunition"
          : "talking-to-bill-teach-again-before-firing-the-cannon-firing-the-cannon-firing-the-cannon-without-adding-ammunition"
      );
      return true;
    }
    // Canister rounds are the crew phase; cannonballs are the hull phase.
    if (stage === STAGE_FIRE && ammo !== CANNON_AMMO_CANISTER) return false;
    if (stage === STAGE_SINK && ammo !== CANNON_AMMO_BALL) return false;
    if (powder === 0) {
      emptyCannonLoad(player, true);
      playVariant(
        player,
        "talking-to-bill-teach-again-before-firing-the-cannon-firing-the-cannon-firing-the-cannon-without-adding-powder-or-ammunition"
      );
      return true;
    }
    if (clean === 0 || tamp === 0) {
      emptyCannonLoad(player, false);
      setVarbitValue(player, VARBIT_CANNON, CANNON_EXPLODED);
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(5, HitMask.RED)]);
      playVariant(
        player,
        "talking-to-bill-teach-again-before-firing-the-cannon-using-the-cannon-in-the-correct-order-blowing-up-the-cannon"
      );
      return true;
    }
    const hit = Math.random() < rangedHitChance(player);
    emptyCannonLoad(player, false);
    if (ammo === CANNON_AMMO_CANISTER) {
      fireOutcome.set(player, hit ? "hit" : "miss");
      if (hit) {
        // The death task records the crew hit; with no pirate lined up the
        // cannon still catches a rat, which the wiki counts as a pirate kill.
        if (!hitPirateWithCanister(player)) setCrewHits(player, crewHits(player) + 1);
      }
      playVariant(
        player,
        "talking-to-bill-teach-again-before-firing-the-cannon-firing-the-cannon"
      );
      return true;
    }
    if (!hit) {
      fireOutcome.set(player, "miss");
      playVariant(player, "sinking-the-enemy-ship-fire-at-will");
      return true;
    }
    const holes = varbitValue(player, VARBIT_HULL_HOLES) + 1;
    setVarbitValue(player, VARBIT_HULL_HOLES, holes);
    if (holes >= 3) {
      playVariant(player, "sinking-the-enemy-ship-after-the-third-and-final-hit");
      return true;
    }
    if (holes === 1) {
      fireOutcome.set(player, "hit");
      playVariant(player, "sinking-the-enemy-ship-fire-at-will");
      return true;
    }
    playVariant(player, "sinking-the-enemy-ship-shooting-at-the-hull-again");
    return true;
  }

  function useOnCannon(player, itemId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CANNON || stage >= STAGE_COMPLETE) return false;
    if (itemId === CANNON_BARREL) return repairCannon(player);
    if (!held(player, itemId)) return false;
    const state = varbitValue(player, VARBIT_CANNON);
    if (state !== CANNON_EMPTY) return false;
    if (itemId === GUNPOWDER) {
      if (stage !== STAGE_FIRE && stage !== STAGE_SINK) return false;
      if (varbitValue(player, VARBIT_CANNON_POWDER) === 1) return false;
      player.getInventory().deleteNumber(GUNPOWDER, 1);
      setVarbitValue(player, VARBIT_CANNON_POWDER, 1);
      player.sendMessage("You pour the powder into the cannon.");
      return true;
    }
    if (itemId === RAMROD) {
      if (stage !== STAGE_FIRE && stage !== STAGE_SINK) return false;
      if (varbitValue(player, VARBIT_CANNON_CLEAN) === 0) {
        setVarbitValue(player, VARBIT_CANNON_CLEAN, 1);
        playVariant(
          player,
          "talking-to-bill-teach-again-before-firing-the-cannon-using-the-cannon-in-the-correct-order-cleaning-the-cannon"
        );
        return true;
      }
      if (
        varbitValue(player, VARBIT_CANNON_POWDER) === 1 &&
        varbitValue(player, VARBIT_CANNON_TAMP) === 0
      ) {
        setVarbitValue(player, VARBIT_CANNON_TAMP, 1);
        player.sendMessage("You shove the Ramrod into the cannon barrel.");
        return true;
      }
      return false;
    }
    if (itemId === CANISTER) {
      if (stage !== STAGE_FIRE) return false;
      if (varbitValue(player, VARBIT_CANNON_AMMO) !== 0) return false;
      player.getInventory().deleteNumber(CANISTER, 1);
      setVarbitValue(player, VARBIT_CANNON_AMMO, CANNON_AMMO_CANISTER);
      player.sendMessage("You roll the canister round into the cannon.");
      return true;
    }
    if (itemId === CF_CANNON_BALL) {
      if (stage !== STAGE_SINK) return false;
      if (varbitValue(player, VARBIT_CANNON_AMMO) !== 0) return false;
      player.getInventory().deleteNumber(CF_CANNON_BALL, 1);
      setVarbitValue(player, VARBIT_CANNON_AMMO, CANNON_AMMO_BALL);
      player.sendMessage("You roll the cannonball into the cannon.");
      return true;
    }
    if (itemId === STEEL_CANNONBALL) {
      if (stage !== STAGE_FIRE && stage !== STAGE_SINK) return false;
      player.sendMessage("This cannonball is far too big.");
      return true;
    }
    if (itemId === FUSE) {
      if (stage !== STAGE_FIRE && stage !== STAGE_SINK) return false;
      if (varbitValue(player, VARBIT_CANNON_FUSE) === 1) return false;
      player.getInventory().deleteNumber(FUSE, 1);
      setVarbitValue(player, VARBIT_CANNON_FUSE, 1);
      setVarbitValue(player, VARBIT_CANNON, CANNON_ARMED);
      player.sendMessage("You ready the cannon for firing.");
      return true;
    }
    return false;
  }

  function useOnHole(player, itemId, objectId) {
    const holeVarbit = HOLE_VARBIT_BY_OBJECT.get(objectId);
    if (holeVarbit === undefined) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_LEAKS) {
      const value = varbitValue(player, holeVarbit);
      if (REPAIR_PLANKS.has(itemId)) {
        if (value !== 0) {
          player.sendMessage("This hole has already been planked.");
          return true;
        }
        if (!held(player, HAMMER)) {
          playVariant(
            player,
            "sort-out-the-leaks-returning-to-battle-after-dealing-with-the-cannon-trying-to-repair-a-hole-without-a-hammer"
          );
          return true;
        }
        if (player.getInventory().getAmount(REPAIR_PLANK) + player.getInventory().getAmount(REPAIR_PLANK_ALT) < 2) {
          playVariant(
            player,
            "sort-out-the-leaks-returning-to-battle-after-dealing-with-the-cannon-trying-to-patch-a-hole-without-planks"
          );
          return true;
        }
        if (!held(player, TACKS, 10)) {
          playVariant(
            player,
            "sort-out-the-leaks-returning-to-battle-after-dealing-with-the-cannon-trying-to-patch-a-hole-without-tacks"
          );
          return true;
        }
        let remaining = 2;
        for (const plankId of [REPAIR_PLANK, REPAIR_PLANK_ALT]) {
          const take = Math.min(remaining, player.getInventory().getAmount(plankId));
          if (take > 0) {
            player.getInventory().deleteNumber(plankId, take);
            remaining -= take;
          }
        }
        player.getInventory().deleteNumber(TACKS, 10);
        setVarbitValue(player, holeVarbit, 1);
        syncHoleCounters(player);
        playVariant(player, "sort-out-the-leaks-planking-up-a-hole");
        return true;
      }
      if (itemId === SWAMP_PASTE) {
        if (value === 0) {
          player.sendMessage("You need to nail planks over the hole first.");
          return true;
        }
        if (value !== 1) {
          player.sendMessage("This hole has already been waterproofed.");
          return true;
        }
        if (!held(player, SWAMP_PASTE)) {
          playVariant(
            player,
            "sort-out-the-leaks-planking-up-a-hole-trying-to-waterproof-a-hole-without-swamp-paste"
          );
          return true;
        }
        player.getInventory().deleteNumber(SWAMP_PASTE, 1);
        setVarbitValue(player, holeVarbit, 2);
        syncHoleCounters(player);
        playVariant(player, "sort-out-the-leaks-patching-up-a-hole");
        return true;
      }
      return false;
    }
    if (stage === STAGE_CANNON && (REPAIR_PLANKS.has(itemId) || itemId === SWAMP_PASTE)) {
      playVariant(
        player,
        "dealing-with-the-cannon-trying-to-fill-the-ship-hull-before-taking-out-the-cannon"
      );
      return true;
    }
    return false;
  }

  function swingToOtherShip(player, itemId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CANNON || stage >= STAGE_COMPLETE) return false;
    if (!SWING_ROPES.has(itemId) || !held(player, itemId)) return false;
    if ((player.getLocation()?.getZ?.() ?? 0) < 2) return false;
    if (player.getSkillManager().getMaxLevel(Skill.AGILITY) < PIRATE_AGILITY) {
      playVariant(player, "dealing-with-the-cannon-using-a-rope-swing-falling-on-a-rope-swing");
      player.setRunEnergy(0);
      player.getPacketSender().sendRunEnergy();
      return true;
    }
    const onOwnShip = (player.getLocation()?.getX?.() ?? 0) < 1819;
    player.getInventory().deleteNumber(itemId, 1);
    player.moveTo(onOwnShip ? ENEMY_DECK : BATTLE_DECK);
    return true;
  }

  function handleGroundItemPickup(event) {
    const { player, groundItemId, location } = event;
    if (!player || !location) return;
    const at = (tile) => location.x === tile.x && location.y === tile.y && location.z === tile.z;
    const itemId = groundItemId === CF_ROPE && at(ENEMY_ROPE_TILE)
      ? ROPE
      : groundItemId === CF_TINDERBOX && at(HOLD_TINDERBOX_TILE)
        ? TINDERBOX
        : null;
    if (itemId === null) return;

    event.handled = true;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1 || inventory.adds(itemId, 1) === false) {
      player.sendMessage("You do not have enough free inventory space to take that.");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player || event.handled) return false;
    if (HOLE_VARBIT_BY_OBJECT.has(objectId)) {
      if (!REPAIR_PLANKS.has(itemId) && itemId !== SWAMP_PASTE) return false;
      if (!held(player, itemId)) return false;
      event.handled = true;
      useOnHole(player, itemId, objectId);
      return true;
    }
    if (SAIL_OBJECT_IDS.has(objectId)) {
      if (!SWING_ROPES.has(itemId)) return false;
      if (!swingToOtherShip(player, itemId)) return false;
      event.handled = true;
      return true;
    }
    if (objectId === ENEMY_POWDER_BARREL) {
      if (itemId === FUSE) {
        if (!attachFuse(player)) return false;
        event.handled = true;
        return true;
      }
      if (TINDERBOXES.has(itemId) || BULLSEYE_LANTERNS.has(itemId)) {
        event.handled = true;
        playVariant(
          player,
          "dealing-with-the-cannon-using-fuse-on-the-barrel-attempting-to-light-the-barrel-instead-of-the-fuse"
        );
        return true;
      }
      return false;
    }
    if (FUSE_OBJECT_IDS.has(objectId)) {
      if (!TINDERBOXES.has(itemId) && !BULLSEYE_LANTERNS.has(itemId)) return false;
      if (!lightFuse(player, itemId)) return false;
      event.handled = true;
      return true;
    }
    if (objectId === ADVENTUROUS_CANNON) {
      if (!CANNON_ITEMS.has(itemId)) return false;
      if (!useOnCannon(player, itemId)) return false;
      event.handled = true;
      return true;
    }
    if (objectId === PLUNDER_STORAGE && itemId === PLUNDER) {
      if (!storePlunder(player)) return false;
      event.handled = true;
      return true;
    }
    return false;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player || event.handled) return false;
    const option = optionOf(event);
    if (objectId === ADVENTUROUS_CANNON) {
      event.handled = true;
      handleCannonClick(player, option);
      return event.handled === true;
    }
    if (objectId === PLUNDER_STORAGE) {
      if (option === "store-plunder") {
        if (!storePlunder(player)) return false;
      } else if (option === "count-plunder") {
        if (!countPlunder(player)) return false;
      } else {
        return false;
      }
      event.handled = true;
      return true;
    }
    if (objectId === POWDER_BARREL || objectId === ENEMY_POWDER_BARREL) {
      if (option !== "take-powder") return false;
      if (quest.getStage(player) < STAGE_CANNON || quest.getStage(player) >= STAGE_COMPLETE) {
        return false;
      }
      event.handled = true;
      takePowder(player);
      return true;
    }
    if (objectId === REPAIR_LOCKER) {
      if (option !== "open" && option !== "search") return false;
      if (quest.getStage(player) < STAGE_CANNON || quest.getStage(player) >= STAGE_COMPLETE) {
        return false;
      }
      event.handled = true;
      openRepairLocker(player);
      return true;
    }
    if (objectId === GUN_LOCKER) {
      if (option !== "open" && option !== "search") return false;
      if (quest.getStage(player) < STAGE_CANNON || quest.getStage(player) >= STAGE_COMPLETE) {
        return false;
      }
      event.handled = true;
      openGunLocker(player);
      return true;
    }
    const source = PLUNDER_SOURCES.get(objectId);
    if (source) {
      if (option !== "loot" && option !== "plunder" && option !== "ransack") return false;
      if (quest.getStage(player) !== STAGE_PLUNDER) return false;
      if (!lootPlunder(player, source)) {
        event.handled = true;
        return true;
      }
      event.handled = true;
      return true;
    }
    if (objectId === CLIMBING_NET_UP) {
      if (option !== "climb") return false;
      event.handled = true;
      player.moveTo((player.getLocation()?.getX?.() ?? 0) < 1819 ? WEST_YARDARM : EAST_YARDARM);
      return true;
    }
    if (objectId === CLIMBING_NET_DOWN) {
      if (option !== "climb-down") return false;
      event.handled = true;
      player.moveTo((player.getLocation()?.getX?.() ?? 0) < 1819 ? WEST_NET_LANDING : EAST_NET_LANDING);
      return true;
    }
    return false;
  }

  /**
   * Named object hooks run first and delegate to the id-based handler, so the
   * transformed multi-locs still resolve through their visible name. Returning
   * false leaves objects this quest does not own to the shared plugins.
   */
  function delegateObjectInteraction(event) {
    return handleObjectInteraction(event);
  }

  function delegateItemOnObject(event) {
    return handleItemOnObject(event);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function objectiveLines(stage) {
    return OBJECTIVES.map((objective, index) => {
      const done = stage >= objective.at;
      const text = `Objective ${index + 1}: ${objective.text}`;
      return done ? `<str>${text}</str>` : text;
    });
  }

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        ...objectiveLines(stage),
        "",
        "<str>Bill Teach recruited me to help sail the Adventurous to</str>",
        "<str>Mos Le'Harmless, past the pirate captain who wanted to</str>",
        "<str>sink her. I destroyed the enemy cannon, patched the</str>",
        "<str>hull, plundered their hold and sank their ship.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        ...objectiveLines(stage),
        "",
        "<str>Bill Teach recruited me to help sail the Adventurous to</str>",
        "<str>Mos Le'Harmless, past the pirate captain who wanted to</str>",
        "<str>sink her.</str>",
        "",
      ];
      if (stage === STAGE_STARTED) {
        lines.push("I should board <col=800000>The Adventurous</col> and speak to");
        lines.push("<col=800000>Bill Teach</col> to set sail.");
      } else if (stage === STAGE_SAILING) {
        lines.push("We are setting sail for Mos Le'Harmless.");
      } else if (stage === STAGE_CANNON) {
        lines.push("I must take out the enemy cannon: take a rope from the");
        lines.push("repair locker and a fuse from the gun locker, swing over");
        lines.push("and blow up the barrel of gunpowder beside their cannon.");
      } else if (stage === STAGE_LEAKS) {
        lines.push("The Adventurous is taking on water. I need planks, tacks,");
        lines.push("a hammer and swamp paste from the repair locker to patch");
        lines.push("the three holes in the hull.");
      } else if (stage === STAGE_PLUNDER) {
        lines.push("I must steal ten loads of plunder from the enemy ship and");
        lines.push("store it in the plunder storage in the Adventurous' hold.");
      } else if (stage === STAGE_FIX_CANNON) {
        lines.push("Our cannon needs a new barrel from the gun locker.");
      } else if (stage === STAGE_FIRE) {
        lines.push("I must load the cannon (powder, ramrod, canister, fuse)");
        lines.push("and fire it at the enemy crew.");
      } else if (stage === STAGE_SINK) {
        lines.push("I must put three holes in the enemy ship's hull with");
        lines.push("cannonballs to sink her.");
      }
      return lines;
    }
    return [
      ...objectiveLines(stage),
      "",
      "I can start this quest by talking to <col=800000>Bill Teach</col>",
      "in <col=800000>The Green Ghost</col> in Port Phasmatys.",
    ];
  }

  function removeQuestSupplies(player) {
    for (const itemId of [
      FUSE,
      GUNPOWDER,
      RAMROD,
      CANISTER,
      CF_CANNON_BALL,
      CANNON_BARREL,
      REPAIR_PLANK,
      REPAIR_PLANK_ALT,
      TACKS,
      PLUNDER,
    ]) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
    }
  }

  function grantRewards(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CRAFTING, 7000);
    skills.addExperiences(Skill.SMITHING, 7000);
    skills.addExperiences(Skill.AGILITY, 7000);
    removeQuestSupplies(player);
    giveBookOfPiracy(player);
  }

  // ==========================================================================
  // Login bootstrap
  // ==========================================================================

  function restoreVarps({ player }) {
    if (!player) return;
    const sender = player.getPacketSender();
    if (quest.getStage(player) === 0) {
      // Stage 0 with persisted attributes (::quest reset before this handler
      // existed, or a reset while offline) must not restore the old ship state.
      resetQuestState(player);
    } else {
      sender.sendConfig(VARP_CANNON_VAR, Number(player.getAttribute(VARP_CANNON_ATTRIBUTE)) || 0);
      sender.sendConfig(VARP_EXTRA_VAR, Number(player.getAttribute(VARP_EXTRA_ATTRIBUTE)) || 0);
      sender.sendConfig(VARP_STORAGE_VAR, Number(player.getAttribute(VARP_STORAGE_ATTRIBUTE)) || 0);
    }
    // Logging out respawns the plundered containers (wiki).
    sender.sendVarbit(VARBIT_CRATE, 0);
    sender.sendVarbit(VARBIT_CHEST, 0);
    sender.sendVarbit(VARBIT_BARREL, 0);
  }

  function handleStageChanged({ player, key, stage }) {
    if (!player || key !== "cabin_fever" || (stage | 0) !== 0) return;
    resetQuestState(player);
  }

  /**
   * The Adventurous' Bill Teach spawn row (4013) points at a cache definition
   * with no name or actions, so the client never offers Talk-to on it. Swap the
   * spawned NPC for 4014 (a Bill that does have the option) once world spawns
   * are loaded. A no-op once the row itself carries a working id.
   */
  function fixPortShipBill() {
    // The 4013 spawn row transforms to 4011, so getId() no longer names it.
    const npcs = World.getNpcs();
    const broken = npcs.search((npc) => {
      const id = npc?.getRealId?.() ?? npc?.getId?.();
      return id === BILL_PORT_SHIP_ROW;
    });
    if (!broken) return;
    const location = broken.getLocation();
    const fixed = npcs.search((npc) => {
      const id = npc?.getRealId?.() ?? npc?.getId?.();
      if (id !== BILL_PORT_SHIP) return false;
      const other = npc.getLocation();
      return (
        other.getZ() === location.getZ() &&
        Math.abs(other.getX() - location.getX()) <= 2 &&
        Math.abs(other.getY() - location.getY()) <= 2
      );
    });
    api.removeNpc(broken);
    if (fixed) return;
    api.spawnNpc({
      id: BILL_PORT_SHIP,
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
    });
  }

  function handleRegionLoaded({ regionId }) {
    if (regionId === PORT_SHIP_REGION) fixPortShipBill();
  }

  function handleActiveRegionsUpdated(snapshot) {
    if (!snapshot?.regionKeys?.includes(PORT_SHIP_REGION_KEY)) return;
    if (snapshot.processCycle - lastPortShipBillCheck < 10) return;
    lastPortShipBillCheck = snapshot.processCycle;
    fixPortShipBill();
  }

  function handleLogin({ player }) {
    // Saves completed before the cleanup hook may still hold quest supplies.
    if (quest.isComplete(player)) removeQuestSupplies(player);
    // NPCs for the player's region are activated after the login hooks.
    fixPortShipBill();
    if (TaskManager && CountdownTask) {
      TaskManager.submit(
        new CountdownTask(player, 2, () => {
          if (player.isRegistered?.() === false) return;
          fixPortShipBill();
        })
      );
    }
    refreshQuestList(player);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(FLAGS_ATTRIBUTE, 0);
  api.persistAttribute(CREW_HITS_ATTRIBUTE, 0);
  api.persistAttribute(VARP_CANNON_ATTRIBUTE, 0);
  api.persistAttribute(VARP_EXTRA_ATTRIBUTE, 0);
  api.persistAttribute(VARP_STORAGE_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "cabin_fever",
    name: "Cabin Fever",
    varpId: VARP_CABIN_FEVER,
    varpValue: wireStageValue,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 7000, label: "Crafting" },
      { skillId: Skill.SMITHING.getIndex(), amount: 7000, label: "Smithing" },
      { skillId: Skill.AGILITY.getIndex(), amount: 7000, label: "Agility" },
    ],
    // The book is granted by grantRewards so an existing copy is never duplicated.
    scrollItemId: BOOK_O_PIRACY,
    rewardItemLabel: "Book o' Piracy",
    otherRewards: [
      "Access to Mos Le'Harmless",
      "Access to the Trouble Brewing minigame",
    ],
    buildJournal,
    onReward: grantRewards,
  });

  api.onNpcInteraction("Bill Teach", { "Talk-to": talkToBill });
  api.onNpcInteraction("Pirate", { "Talk-to": talkToPirate });
  api.onNpcInteraction("Mama", { "Talk-to": talkToMama });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("ladders:climb", handleGangplankClaim);
  api.onItemAction("Book o' Piracy", { Read: readBookOfPiracy });
  // Named item uses run first; the id-based handler below stays the fallback
  // for transformed objects and the nameless hull holes.
  api.onItemOnObject("Rope", "Hoisted sail", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Rope", "Sail", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Fuse", "Powder Barrel", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Fuse", "Barrel", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Tinderbox", "Fuse", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Gunpowder", "Cannon", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Ramrod", "Cannon", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Canister", "Cannon", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Cannon ball", "Cannon", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Fuse", "Cannon", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Cannon barrel", "Cannon", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Cannon barrel", "Broken Cannon", delegateItemOnObject, { noted: false });
  api.onItemOnObject("Plunder", "Plunder Storage", delegateItemOnObject, { noted: false });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onObjectInteraction("Gangplank", { Cross: crossGangplank });
  api.onObjectInteraction("Repair Locker", {
    Open: delegateObjectInteraction,
    Search: delegateObjectInteraction,
  });
  api.onObjectInteraction("Gun Locker", {
    Open: delegateObjectInteraction,
    Search: delegateObjectInteraction,
  });
  api.onObjectInteraction("Powder Barrel", { "Take-powder": delegateObjectInteraction });
  api.onObjectInteraction("Barrel", {
    Ransack: delegateObjectInteraction,
    "Take-powder": delegateObjectInteraction,
  });
  api.onObjectInteraction("Cannon", {
    Inspect: delegateObjectInteraction,
    "Empty-Out": delegateObjectInteraction,
    "Fire!": delegateObjectInteraction,
  });
  api.onObjectInteraction("Broken Cannon", { Repair: delegateObjectInteraction });
  api.onObjectInteraction("Crate", { Loot: delegateObjectInteraction });
  api.onObjectInteraction("Closed chest", { Plunder: delegateObjectInteraction });
  api.onObjectInteraction("Open chest", { Plunder: delegateObjectInteraction });
  api.onObjectInteraction("Plunder Storage", {
    "Count-plunder": delegateObjectInteraction,
    "Store-plunder": delegateObjectInteraction,
  });
  api.onObjectInteraction("Climbing net", {
    Climb: delegateObjectInteraction,
    "Climb-down": delegateObjectInteraction,
  });
  api.onObjectInteraction("Climbing Net", {
    Climb: delegateObjectInteraction,
    "Climb-down": delegateObjectInteraction,
  });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onRegionLoaded(handleRegionLoaded);
  api.onActiveRegionsUpdated(handleActiveRegionsUpdated);
  api.onCustomEvent("player:bootstrap-complete", restoreVarps);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onServerStartup(fixPortShipBill);
};
