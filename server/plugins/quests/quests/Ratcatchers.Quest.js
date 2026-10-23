/**
 * Ratcatchers (members).
 *
 * The words come from the "Ratcatchers" transcript page; this plugin supplies the
 * variant selector for its NPCs, the start hook, the prose-condition answers, the
 * rat-counting tasks, the warehouse/rat-hole/King Rat/Smokin' Joe interactions,
 * the snake-charmer deal and the completion reward.
 *
 * Stages (varbit 1404 "ratcatch_var", varp 607 bits 0-7; same varp carries
 * ratcatch_ratholes/ratcatch_catknowsdrill/ratcatch_music_len):
 *   1 started (Gertrude)
 *   2 Sisters Grime task set (cat sniffed)
 *   3 8 rats caught, rat pole, sent to Jimmy
 *   4 Jimmy's task given (Directions)
 *   5 followed the directions to the mansion
 *   6 mansion cleared of rats
 *   7 returned to Jimmy, sent to Hooknosed Jack
 *   8 Jack's task given (poison the four rat holes)
 *   9 four holes poisoned
 *  10 told Pox was poisoned, sent to the Apothecary
 *  11 got the cat antipoison
 *  12 gave it to Jack, sent to kill the King Rat
 *  13 King Rat killed
 *  14 returned to Jack, sent to Smokin' Joe
 *  15 Joe's task given (smoke out the rats)
 *  16 rats smoked out
 *  17 returned to Joe, sent to The Face in Port Sarim
 *  18 Felkrash's task given (rid the port of rats)
 *  19 The Face's story heard (the flute hint)
 *  20 the music scroll and snake charm from Ali
 *  21 charmed the Port Sarim rats into the sea
 *  22 complete
 *
 * Source: OSRS Wiki (https://oldschool.runescape.wiki/w/Ratcatchers and
 * /w/Transcript:Ratcatchers); varp/varbit from scripts/lookup-gameval.ts.
 *
 * Gaps:
 *  - The server has no observable "cat catches vermin" event, so the 8-sewer-rat
 *    and 6-mansion-rat tasks count player kills of rats inside the task zone
 *    (onNpcDeath); the wiki's Chase-vermin path still works but is invisible to
 *    plugins. Reported for a shared rat-catch event.
 *  - The King Rat fight is scripted: using a cat item on the hole in the wall
 *    plays the challenge, and choosing either fight option resolves it; the cat
 *    cannot die and fish healing, withdraw and the 1 HP retreat are not simulated.
 *  - The Port Sarim tune is not composed on an interface; Play on the snake charm
 *    inside Port Sarim stands in for the eight-note sheet music.
 *  - The Sisters' sniff and the mansion are not instanced; the mansion trellis is
 *    climbed with a quest handler (the shared Ladders plugin has no "Trellis").
 *  - Lighting a pot of weeds uses a short functional message, not transcript text.
 *  - Felkrash names the cat and turns it wily in OSRS; no wily-cat item exists here,
 *    so completion only checks for an overgrown cat.
 */
module.exports = function registerRatcatchersQuest(api) {
  const { Equipment, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Ratcatchers";
  const START_HOOK = "quest:ratcatchers:start";
  const GERTRUDES_CAT_QUEST_KEY = "gertrudes_cat";
  const ICTHLARINS_QUEST_KEY = "ictlharins_little_helper";

  const GERTRUDE_NPC_IDS = new Set([NpcIdentifiers.GERTRUDE, NpcIdentifiers.GERTRUDE_2]);
  const SISTER_NPC_IDS = new Set([NpcIdentifiers.GRIMESQUIT, NpcIdentifiers.PHINGSPET]);
  const JIMMY_NPC_ID = NpcIdentifiers.JIMMY_DAZZLER;
  const JACK_NPC_ID = NpcIdentifiers.HOOKNOSED_JACK;
  const APOTHECARY_NPC_ID = NpcIdentifiers.APOTHECARY;
  const JOE_NPC_ID = NpcIdentifiers.SMOKIN_JOE;
  const FACE_NPC_ID = NpcIdentifiers.THE_FACE;
  const FELKRASH_NPC_ID = NpcIdentifiers.FELKRASH;
  const ALI_NPC_IDS = new Set([
    NpcIdentifiers.ALI_THE_SNAKE_CHARMER,
    NpcIdentifiers.BADIR_THE_SNAKE_CHARMER,
  ]);
  const ALI_NPC_ID = NpcIdentifiers.ALI_THE_SNAKE_CHARMER;
  const POX_NPC_IDS = new Set([NpcIdentifiers.POX, NpcIdentifiers.POX_2]);
  const KING_RAT_NPC_ID = NpcIdentifiers.KING_RAT;
  const QUEST_NPC_IDS = new Set([
    ...GERTRUDE_NPC_IDS,
    ...SISTER_NPC_IDS,
    JIMMY_NPC_ID,
    JACK_NPC_ID,
    APOTHECARY_NPC_ID,
    JOE_NPC_ID,
    FACE_NPC_ID,
    FELKRASH_NPC_ID,
    ...ALI_NPC_IDS,
    ...POX_NPC_IDS,
    KING_RAT_NPC_ID,
  ]);

  const VARP_RATCATCHERS = 607;
  const VARBIT_RATCATCHERS_STAGE = 1404; // "ratcatch_var", bits 0-7 of varp 607
  const VARBIT_HOLE_IDS = [1406, 1407, 1408, 1409];
  const VARBIT_CAT_KNOWS_DRILL = 1410;
  const VARBIT_CAUGHT_RAT_IDS = [1424, 1425, 1426];
  // Cache npc-spawns: the upstairs party rats QH targets, in QH order.
  const MANSION_RAT_NW_NPC_ID = 6224;
  const MANSION_RAT_SE_1_NPC_ID = 6226;
  const MANSION_RAT_SE_2_NPC_ID = 6225;
  const MANOR_UPPER_RAT_FLAGS = new Map([
    [MANSION_RAT_NW_NPC_ID, 1 << 0], // (2832,5098,1), north-west room
    [MANSION_RAT_SE_1_NPC_ID, 1 << 1], // (2858,5087,1), south-east room
    [MANSION_RAT_SE_2_NPC_ID, 1 << 2], // (2861,5093,1), south-east room
  ]);

  const STAGE_STARTED = 1;
  const STAGE_SISTERS_TASK = 2;
  const STAGE_RATS_CAUGHT = 3;
  const STAGE_JIMMY_TASK = 4;
  const STAGE_AT_MANOR = 5;
  const STAGE_MANOR_CLEARED = 6;
  const STAGE_JIMMY_TOLD = 7;
  const STAGE_JACK_TASK = 8;
  const STAGE_HOLES_POISONED = 9;
  const STAGE_POX_POISONED = 10;
  const STAGE_HAS_ANTIPOISON = 11;
  const STAGE_JACK_TOLD = 12;
  const STAGE_KING_RAT_KILLED = 13;
  const STAGE_JACK_TOLD_2 = 14;
  const STAGE_JOE_TASK = 15;
  const STAGE_RATS_SMOKED = 16;
  const STAGE_JOE_TOLD = 17;
  const STAGE_FELKRASH_TASK = 18;
  const STAGE_STORY_HEARD = 19;
  const STAGE_HAS_CHARM = 20;
  const STAGE_RATS_CHARMED = 21;
  const STAGE_COMPLETE = 22;

  // Durable stages are the plugin's dialogue aliases; the wire is the cache's
  // "ratcatch_var" varbit 1404, whose values are Quest Helper's loadSteps keys
  // (0, 5, ... 125) and 127 for the cache DB completion threshold (row 116,
  // column 19). Extra helper keys (15/45/57/65/75) are single-action steps
  // between durable stages, so this is deliberately not stage * 5.
  const STAGE_VARBIT_VALUES = new Map([
    [STAGE_STARTED, 5],
    [STAGE_SISTERS_TASK, 10],
    [STAGE_RATS_CAUGHT, 20],
    [STAGE_JIMMY_TASK, 25],
    [STAGE_AT_MANOR, 30],
    [STAGE_MANOR_CLEARED, 35],
    [STAGE_JIMMY_TOLD, 40],
    [STAGE_JACK_TASK, 50],
    [STAGE_HOLES_POISONED, 55],
    [STAGE_POX_POISONED, 60],
    [STAGE_HAS_ANTIPOISON, 70],
    [STAGE_JACK_TOLD, 80],
    [STAGE_KING_RAT_KILLED, 85],
    [STAGE_JACK_TOLD_2, 90],
    [STAGE_JOE_TASK, 95],
    [STAGE_RATS_SMOKED, 100],
    [STAGE_JOE_TOLD, 105],
    [STAGE_FELKRASH_TASK, 110],
    [STAGE_STORY_HEARD, 115],
    [STAGE_HAS_CHARM, 120],
    [STAGE_RATS_CHARMED, 125],
    [STAGE_COMPLETE, 127],
  ]);

  const stageVarbitValue = (stage, player) => {
    if (stage === STAGE_SISTERS_TASK && player && ratsCaught(player) >= RATS_TO_CATCH) return 15;
    return STAGE_VARBIT_VALUES.get(stage) ?? 0;
  };

  const RATS_ATTRIBUTE = "quest.ratcatchers.rats";
  const MANOR_ATTRIBUTE = "quest.ratcatchers.manor";
  const MANOR_UPPER_RATS_ATTRIBUTE = "ratcatchers:upper-floor-rat-flags";
  const HOLES_ATTRIBUTE = "quest.ratcatchers.holes";
  const SMOKE_ATTRIBUTE = "quest.ratcatchers.smoke";

  const RATS_TO_CATCH = 8;
  const MANOR_RATS_TO_CATCH = 6;

  const CHEESE_ITEM_ID = ItemIdentifiers.CHEESE;
  const RAT_POISON_ITEM_ID = ItemIdentifiers.RAT_POISON;
  const RAT_POISON_ITEM_IDS = new Set([RAT_POISON_ITEM_ID, ItemIdentifiers.RAT_POISON_2]);
  const POISONED_CHEESE_ITEM_ID = ItemIdentifiers.POISONED_CHEESE;
  const VIAL_ITEM_ID = ItemIdentifiers.VIAL;
  const KWUARM_ITEM_ID = ItemIdentifiers.KWUARM;
  const RED_SPIDERS_EGGS_ITEM_ID = ItemIdentifiers.RED_SPIDERS_EGGS;
  const MARRENTILL_ITEM_ID = ItemIdentifiers.MARRENTILL;
  const UNICORN_HORN_DUST_ITEM_ID = ItemIdentifiers.UNICORN_HORN_DUST;
  const BUCKET_OF_MILK_ITEM_ID = ItemIdentifiers.BUCKET_OF_MILK;
  const CAT_ANTIPOISON_ITEM_ID = ItemIdentifiers.CAT_ANTIPOISON;
  const MUSIC_SCROLL_ITEM_ID = ItemIdentifiers.MUSIC_SCROLL;
  const SNAKE_CHARM_ITEM_ID = ItemIdentifiers.SNAKE_CHARM;
  const DIRECTIONS_ITEM_ID = ItemIdentifiers.DIRECTIONS;
  const POT_OF_WEEDS_ITEM_ID = ItemIdentifiers.POT_OF_WEEDS;
  const SMOULDERING_POT_ITEM_ID = ItemIdentifiers.SMOULDERING_POT;
  const RAT_POLE_ITEM_ID = ItemIdentifiers.RAT_POLE;
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const WEEDS_ITEM_IDS = new Set([
    ItemIdentifiers.WEEDS,
    ItemIdentifiers.WEEDS_2,
    ItemIdentifiers.WEEDS_3,
  ]);
  const POT_ITEM_IDS = new Set([ItemIdentifiers.POT, ItemIdentifiers.POT_2]);
  const BEER_ITEM_IDS = new Set([ItemIdentifiers.BEER, ItemIdentifiers.BEER_2]);
  const CAT_MEDAL_ITEM_IDS = new Set([
    ItemIdentifiers.CAT_TRAINING_MEDAL,
    ItemIdentifiers.CAT_TRAINING_MEDAL_2,
  ]);
  const CATSPEAK_AMULET_IDS = new Set([
    ItemIdentifiers.CATSPEAK_AMULET,
    ItemIdentifiers.CATSPEAK_AMULET_E_,
    ItemIdentifiers.CATSPEAK_AMULET_2,
    ItemIdentifiers.CATSPEAK_AMULET_E__2,
  ]);
  const CHAROS_RING_IDS = new Set([
    ItemIdentifiers.RING_OF_CHAROS,
    ItemIdentifiers.RING_OF_CHAROS_2,
    ItemIdentifiers.RING_OF_CHAROS_A_,
    ItemIdentifiers.RING_OF_CHAROS_A__2,
  ]);
  // Adult cat items 1561-1572 ("Pet cat"), hell cat and overgrown hell cat.
  const CAT_ITEM_IDS = new Set([
    ItemIdentifiers.PET_CAT,
    ItemIdentifiers.PET_CAT_2,
    ItemIdentifiers.PET_CAT_3,
    ItemIdentifiers.PET_CAT_4,
    ItemIdentifiers.PET_CAT_5,
    ItemIdentifiers.PET_CAT_6,
    ItemIdentifiers.PET_CAT_7,
    ItemIdentifiers.PET_CAT_8,
    ItemIdentifiers.PET_CAT_9,
    ItemIdentifiers.PET_CAT_10,
    ItemIdentifiers.PET_CAT_11,
    ItemIdentifiers.PET_CAT_12,
    ItemIdentifiers.HELL_CAT,
    ItemIdentifiers.OVERGROWN_HELLCAT,
  ]);
  const OVERGROWN_CAT_ITEM_IDS = new Set([
    ItemIdentifiers.PET_CAT_7,
    ItemIdentifiers.PET_CAT_8,
    ItemIdentifiers.PET_CAT_9,
    ItemIdentifiers.PET_CAT_10,
    ItemIdentifiers.PET_CAT_11,
    ItemIdentifiers.PET_CAT_12,
    ItemIdentifiers.OVERGROWN_HELLCAT,
  ]);
  const GROWN_CAT_NPC_NAMES = new Set(["Cat", "Hellcat", "Overgrown cat", "Overgrown hellcat"]);
  const OVERGROWN_CAT_NPC_NAMES = new Set(["Overgrown cat", "Overgrown hellcat"]);
  const CAT_SPEAKER_NAMES = new Set([
    "Cat",
    "Hellcat",
    "Overgrown cat",
    "Overgrown hellcat",
    "Kitten",
    "Hell-kitten",
  ]);

  // Warehouse rat holes upstairs (cast of ids 10346-10349 at 3265-3273,3377-3384).
  const WAREHOUSE_HOLE_BITS = new Map([
    [ObjectIdentifiers.RAT_HOLE_2, 1 << 0],
    [ObjectIdentifiers.RAT_HOLE_3, 1 << 1],
    [ObjectIdentifiers.RAT_HOLE_4, 1 << 2],
    [ObjectIdentifiers.RAT_HOLE_5, 1 << 3],
  ]);
  const KING_RAT_HOLE_OBJECT_ID = ObjectIdentifiers.HOLE_IN_WALL_2; // 10320
  const KELDAGRIM_HOLE_OBJECT_ID = ObjectIdentifiers.RAT_HOLE_6; // 10350, 2932/2933,10207-10212
  const MONEY_POT_OBJECT_ID = ObjectIdentifiers.MONEY_POT; // 6230
  const MANSION_TRELLIS_OBJECT_ID = ObjectIdentifiers.TRELLIS; // 10323, 2844/2851,5105
  const SMOKE_FIRST_BIT = 1 << 0;
  const SMOKE_SECOND_BIT = 1 << 1;

  const SEWERS_ZONE = { minX: 3150, maxX: 3350, minY: 9800, maxY: 9950 };
  const MANSION_ZONE = { minX: 2800, maxX: 2940, minY: 5040, maxY: 5130 };
  const ARDOUGNE_ZONE = { minX: 2420, maxX: 2730, minY: 3200, maxY: 3500 };
  const PORT_SARIM_ZONE = { minX: 2995, maxX: 3050, minY: 3190, maxY: 3245 };
  const MANSION_ARRIVAL = { x: 2848, y: 5108, z: 0 };
  const ARDOUGNE_ARRIVAL = { x: 2562, y: 3321, z: 0 };

  // Transcript step ids the plugin acts on.
  const SNIFF_ACTION_ID = "y8ZblR";
  const RAT_POLE_ACTION_ID = "VYB0Uo";
  const DIRECTIONS_ACTION_ID = "9yRU1Y";
  const TELEPORT_MANOR_ACTION_ID = "3XEhOl";
  const TELEPORT_ARDOUGNE_ACTION_ID = "LtbH8O";
  const JACK_MIXES_POISON_ACTION_ID = "YtwZ2O";
  const APOTHECARY_MIXES_ACTION_ID = "MJKZu1";
  const HAND_IN_ANTIPOISON_ACTION_ID = "RCYv7q";
  const CAT_GROWS_ACTION_ID = "3-zmem";
  const QUEST_COMPLETE_ACTION_ID = "LHwBkP";

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const heldAny = (player, itemIds) => [...itemIds].some((itemId) => held(player, itemId));

  function ratcatchers(variant) {
    return { page: PAGE, variant };
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questStarted(player, key) {
    const request = { player, key, started: null };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  function sendAuxiliaryVarbit(player, id, value) {
    player.getPacketSender().sendVarbit(id, value);
  }

  function syncQuestHelperProgress({ player }) {
    if (!player) return;
    const holes = holesMask(player);
    for (const [index, bit] of [...WAREHOUSE_HOLE_BITS.values()].entries()) {
      sendAuxiliaryVarbit(player, VARBIT_HOLE_IDS[index], (holes & bit) !== 0 ? 1 : 0);
    }
    sendAuxiliaryVarbit(player, VARBIT_CAT_KNOWS_DRILL, (smokeMask(player) & SMOKE_FIRST_BIT) !== 0 ? 1 : 0);
    const flags = manorUpperRatFlags(player);
    for (let index = 0; index < VARBIT_CAUGHT_RAT_IDS.length; index++) {
      sendAuxiliaryVarbit(player, VARBIT_CAUGHT_RAT_IDS[index], (flags & (1 << index)) !== 0 ? 1 : 0);
    }
  }

  function locationXY(location) {
    if (!location) return null;
    const x = typeof location.getX === "function" ? location.getX() : location.x;
    const y = typeof location.getY === "function" ? location.getY() : location.y;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function inZone(zone, location) {
    const xy = locationXY(location);
    return (
      !!xy &&
      xy.x >= zone.minX &&
      xy.x <= zone.maxX &&
      xy.y >= zone.minY &&
      xy.y <= zone.maxY
    );
  }

  function setStage(player, value) {
    if (value === STAGE_STARTED || value === 0) {
      player.setAttribute(RATS_ATTRIBUTE, 0);
      player.setAttribute(MANOR_ATTRIBUTE, 0);
      player.setAttribute(MANOR_UPPER_RATS_ATTRIBUTE, 0);
      player.setAttribute(HOLES_ATTRIBUTE, 0);
      player.setAttribute(SMOKE_ATTRIBUTE, 0);
    } else if (value === STAGE_SISTERS_TASK) {
      player.setAttribute(RATS_ATTRIBUTE, 0);
    } else if (value === STAGE_AT_MANOR) {
      player.setAttribute(MANOR_ATTRIBUTE, 0);
      player.setAttribute(MANOR_UPPER_RATS_ATTRIBUTE, 0);
    } else if (value === STAGE_JACK_TASK) {
      player.setAttribute(HOLES_ATTRIBUTE, 0);
    } else if (value === STAGE_JOE_TASK) {
      player.setAttribute(SMOKE_ATTRIBUTE, 0);
    }
    quest.setStage(player, value);
  }

  const ratsCaught = (player) => Number(player.getAttribute(RATS_ATTRIBUTE)) || 0;
  const manorRatsCaught = (player) => Number(player.getAttribute(MANOR_ATTRIBUTE)) || 0;
  const manorUpperRatFlags = (player) => Number(player.getAttribute(MANOR_UPPER_RATS_ATTRIBUTE)) || 0;

  function hasInventorySpace(inventory) {
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots() > 0
      : !inventory.isFull();
  }

  function grantRatPole(player) {
    const inventory = player.getInventory();
    if (held(player, RAT_POLE_ITEM_ID)) return true;
    if (!hasInventorySpace(inventory)) {
      inventory.full?.();
      return false;
    }
      inventory.adds(RAT_POLE_ITEM_ID, 1);
      return held(player, RAT_POLE_ITEM_ID);
  }

  function wearingCatspeakAmulet(player) {
    const amulet = player.getEquipment().get(Equipment.AMULET_SLOT);
    return CATSPEAK_AMULET_IDS.has(amulet?.getId?.());
  }

  function wearingCharos(player) {
    const ring = player.getEquipment().get(Equipment.RING_SLOT);
    return CHAROS_RING_IDS.has(ring?.getId?.());
  }

  function npcName(npc, player) {
    return (
      npc?.getCurrentDefinition?.(player)?.getName?.() ??
      npc?.getDefinition?.()?.getName?.() ??
      ""
    );
  }

  function followerCatNames(player) {
    const names = new Set();
    for (const npc of api.getWorld()?.getNpcs?.() ?? []) {
      if (!npc || npc.isRegistered?.() === false) continue;
      if (npc.getOwner?.()?.getIndex?.() !== player.getIndex?.()) continue;
      const name = npcName(npc, player);
      if (name) names.add(name);
    }
    return names;
  }

  function hasGrownCat(player) {
    if (heldAny(player, CAT_ITEM_IDS)) return true;
    const names = followerCatNames(player);
    for (const name of GROWN_CAT_NPC_NAMES) if (names.has(name)) return true;
    return false;
  }

  function hasOvergrownCat(player) {
    if (heldAny(player, OVERGROWN_CAT_ITEM_IDS)) return true;
    const names = followerCatNames(player);
    for (const name of OVERGROWN_CAT_NPC_NAMES) if (names.has(name)) return true;
    return false;
  }

  function catNpcId(player) {
    for (const npc of api.getWorld()?.getNpcs?.() ?? []) {
      if (!npc || npc.isRegistered?.() === false) continue;
      if (npc.getOwner?.()?.getIndex?.() !== player.getIndex?.()) continue;
      if (GROWN_CAT_NPC_NAMES.has(npcName(npc, player))) return npc.getId();
    }
    return NpcIdentifiers.CAT;
  }

  function hasAllPoisonIngredients(player) {
    return (
      held(player, VIAL_ITEM_ID) &&
      held(player, KWUARM_ITEM_ID) &&
      held(player, RED_SPIDERS_EGGS_ITEM_ID)
    );
  }

  function hasAllApothecaryIngredients(player) {
    return (
      held(player, BUCKET_OF_MILK_ITEM_ID) &&
      held(player, UNICORN_HORN_DUST_ITEM_ID) &&
      held(player, MARRENTILL_ITEM_ID)
    );
  }

  const holesMask = (player) => Number(player.getAttribute(HOLES_ATTRIBUTE)) || 0;

  function allHolesPoisoned(player) {
    let mask = 0;
    for (const bit of WAREHOUSE_HOLE_BITS.values()) mask |= bit;
    return (holesMask(player) & mask) === mask;
  }

  const smokeMask = (player) => Number(player.getAttribute(SMOKE_ATTRIBUTE)) || 0;

  function isQuestSpeaker(npcId, definition) {
    if (QUEST_NPC_IDS.has(npcId)) return true;
    if (CAT_SPEAKER_NAMES.has(definition?.getName?.())) return true;
    return false;
  }

  // ==========================================================================
  // Dialogue
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (!player || !quest) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      if (SISTER_NPC_IDS.has(npcId) && !held(player, RAT_POLE_ITEM_ID)) {
        return {
          page: npcId === NpcIdentifiers.GRIMESQUIT ? "Grimesquit" : "Phingspet",
          variant: "standard-dialogue-after-the-quest-without-a-rat-pole",
        };
      }
      // Each NPC's own page carries a real post-quest variant; the id index's
      // default otherwise falls back to their pre-quest standard dialogue.
      if (npcId === NpcIdentifiers.GRIMESQUIT) {
        return { page: "Grimesquit", variant: "standard-dialogue-after-the-completion-of-ratcatchers" };
      }
      if (npcId === NpcIdentifiers.PHINGSPET) {
        return { page: "Phingspet", variant: "standard-dialogue-after-the-completion-of-ratcatchers" };
      }
      if (npcId === JIMMY_NPC_ID) {
        return { page: "Jimmy Dazzler", variant: "standard-dialogue-after-completing-ratcatchers" };
      }
      if (npcId === JACK_NPC_ID) {
        return { page: "Hooknosed Jack", variant: "standard-dialogue-after-completing-ratcatchers" };
      }
      if (npcId === JOE_NPC_ID) {
        return { page: "Smokin' Joe", variant: "standard-dialogue-after-completing-ratcatchers" };
      }
      if (npcId === FACE_NPC_ID) {
        return { page: "The Face", variant: "standard-dialogue-after-ratcatchers" };
      }
      if (npcId === FELKRASH_NPC_ID) {
        return { page: "Felkrash", variant: "standard-dialogue-after-ratcatchers" };
      }
      if (POX_NPC_IDS.has(npcId)) {
        return {
          page: "Pox",
          variant: wearingCatspeakAmulet(player)
            ? "standard-dialogue-after-finishing-ratcatchers-with-a-catspeak-amulet"
            : "standard-dialogue-after-finishing-ratcatchers-without-a-catspeak-amulet",
        };
      }
      return null;
    }

    if (SISTER_NPC_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) return null;
      if (stage === STAGE_STARTED) return ratcatchers("grimesquit-phingspet-after-speaking-with-gertrude");
      if (stage === STAGE_SISTERS_TASK) {
        if (!hasGrownCat(player)) {
          return ratcatchers("grimesquit-phingspet-talking-to-the-sisters-without-your-cat-with-you");
        }
        if (ratsCaught(player) >= RATS_TO_CATCH) {
          return ratcatchers("grimesquit-phingspet-talking-to-the-sisters-after-completing-their-task");
        }
        return ratcatchers("grimesquit-phingspet-before-catching-8-rats");
      }
      return ratcatchers("grimesquit-phingspet-talking-to-the-sisters-again");
    }

    if (npcId === JIMMY_NPC_ID) {
      if (stage < STAGE_RATS_CAUGHT) return null;
      if (stage === STAGE_RATS_CAUGHT) return ratcatchers("jimmy-dazzler-s-task-after-helping-grimesquit-and-phingspet");
      if (stage <= STAGE_AT_MANOR) return ratcatchers("jimmy-dazzler-s-task-before-following-the-map");
      if (stage === STAGE_MANOR_CLEARED) return ratcatchers("jimmy-dazzler-s-task-returning-to-jimmy");
      return null;
    }

    if (npcId === JACK_NPC_ID) {
      if (stage < STAGE_JIMMY_TOLD) return null;
      if (stage === STAGE_JIMMY_TOLD) return ratcatchers("hooknosed-jack-receiving-jack-s-task");
      if (stage === STAGE_JACK_TASK) return ratcatchers("hooknosed-jack-before-poisoning-the-rat-holes");
      if (stage === STAGE_HOLES_POISONED) return ratcatchers("hooknosed-jack-after-poisoning-the-rat-holes");
      if (stage === STAGE_POX_POISONED || stage === STAGE_HAS_ANTIPOISON) {
        return ratcatchers("hooknosed-jack-returning-to-jack");
      }
      if (stage === STAGE_JACK_TOLD) return ratcatchers("hooknosed-jack-talking-to-jack-before-killing-the-king-rat");
      return ratcatchers("hooknosed-jack-returning-to-jack-2");
    }

    if (npcId === APOTHECARY_NPC_ID) {
      if (stage < STAGE_POX_POISONED) return null;
      if (stage === STAGE_POX_POISONED) return ratcatchers("hooknosed-jack-to-the-apothecary");
      if (stage === STAGE_HAS_ANTIPOISON) {
        if (held(player, CAT_ANTIPOISON_ITEM_ID)) {
          return ratcatchers("hooknosed-jack-to-the-apothecary-talking-to-the-apothecary-after-he-has-given-the-player-cat-antipoison");
        }
        if (hasAllApothecaryIngredients(player)) return ratcatchers("hooknosed-jack-to-the-apothecary");
        return ratcatchers("hooknosed-jack-to-the-apothecary-talking-to-the-apothecary-again-without-all-the-ingredients");
      }
      return null;
    }

    if (POX_NPC_IDS.has(npcId)) {
      if (stage === STAGE_POX_POISONED || stage === STAGE_HAS_ANTIPOISON) {
        return { page: "Pox", variant: "standard-dialogue-during-ratcatchers-while-pox-is-poisoned" };
      }
      return null;
    }

    if (npcId === JOE_NPC_ID) {
      if (stage < STAGE_JACK_TOLD_2) return null;
      if (stage === STAGE_JACK_TOLD_2) return ratcatchers("smokin-joe-meeting-joe");
      if (stage === STAGE_JOE_TASK) return ratcatchers("smokin-joe-talking-to-joe-again-before-smoking-out-the-rats");
      if (stage === STAGE_RATS_SMOKED) return ratcatchers("smokin-joe-returning-to-smokin-joe");
      return null;
    }

    if (npcId === FACE_NPC_ID) {
      if (stage < STAGE_JOE_TOLD) return null;
      if (stage === STAGE_JOE_TOLD) return ratcatchers("port-sarim-the-face");
      if (stage === STAGE_FELKRASH_TASK) return ratcatchers("port-sarim-returning-to-the-face-for-ideas");
      if (stage < STAGE_RATS_CHARMED) {
        return ratcatchers("port-sarim-returning-to-the-face-for-ideas-after-hearing-the-story");
      }
      return ratcatchers("back-to-port-sarim-talking-to-the-face-after-charming-the-rats");
    }

    if (npcId === FELKRASH_NPC_ID) {
      if (stage < STAGE_JOE_TOLD) return null;
      if (stage === STAGE_JOE_TOLD) return ratcatchers("port-sarim-meeting-felkrash");
      if (stage === STAGE_FELKRASH_TASK) {
        return ratcatchers("port-sarim-meeting-felkrash-speaking-with-felkrash-again-before-ridding-the-port-of-rats");
      }
      if (stage < STAGE_RATS_CHARMED) {
        return ratcatchers("port-sarim-returning-to-the-face-for-ideas-speaking-to-felkrash-after-hearing-the-face-s-story");
      }
      return ratcatchers("back-to-port-sarim-returning-to-felkrash");
    }

    if (ALI_NPC_IDS.has(npcId)) {
      if (stage === STAGE_STORY_HEARD) {
        if (held(player, SNAKE_CHARM_ITEM_ID) && held(player, MUSIC_SCROLL_ITEM_ID)) {
          return ratcatchers("learning-to-charm-animals-talking-to-the-snake-charmer-again");
        }
        return ratcatchers("learning-to-charm-animals-using-a-coin-on-the-snake-charmer-s-money-pot");
      }
      if (stage === STAGE_HAS_CHARM) {
        if (held(player, SNAKE_CHARM_ITEM_ID) && held(player, MUSIC_SCROLL_ITEM_ID)) {
          return ratcatchers("learning-to-charm-animals-talking-to-the-snake-charmer-again");
        }
        return ratcatchers("learning-to-charm-animals-reclaiming-the-snake-charm-if-lost");
      }
      return null;
    }

    if (npcId === KING_RAT_NPC_ID) {
      return ratcatchers("hooknosed-jack-fighting-the-king-rat-using-the-cat-on-the-hole-in-wall");
    }

    return null;
  }

  function answerCondition({ npcId, player, stepId, definition }) {
    if (!player || !quest || typeof stepId !== "string") return null;
    if (!isQuestSpeaker(npcId, definition)) return null;
    const stage = quest.getStage(player);
    switch (stepId) {
      case "li-06O":
        return heldAny(player, CAT_MEDAL_ITEM_IDS);
      case "ISEuKW":
      case "_XnXUZ":
      case "rRPak0":
      case "BhFO88":
        return wearingCatspeakAmulet(player);
      case "22paRj":
      case "4BWQj8":
      case "N9Bofo":
      case "YmvVQG":
        return !wearingCatspeakAmulet(player);
      case "69pSR8":
        return ratsCaught(player) > 0;
      case "pLdpkw":
        return ratsCaught(player) === 0;
      case "zR3O1D":
      case "BYgsaP":
        return player.getInventory().isFull();
      case "l4gLK1":
        return !held(player, DIRECTIONS_ITEM_ID);
      case "AFPtqQ":
        return held(player, DIRECTIONS_ITEM_ID);
      case "bo7ayW":
        return inZone(ARDOUGNE_ZONE, player.getLocation());
      case "yDwv53":
        return !inZone(ARDOUGNE_ZONE, player.getLocation());
      case "5NkB3q":
        return !hasGrownCat(player);
      case "vF77Xl":
        return stage < STAGE_MANOR_CLEARED;
      case "FNXjCb":
        return stage >= STAGE_JIMMY_TOLD;
      case "vQqpQQ":
        return heldAny(player, RAT_POISON_ITEM_IDS);
      case "D8_-jY":
        return !heldAny(player, RAT_POISON_ITEM_IDS);
      case "5oihvY":
        return hasAllPoisonIngredients(player);
      case "wtHzOM":
        return !hasAllPoisonIngredients(player);
      case "PU8SsX":
      case "35pa5j":
        return hasAllApothecaryIngredients(player);
      case "8I4xiD":
      case "f-gOyn":
        return held(player, CAT_ANTIPOISON_ITEM_ID);
      case "BjUxQ6":
      case "zOKZ9O":
        return !held(player, CAT_ANTIPOISON_ITEM_ID);
      case "jxmWwl":
        return !hasAllApothecaryIngredients(player);
      case "urtVm-":
        return heldAny(player, BEER_ITEM_IDS);
      case "t5vHT4":
        return !heldAny(player, BEER_ITEM_IDS);
      case "IiDjIT":
        return wearingCharos(player);
      case "bdEDyk":
        return !wearingCharos(player);
      case "ycyeAF":
      case "hsahNP":
        return held(player, SNAKE_CHARM_ITEM_ID);
      case "SpbdeZ":
        return !held(player, SNAKE_CHARM_ITEM_ID);
      case "NqCxPD":
        return !held(player, MUSIC_SCROLL_ITEM_ID);
      case "nqrJQU":
        return !held(player, SNAKE_CHARM_ITEM_ID) && !held(player, MUSIC_SCROLL_ITEM_ID);
      case "xdcQte":
        return !hasOvergrownCat(player);
      case "FUEPJO":
        return hasOvergrownCat(player);
      default:
        break;
    }
    // Apothecary partial-ingredient branches (checked after the all/missing cases).
    const milk = held(player, BUCKET_OF_MILK_ITEM_ID);
    const dust = held(player, UNICORN_HORN_DUST_ITEM_ID);
    const herb = held(player, MARRENTILL_ITEM_ID);
    switch (stepId) {
      case "YxIHPp":
        return !milk && !dust && !herb;
      case "JsJWNW":
        return milk && !dust && !herb;
      case "Oes1zP":
        return !milk && dust && !herb;
      case "P-9UZj":
        return !milk && !dust && herb;
      case "7MacdK":
        return milk && herb && !dust;
      case "qHPXZ9":
        return milk && dust && !herb;
      case "6XvDHd":
        return dust && herb && !milk;
      default:
        return null;
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GERTRUDE_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) setStage(player, STAGE_STARTED);
  }

  function handleGertrudeInteraction(event) {
    const { player, npcId, definition } = event;
    if (!GERTRUDE_NPC_IDS.has(npcId) || !player || !quest) return;
    const action = definition?.getActions?.()?.[event.clickType - 1];
    if (action !== "Talk-to") return;
    if (quest.getStage(player) !== 0) return;
    if (!questComplete(player, GERTRUDES_CAT_QUEST_KEY)) return;
    if (!questComplete(player, ICTHLARINS_QUEST_KEY)) return;
    if (!questStarted(player, "giant_dwarf")) return;
    const tailStage = { player, key: "a_tail_of_two_cats", stage: null };
    api.emitCustomEvent("quest:get-stage", tailStage);
    if (tailStage.stage === 3 || tailStage.stage === 4) return;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "talking-to-gertrude");
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || typeof stepId !== "string") return;
    switch (stepId) {
      case SNIFF_ACTION_ID:
        if (quest.getStage(player) === STAGE_STARTED) setStage(player, STAGE_SISTERS_TASK);
        return;
      case RAT_POLE_ACTION_ID:
        if (quest.getStage(player) < STAGE_RATS_CAUGHT) {
          if (!grantRatPole(player)) return;
          setStage(player, STAGE_RATS_CAUGHT);
        }
        return;
      case DIRECTIONS_ACTION_ID:
        if (quest.getStage(player) === STAGE_RATS_CAUGHT) {
          if (!held(player, DIRECTIONS_ITEM_ID)) player.getInventory().adds(DIRECTIONS_ITEM_ID, 1);
          setStage(player, STAGE_JIMMY_TASK);
        }
        return;
      case TELEPORT_MANOR_ACTION_ID:
        if (quest.getStage(player) <= STAGE_AT_MANOR) {
          setStage(player, STAGE_AT_MANOR);
          player.moveTo(new Location(MANSION_ARRIVAL.x, MANSION_ARRIVAL.y, MANSION_ARRIVAL.z));
        }
        return;
      case TELEPORT_ARDOUGNE_ACTION_ID:
        player.moveTo(new Location(ARDOUGNE_ARRIVAL.x, ARDOUGNE_ARRIVAL.y, ARDOUGNE_ARRIVAL.z));
        return;
      case JACK_MIXES_POISON_ACTION_ID:
        if (hasAllPoisonIngredients(player)) {
          player.getInventory().deleteNumber(VIAL_ITEM_ID, 1);
          player.getInventory().deleteNumber(KWUARM_ITEM_ID, 1);
          player.getInventory().deleteNumber(RED_SPIDERS_EGGS_ITEM_ID, 1);
          player.getInventory().adds(RAT_POISON_ITEM_ID, 1);
        }
        return;
      case APOTHECARY_MIXES_ACTION_ID:
        if (hasAllApothecaryIngredients(player)) {
          player.getInventory().deleteNumber(BUCKET_OF_MILK_ITEM_ID, 1);
          player.getInventory().deleteNumber(UNICORN_HORN_DUST_ITEM_ID, 1);
          player.getInventory().deleteNumber(MARRENTILL_ITEM_ID, 1);
          player.getInventory().adds(CAT_ANTIPOISON_ITEM_ID, 1);
          setStage(player, STAGE_HAS_ANTIPOISON);
        }
        return;
      case HAND_IN_ANTIPOISON_ACTION_ID:
        if (quest.getStage(player) === STAGE_HAS_ANTIPOISON && held(player, CAT_ANTIPOISON_ITEM_ID)) {
          player.getInventory().deleteNumber(CAT_ANTIPOISON_ITEM_ID, 1);
          setStage(player, STAGE_JACK_TOLD);
        }
        return;
      case CAT_GROWS_ACTION_ID:
        // The wiki's "Congratulations!" action sits behind an "end" marker and is
        // unreachable during replay, so completion happens on the wily-cat line.
        if (
          quest.getStage(player) === STAGE_RATS_CHARMED &&
          hasOvergrownCat(player) &&
          !quest.isComplete(player)
        ) {
          quest.complete(player);
        }
        return;
      case QUEST_COMPLETE_ACTION_ID:
        // Kept as a fallback for a transcript replay that reaches the marker.
        if (quest.getStage(player) >= STAGE_RATS_CHARMED && hasOvergrownCat(player)) {
          event.handled = true;
          event.end = true;
          if (!quest.isComplete(player)) quest.complete(player);
        }
        return;
      default:
        return;
    }
  }

  function handleChoice({ npcId, player, option }) {
    if (!player || !quest) return;
    if (npcId === KING_RAT_NPC_ID && quest.getStage(player) === STAGE_JACK_TOLD) {
      if (option === "Be careful in there, cat!" || option === "Go get that nasty rat, don't back down!") {
        setStage(player, STAGE_KING_RAT_KILLED);
      }
      return;
    }
    if (
      npcId === FACE_NPC_ID &&
      option === "I just don't think Felkrash was that impressive." &&
      quest.getStage(player) === STAGE_FELKRASH_TASK
    ) {
      setStage(player, STAGE_STORY_HEARD);
    }
  }

  function grantSnakeCharmerTools(player) {
    const cost = wearingCharos(player) ? 50 : 100;
    const inventory = player.getInventory();
    if (inventory.getAmount(COINS_ITEM_ID) < cost) {
      player.sendMessage(`You need ${cost} coins to pay the snake charmer.`);
      return;
    }
    inventory.deleteNumber(COINS_ITEM_ID, cost);
    if (!held(player, SNAKE_CHARM_ITEM_ID)) inventory.adds(SNAKE_CHARM_ITEM_ID, 1);
    if (!held(player, MUSIC_SCROLL_ITEM_ID)) inventory.adds(MUSIC_SCROLL_ITEM_ID, 1);
    setStage(player, STAGE_HAS_CHARM);
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player || !quest || typeof text !== "string") return;
    const stage = quest.getStage(player);
    if (
      stage >= STAGE_COMPLETE &&
      SISTER_NPC_IDS.has(npcId) &&
      text === "Here you go." &&
      !held(player, RAT_POLE_ITEM_ID)
    ) {
      grantRatPole(player);
      return;
    }
    if (
      npcId === JIMMY_NPC_ID &&
      (stage === STAGE_JIMMY_TASK || stage === STAGE_AT_MANOR) &&
      text.includes("Here you go, don't lose this one.")
    ) {
      if (!held(player, DIRECTIONS_ITEM_ID)) player.getInventory().adds(DIRECTIONS_ITEM_ID, 1);
      return;
    }
    if (npcId === JIMMY_NPC_ID && stage === STAGE_MANOR_CLEARED && text.includes("tell him to look out for you")) {
      setStage(player, STAGE_JIMMY_TOLD);
      return;
    }
    if (npcId === JACK_NPC_ID) {
      if (stage === STAGE_JIMMY_TOLD && text.includes("no slacking")) {
        setStage(player, STAGE_JACK_TASK);
        return;
      }
      if (stage === STAGE_HOLES_POISONED && text.includes("Go quickly.")) {
        setStage(player, STAGE_POX_POISONED);
        return;
      }
      if (stage === STAGE_KING_RAT_KILLED && text.includes("seek out Smokin' Joe")) {
        setStage(player, STAGE_JACK_TOLD_2);
      }
      return;
    }
    if (npcId === JOE_NPC_ID) {
      if (stage === STAGE_JACK_TOLD_2 && text.includes("Great. I'll get to it.")) {
        setStage(player, STAGE_JOE_TASK);
        return;
      }
      if (stage === STAGE_RATS_SMOKED && text.includes("you've earned it")) {
        setStage(player, STAGE_JOE_TOLD);
      }
      return;
    }
    if (npcId === FELKRASH_NPC_ID && stage === STAGE_JOE_TOLD && text.includes("It was worth a shot")) {
      setStage(player, STAGE_FELKRASH_TASK);
      return;
    }
    if (ALI_NPC_IDS.has(npcId)) {
      if (stage === STAGE_STORY_HEARD && text.includes("Here, take these.")) {
        grantSnakeCharmerTools(player);
        return;
      }
      if (stage === STAGE_HAS_CHARM && text.includes("There you go. Now if you don't mind")) {
        const inventory = player.getInventory();
        if (!held(player, SNAKE_CHARM_ITEM_ID)) inventory.adds(SNAKE_CHARM_ITEM_ID, 1);
        if (!held(player, MUSIC_SCROLL_ITEM_ID)) inventory.adds(MUSIC_SCROLL_ITEM_ID, 1);
      }
    }
  }

  // ==========================================================================
  // Items and objects
  // ==========================================================================

  function handleReadDirections(event) {
    const { player } = event;
    if (!player || !quest || event.itemId !== DIRECTIONS_ITEM_ID) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_JIMMY_TASK) return;
    event.handled = true;
    if (inZone(MANSION_ZONE, player.getLocation())) {
      startTranscript(
        api,
        player,
        JIMMY_NPC_ID,
        PAGE,
        stage >= STAGE_MANOR_CLEARED
          ? "jimmy-dazzler-s-task-at-the-manor-leaving-through-the-gates"
          : "jimmy-dazzler-s-task-at-the-manor-reading-the-directions-while-at-the-mansion"
      );
      return;
    }
    startTranscript(api, player, JIMMY_NPC_ID, PAGE, "jimmy-dazzler-s-task-reading-the-scroll");
  }

  function handleSnakeCharmPlay(event) {
    const { player } = event;
    if (!player || !quest || event.itemId !== SNAKE_CHARM_ITEM_ID) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_HAS_CHARM) return;
    event.handled = true;
    if (stage >= STAGE_RATS_CHARMED) {
      startTranscript(api, player, ALI_NPC_ID, PAGE, "back-to-port-sarim-playing-the-correct-song-again-after-charming-the-rats");
      return;
    }
    if (inZone(PORT_SARIM_ZONE, player.getLocation())) {
      setStage(player, STAGE_RATS_CHARMED);
      startTranscript(api, player, ALI_NPC_ID, PAGE, "back-to-port-sarim-charming-the-rats");
      return;
    }
    startTranscript(api, player, ALI_NPC_ID, PAGE, "back-to-port-sarim-attempting-to-charm-the-rats-at-the-wrong-location");
  }

  function handlePoisonedCheeseEat(event) {
    const { player } = event;
    if (!player || !quest || event.itemId !== POISONED_CHEESE_ITEM_ID) return;
    event.handled = true;
    startTranscript(api, player, JACK_NPC_ID, PAGE, "hooknosed-jack-before-poisoning-the-rat-holes-attempting-to-eat-poisoned-cheese");
  }

  function handleItemOnItem(event) {
    if (!quest) return;
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const pair = [usedItemId, usedWithItemId];
    const stage = quest.getStage(player);
    if (pair.some((itemId) => RAT_POISON_ITEM_IDS.has(itemId)) && pair.includes(CHEESE_ITEM_ID)) {
      if (stage !== STAGE_JACK_TASK) return;
      event.handled = true;
      player.getInventory().deleteNumber(CHEESE_ITEM_ID, 1);
      player.getInventory().adds(POISONED_CHEESE_ITEM_ID, 1);
      startTranscript(api, player, JACK_NPC_ID, PAGE, "hooknosed-jack-before-poisoning-the-rat-holes-poisoning-the-cheese");
      return;
    }
    const weed = pair.find((itemId) => WEEDS_ITEM_IDS.has(itemId));
    const pot = pair.find((itemId) => POT_ITEM_IDS.has(itemId));
    if (weed !== undefined && pot !== undefined) {
      if (stage !== STAGE_JOE_TASK) return;
      event.handled = true;
      player.getInventory().deleteNumber(weed, 1);
      player.getInventory().deleteNumber(pot, 1);
      player.getInventory().adds(POT_OF_WEEDS_ITEM_ID, 1);
      startTranscript(
        api,
        player,
        JOE_NPC_ID,
        PAGE,
        "smokin-joe-talking-to-joe-again-before-smoking-out-the-rats-placing-weeds-into-a-pot"
      );
      return;
    }
    if (pair.includes(TINDERBOX_ITEM_ID) && pair.includes(POT_OF_WEEDS_ITEM_ID)) {
      if (stage !== STAGE_JOE_TASK) return;
      event.handled = true;
      player.getInventory().deleteNumber(POT_OF_WEEDS_ITEM_ID, 1);
      player.getInventory().adds(SMOULDERING_POT_ITEM_ID, 1);
      // The wiki transcript has no line for this action; functional feedback only.
      player.sendMessage("You light the pot of weeds. It begins to smoulder.");
    }
  }

  function handleWarehouseHole(event, stage) {
    const { player, itemId, objectId } = event;
    if (stage === STAGE_JACK_TASK) {
      if (itemId === POISONED_CHEESE_ITEM_ID) {
        event.handled = true;
        player.getInventory().deleteNumber(POISONED_CHEESE_ITEM_ID, 1);
        const bit = WAREHOUSE_HOLE_BITS.get(objectId);
        if (bit !== undefined) {
          player.setAttribute(HOLES_ATTRIBUTE, holesMask(player) | bit);
          const index = Math.log2(bit);
          sendAuxiliaryVarbit(player, VARBIT_HOLE_IDS[index], 1);
        }
        if (allHolesPoisoned(player)) setStage(player, STAGE_HOLES_POISONED);
        startTranscript(api, player, JACK_NPC_ID, PAGE, "hooknosed-jack-poisoning-the-rat-holes");
        return;
      }
      if (itemId === CHEESE_ITEM_ID) {
        event.handled = true;
        startTranscript(
          api,
          player,
          JACK_NPC_ID,
          PAGE,
          "hooknosed-jack-before-poisoning-the-rat-holes-putting-unpoisoned-cheese-in-the-rat-hole"
        );
        return;
      }
      return;
    }
    if (
      (stage === STAGE_HOLES_POISONED || stage === STAGE_POX_POISONED) &&
      itemId === POISONED_CHEESE_ITEM_ID
    ) {
      event.handled = true;
      startTranscript(api, player, JACK_NPC_ID, PAGE, "hooknosed-jack-using-any-item-on-the-poisoned-rat-holes");
    }
  }

  function handleKingRatHole(event, stage) {
    const { player, itemId } = event;
    if (!CAT_ITEM_IDS.has(itemId)) return;
    if (stage === STAGE_JACK_TOLD) {
      event.handled = true;
      startTranscript(api, player, KING_RAT_NPC_ID, PAGE, "hooknosed-jack-fighting-the-king-rat-using-the-cat-on-the-hole-in-wall");
      return;
    }
    if (stage === STAGE_KING_RAT_KILLED) {
      event.handled = true;
      startTranscript(api, player, KING_RAT_NPC_ID, PAGE, "hooknosed-jack-fighting-the-king-rat-after-defeating-the-king-rat");
    }
  }

  function handleKeldagrimHole(event, stage) {
    const { player, itemId } = event;
    if (stage !== STAGE_JOE_TASK || itemId !== SMOULDERING_POT_ITEM_ID) return;
    event.handled = true;
    const mask = smokeMask(player);
    if ((mask & SMOKE_FIRST_BIT) === 0) {
      player.setAttribute(SMOKE_ATTRIBUTE, mask | SMOKE_FIRST_BIT);
      sendAuxiliaryVarbit(player, VARBIT_CAT_KNOWS_DRILL, 1);
      startTranscript(
        api,
        player,
        JOE_NPC_ID,
        PAGE,
        "smokin-joe-talking-to-joe-again-before-smoking-out-the-rats-using-a-smouldering-pot-on-the-rat-hole"
      );
      return;
    }
    if ((mask & SMOKE_SECOND_BIT) === 0) {
      // Quest Helper's second pot use (with RATCATCH_CATKNOWSDRILL set) is the
      // successful ambush and advances the quest; the three-use sequence left
      // the player stuck on Joe's task after the helper's last step.
      player.setAttribute(SMOKE_ATTRIBUTE, mask | SMOKE_SECOND_BIT);
      setStage(player, STAGE_RATS_SMOKED);
      startTranscript(
        api,
        player,
        catNpcId(player),
        PAGE,
        "smokin-joe-talking-to-joe-again-before-smoking-out-the-rats-smoking-out-the-rat-hole-again"
      );
    }
  }

  function handleItemOnObject(event) {
    if (!quest) return;
    const { player, objectId } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (WAREHOUSE_HOLE_BITS.has(objectId)) {
      handleWarehouseHole(event, stage);
      return;
    }
    if (objectId === KING_RAT_HOLE_OBJECT_ID) {
      handleKingRatHole(event, stage);
      return;
    }
    if (objectId === KELDAGRIM_HOLE_OBJECT_ID) {
      handleKeldagrimHole(event, stage);
      return;
    }
    if (objectId === MONEY_POT_OBJECT_ID && event.itemId === COINS_ITEM_ID) {
      if (stage !== STAGE_STORY_HEARD) return;
      event.handled = true;
      player.getInventory().deleteNumber(COINS_ITEM_ID, 1);
      startTranscript(
        api,
        player,
        ALI_NPC_ID,
        PAGE,
        "learning-to-charm-animals-using-a-coin-on-the-snake-charmer-s-money-pot"
      );
    }
  }

  function handleObjectInteraction(event) {
    if (event.objectId !== MANSION_TRELLIS_OBJECT_ID) return;
    const { player, location } = event;
    if (!player || !location) return;
    event.handled = true;
    player.moveTo(new Location(location.x, location.y - 1, 1));
  }

  function handleNpcDeath(event) {
    if (!quest) return;
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!player) return;
    const location = event.location ?? event.npc?.getLocation?.();
    if (npcName(event.npc, player) !== "Rat") return;
    const stage = quest.getStage(player);
    if (stage === STAGE_SISTERS_TASK && inZone(SEWERS_ZONE, location)) {
      const caught = ratsCaught(player) + 1;
      player.setAttribute(RATS_ATTRIBUTE, caught);
      if (caught >= RATS_TO_CATCH) {
        sendAuxiliaryVarbit(player, VARBIT_RATCATCHERS_STAGE, 15);
        startTranscript(api, player, catNpcId(player), PAGE, "grimesquit-phingspet-upon-catching-the-8th-rat");
      }
      return;
    }
    if (stage === STAGE_AT_MANOR && inZone(MANSION_ZONE, location)) {
      const caught = manorRatsCaught(player) + 1;
      player.setAttribute(MANOR_ATTRIBUTE, caught);
      const z = location?.getZ?.() ?? location?.z;
      const flag = z === 1 ? MANOR_UPPER_RAT_FLAGS.get(event.npcId) : undefined;
      if (flag !== undefined && (manorUpperRatFlags(player) & flag) === 0) {
        player.setAttribute(MANOR_UPPER_RATS_ATTRIBUTE, manorUpperRatFlags(player) | flag);
        sendAuxiliaryVarbit(player, VARBIT_CAUGHT_RAT_IDS[Math.log2(flag)], 1);
      }
      if (caught >= MANOR_RATS_TO_CATCH) {
        setStage(player, STAGE_MANOR_CLEARED);
        startTranscript(api, player, catNpcId(player), PAGE, "jimmy-dazzler-s-task-at-the-manor-after-catching-the-final-rat");
      }
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped the ratcatchers of Gielinor: the Sisters Grime,</str>",
        "<str>Jimmy Dazzler, Hooknosed Jack, Smokin' Joe and Felkrash.</str>",
        "",
        "<str>Felkrash said she would train overgrown cats into wily cats.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === STAGE_RATS_CHARMED) {
      return [
        "I charmed every rat in Port Sarim into the sea.",
        "I should speak to <col=800000>Felkrash</col> in the Port Sarim Rat Pits.",
      ];
    }
    if (stage === STAGE_STORY_HEARD) {
      return [
        "The Face let slip that Felkrash used a magic flute to",
        "charm the Port Sarim rats into the sea.",
        "They charm snakes in Pollnivneach - maybe they charm",
        "rats too. I need 100 coins (50 with a Ring of Charos(a)).",
      ];
    }
    if (stage === STAGE_FELKRASH_TASK) {
      return [
        "Felkrash wants every rat in Port Sarim dead in one action.",
        "The Face might let something slip about how she did it.",
      ];
    }
    if (stage === STAGE_JOE_TOLD) {
      return [
        "Smokin' Joe sent me to <col=800000>The Face</col> in Port Sarim",
        "to learn about training wily cats.",
      ];
    }
    if (stage === STAGE_RATS_SMOKED) {
      return [
        "My cat ambushed the rats when I smoked their hole.",
        "I should return to <col=800000>Smokin' Joe</col> in Keldagrim.",
      ];
    }
    if (stage === STAGE_JOE_TASK) {
      return [
        "Smokin' Joe needs the rats smoked out of their hole.",
        "Make a <col=800000>pot of weeds</col>, light it with a tinderbox",
        "and use the smouldering pot on the rat hole east of him.",
      ];
    }
    if (stage === STAGE_JACK_TOLD_2) {
      return [
        "Hooknosed Jack sent me to <col=800000>Smokin' Joe</col> in Keldagrim",
        "to learn more about the ratcatching business.",
      ];
    }
    if (stage === STAGE_KING_RAT_KILLED) {
      return [
        "My cat killed the King Rat in the Varrock warehouse.",
        "I should tell <col=800000>Hooknosed Jack</col>.",
      ];
    }
    if (stage === STAGE_JACK_TOLD) {
      return [
        "Jack sent me to kill the <col=800000>King Rat</col> in the",
        "warehouse south of him. Use my cat on the hole in the wall",
        "upstairs; fish can be passed through to heal it.",
      ];
    }
    if (stage === STAGE_HAS_ANTIPOISON) {
      return [
        "The Apothecary mixed a <col=800000>cat antipoison</col>.",
        "I should hurry it to <col=800000>Hooknosed Jack</col> in Varrock.",
      ];
    }
    if (stage === STAGE_POX_POISONED) {
      return [
        "Jack's cat Pox ate the poisoned rats.",
        "The <col=800000>Apothecary</col> in west Varrock can help;",
        "he needs a bucket of milk, unicorn horn dust and marrentill.",
      ];
    }
    if (stage === STAGE_HOLES_POISONED) {
      return [
        "I poisoned the four rat holes in the Varrock warehouse.",
        "I should report back to <col=800000>Hooknosed Jack</col>.",
      ];
    }
    if (stage === STAGE_JACK_TASK) {
      return [
        "Hooknosed Jack wants the warehouse rat holes poisoned.",
        "Use <col=800000>rat poison on cheese</col> (or bring Jack a vial,",
        "kwuarm and red spiders' eggs) and put it in the four holes upstairs.",
      ];
    }
    if (stage === STAGE_JIMMY_TOLD) {
      return [
        "Jimmy Dazzler sent me to <col=800000>Hooknosed Jack</col>",
        "in south-east Varrock to learn about grown cats.",
      ];
    }
    if (stage === STAGE_MANOR_CLEARED) {
      return [
        "I cleared the mansion of rats without being caught.",
        "Read the <col=800000>directions</col> to return to Ardougne",
        "and report to <col=800000>Jimmy Dazzler</col>.",
      ];
    }
    if (stage === STAGE_AT_MANOR) {
      return [
        "I followed Jimmy's directions to the mansion.",
        "I must catch the six rats inside without the guards",
        "spotting me. Read the directions to leave afterwards.",
      ];
    }
    if (stage === STAGE_JIMMY_TASK) {
      return [
        "Jimmy Dazzler gave me a map of a mansion near Ardougne.",
        "Read the <col=800000>directions</col> to travel there and",
        "clear it of rats with my cat.",
      ];
    }
    if (stage === STAGE_RATS_CAUGHT) {
      return [
        "The Sisters Grime gave me a rat pole.",
        "They said <col=800000>Jimmy Dazzler</col> in Ardougne",
        "could teach me more about ratcatching.",
      ];
    }
    if (stage === STAGE_SISTERS_TASK) {
      return [
        "The Sisters Grime want my cat to catch 8 rats",
        "in the <col=800000>Varrock Sewers</col>.",
        `Caught so far: ${ratsCaught(player)}/8.`,
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Gertrude said two ratcatchers, the Sisters Grime, are",
        "looking for adventurers with cats.",
        "They can be found in the <col=800000>Varrock Sewers</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Gertrude</col>",
      "in her house west of Varrock.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 4500);
  }

  api.persistAttribute(RATS_ATTRIBUTE, 0);
  api.persistAttribute(MANOR_ATTRIBUTE, 0);
  api.persistAttribute(MANOR_UPPER_RATS_ATTRIBUTE, 0);
  api.persistAttribute(HOLES_ATTRIBUTE, 0);
  api.persistAttribute(SMOKE_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "ratcatchers",
    name: "Ratcatchers",
    varpId: VARP_RATCATCHERS,
    varbitId: VARBIT_RATCATCHERS_STAGE,
    varbitValue: stageVarbitValue,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 4500, label: "Thieving" }],
    scrollItemId: RAT_POLE_ITEM_ID,
    rewardItemLabel: "A rat pole",
    otherRewards: [
      "The ability to train overgrown cats into wily cats",
      "Access to the Rat Pits",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("player:bootstrap-complete", syncQuestHelperProgress);
  api.onNpcInteraction(handleGertrudeInteraction);
  api.onItemAction("Directions", { Read: handleReadDirections });
  api.onItemAction("Snake charm", { Play: handleSnakeCharmPlay });
  api.onItemAction("Poisoned cheese", { Eat: handlePoisonedCheeseEat });
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
