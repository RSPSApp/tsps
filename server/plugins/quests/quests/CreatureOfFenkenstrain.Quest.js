/**
 * Creature of Fenkenstrain (members).
 *
 * The words come from the "Creature of Fenkenstrain" transcript page (plus the
 * "Gardener Ghost" and "Lord Rologarth" post-quest pages); this plugin supplies
 * the variant selector for Dr Fenkenstrain, the Gardener Ghost and the
 * creature, the prose-condition answers, the signpost start, the grave robbing
 * (spade on the graves), the amulet/bookcase/cupboard/brush/conductor gameplay,
 * the lightning repair, the monster spawn/death and the Ring of Charos ending.
 *
 * Stages (varp 399, "FENK_QUEST" in the RuneLite gameval dump):
 *   1 body parts, 2 sewing (needle + 5 thread), 3 conductor,
 *   4 creature alive, 5 creature loose, 6 creature convinced, 7 complete.
 * Per-part found/given, sewing, and clock/star/follow/mould bits are kept in
 * persisted "quest.creature_of_fenkenstrain.*" attributes.
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/quest/member/creature_of_fenkenstrain/CreatureOfFenkenstrain.kt
 * Gameplay confirmed against the OSRS Wiki quick guide (31 January 2005).
 *
 * Gaps: doors/ladders/travel are not simulated (the star-locked easternmost
 * memorial is the only cave entrance); the Gardener Ghost does not physically
 * follow the player, but digging his grave in the Haunted Woods still yields
 * the head; the costume-needle branch and the letter's readable text are not
 * reproduced; the ground pickled brain is not removed after purchase; and
 * because npc-spawns.json still carries the stale 2013-2017 Fenkenstrain ids,
 * the plugin spawns Dr Fenkenstrain, the Gardener Ghost and the monster
 * owner-only.
 */
module.exports = function registerCreatureOfFenkenstrainQuest(api) {
  const {
    Skill,
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Location,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Creature of Fenkenstrain";

  const DR_FENKENSTRAIN_NPC_ID = NpcIdentifiers.DR_FENKENSTRAIN; // 1269
  const MONSTER_NPC_ID = NpcIdentifiers.FENKENSTRAINS_MONSTER; // 1270
  const LORD_ROLOGARTH_NPC_ID = NpcIdentifiers.LORD_ROLOGARTH; // 1271
  const GARDENER_GHOST_NPC_ID = NpcIdentifiers.GARDENER_GHOST; // 1272
  const ROAVAR_NPC_ID = NpcIdentifiers.ROAVAR; // 6527
  const EXPERIMENT_NPC_IDS = new Set([
    NpcIdentifiers.EXPERIMENT, // 1273
    NpcIdentifiers.EXPERIMENT_2, // 1274
    NpcIdentifiers.EXPERIMENT_3, // 1275
  ]);

  const VARP_CREATURE_OF_FENKENSTRAIN = 399; // FENK_QUEST

  const STAGE_BODY_PARTS = 1;
  const STAGE_SEWING = 2;
  const STAGE_CONDUCTOR = 3;
  const STAGE_CREATURE_ALIVE = 4;
  const STAGE_CREATURE_LOOSE = 5;
  const STAGE_CONVINCED = 6;
  const STAGE_COMPLETE = 7;

  const GHOSTSPEAK_AMULET_IDS = new Set([
    ItemIdentifiers.GHOSTSPEAK_AMULET, // 552
    ItemIdentifiers.GHOSTSPEAK_AMULET_2, // 4250
  ]);
  const SPADE_IDS = new Set([ItemIdentifiers.SPADE, ItemIdentifiers.SPADE_2]); // 952, 953
  const BRUSH_ITEMS = new Set([
    ItemIdentifiers.GARDEN_BRUSH, // 4190 brush0
    ItemIdentifiers.EXTENDED_BRUSH, // 4191
    ItemIdentifiers.EXTENDED_BRUSH_2, // 4192
    ItemIdentifiers.EXTENDED_BRUSH_3, // 4193 (three canes)
  ]);
  const NEXT_BRUSH = new Map([
    [ItemIdentifiers.GARDEN_BRUSH, ItemIdentifiers.EXTENDED_BRUSH],
    [ItemIdentifiers.EXTENDED_BRUSH, ItemIdentifiers.EXTENDED_BRUSH_2],
    [ItemIdentifiers.EXTENDED_BRUSH_2, ItemIdentifiers.EXTENDED_BRUSH_3],
  ]);

  // Cache object ids 5156-5188 are the Fenkenstrain block (rev 237 loc dump).
  const SIGNPOST_OBJECT_ID = ObjectIdentifiers.SIGNPOST_21; // 5164
  const CLOCK_OBJECT_ID = ObjectIdentifiers.CLOCK; // 5161
  const BOOKCASE_OBJECT_ID = ObjectIdentifiers.BOOKCASE_17; // 5166
  const MEMORIAL_OBJECT_ID = ObjectIdentifiers.MEMORIAL; // 5167
  const GRAVE_OBJECT_IDS = new Set([ObjectIdentifiers.GRAVE, ObjectIdentifiers.GRAVE_2]); // 5168,5169
  const CUPBOARD_OBJECT_IDS = new Set([
    ObjectIdentifiers.CUPBOARD_29, // 5156 closed
    ObjectIdentifiers.OPEN_CUPBOARD_3, // 5157 open
  ]);
  const PILE_OF_CANES_OBJECT_ID = ObjectIdentifiers.PILE_OF_CANES; // 5158
  const CHEST_OBJECT_IDS = new Set([ObjectIdentifiers.CHEST_36, ObjectIdentifiers.CHEST_37]); // 5162,5163
  const LIGHTNING_CONDUCTOR_IDS = new Set([
    ObjectIdentifiers.LIGHTNING_CONDUCTOR, // 5176 broken
    ObjectIdentifiers.LIGHTNING_CONDUCTOR_2, // 5177 repaired
  ]);
  const FIREPLACE_OBJECT_IDS = new Set([
    ObjectIdentifiers.FIREPLACE_3, // 5165
    ObjectIdentifiers.FIREPLACE_SURROUND, // 5178
    ObjectIdentifiers.FIREPLACE_SURROUND_2, // 5179
  ]);

  const START_HOOK = "quest:creature-of-fenkenstrain:start";
  const SIGNPOST_NOTE_MESSAGE_ID = "2ZQ6Ev";
  const QUEST_STARTED_MESSAGE_ID = "QswIf0";
  const RING_STEAL_XP_ACTION_ID = "GTM4ho";
  const HEAD_RECEIVE_ACTION_ID = "4dkVij";
  const BRAIN_RECEIVE_ACTION_ID = "KK0w2z";
  const HEAD_WITH_BRAIN_ACTION_ID = "45fvPu";
  const MARBLE_RECEIVE_ACTION_ID = "T6feip";
  const OBSIDIAN_RECEIVE_ACTION_ID = "3AyrSG";
  const STAR_RECEIVE_ACTION_ID = "W49-XR";
  const TORSO_RECEIVE_ACTION_ID = "Ups3ip";
  const ARMS_RECEIVE_ACTION_ID = "nY3Vjg";
  const LEGS_RECEIVE_ACTION_ID = "kWK_ph";
  const MOULD_RECEIVE_ACTION_ID = "HVGcWZ";
  const CONDUCTOR_RECEIVE_ACTION_ID = "1tyc-N";
  const SHED_KEY_ACTION_ID = "YdgU5T";
  const BRUSH_RECEIVE_ACTION_ID = "sm2wO-";
  const LETTER_RECEIVE_ACTION_ID = "EElqdY";
  const CHEST_KEY_MESSAGE_ID = "UzDkk6";
  const GARDENER_FOLLOW_ACTION_ID = "bbby0M";
  const GARDENER_RETURN_ACTION_IDS = new Set(["O1bfvN", "lJLMRR", "zfyEVH"]);

  // Condition step ids on the page (brief "Conditions").
  const PART_CONDITIONS = new Map([
    ["DCVR7X", { bit: 1, itemId: ItemIdentifiers.DECAPITATED_HEAD_2 }], // head with brain
    ["3GHXfa", { bit: 2, itemId: ItemIdentifiers.TORSO }],
    ["C8FP_Z", { bit: 4, itemId: ItemIdentifiers.ARMS }],
    ["lEsF5c", { bit: 8, itemId: ItemIdentifiers.LEGS }],
  ]);
  const ALL_PARTS_CONDITION_ID = "5WlRUO";
  const SEWING_COMPLETE_CONDITION_ID = "_AO8vg";

  const PARTS_FOUND_ATTRIBUTE = "quest.creature_of_fenkenstrain.parts_found";
  const PARTS_GIVEN_ATTRIBUTE = "quest.creature_of_fenkenstrain.parts_given";
  const SEWING_ATTRIBUTE = "quest.creature_of_fenkenstrain.sewing";
  const FLAGS_ATTRIBUTE = "quest.creature_of_fenkenstrain.flags";

  const FLAG_CLOCK_WOUND = 1;
  const FLAG_STAR_INSERTED = 2;
  const FLAG_GARDENER_FOLLOWING = 4;
  const FLAG_MOULD_TAKEN = 8;

  /** Grave dig rewards (reference tiles). */
  const GRAVE_PARTS = [
    { x: 3503, y: 3576, bit: 2, itemId: ItemIdentifiers.TORSO, message: "... and you unearth a torso." },
    { x: 3504, y: 3576, bit: 4, itemId: ItemIdentifiers.ARMS, message: "... and you unearth a pair of arms." },
    { x: 3505, y: 3576, bit: 8, itemId: ItemIdentifiers.LEGS, message: "... and you unearth a pair of legs." },
    { x: 3608, y: 3490, bit: 1, itemId: ItemIdentifiers.DECAPITATED_HEAD, message: "... and you unearth a decapitated head." },
  ];

  /** Inscriptions keyed by the gravestone tile (reference data). */
  const GRAVE_NAMES = [
    { x: 3608, y: 3491, name: "Ed Lestwit" },
    { x: 3594, y: 3491, name: "Isla Skye" },
    { x: 3596, y: 3479, name: "Kandik Kludge" },
    { x: 3588, y: 3472, name: "Jayna Harrow" },
    { x: 3604, y: 3466, name: "Korvic Frey" },
    { x: 3608, y: 3466, name: "Marcus Harrow" },
    { x: 3619, y: 3469, name: "Anton Hayes" },
    { x: 3616, y: 3478, name: "Serra Alcanthric" },
    { x: 3631, y: 3476, name: "Petrik Corbo" },
    { x: 3639, y: 3470, name: "Jayna Corbo" },
    { x: 3629, y: 3483, name: "Eryn Treforest" },
    { x: 3634, y: 3503, name: "Domin O'Raleigh" },
    { x: 3626, y: 3495, name: "Callum Elding" },
    { x: 3593, y: 3509, name: "Elena Frey" },
    { x: 3585, y: 3497, name: "Marabella Kludge" },
    { x: 3502, y: 3576, name: "Rolomere, 14th Lord of the North Coast" },
    { x: 3504, y: 3577, name: "Rolovanne, 13th Lord of the North Coast" },
    { x: 3506, y: 3576, name: "Rologray, 12th Lord of the North Coast" },
    { x: 3542, y: 3486, name: "Unknown" },
    { x: 3541, y: 3471, name: "Unknown" },
    { x: 3572, y: 3527, name: "Unknown" },
    { x: 3576, y: 3526, name: "Unknown" },
  ];

  const CASTLE_ZONE = { minX: 3520, maxX: 3580, minY: 3520, maxY: 3590, levels: [0, 1, 2] };

  let quest;
  const npcsByPlayer = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const at = (location, x, y, radius = 0) =>
    Boolean(location) &&
    Math.abs(location.x - x) <= radius &&
    Math.abs(location.y - y) <= radius;

  function hasBit(player, attribute, bit) {
    return ((Number(player.getAttribute(attribute)) || 0) & bit) !== 0;
  }

  function setBit(player, attribute, bit) {
    player.setAttribute(attribute, (Number(player.getAttribute(attribute)) || 0) | bit);
  }

  function hasFlag(player, flag) {
    return hasBit(player, FLAGS_ATTRIBUTE, flag);
  }

  function setFlag(player, flag) {
    setBit(player, FLAGS_ATTRIBUTE, flag);
  }

  function partFound(player, bit) {
    return hasBit(player, PARTS_FOUND_ATTRIBUTE, bit) || hasBit(player, PARTS_GIVEN_ATTRIBUTE, bit);
  }

  function allPartsGiven(player) {
    const value = Number(player.getAttribute(PARTS_GIVEN_ATTRIBUTE)) || 0;
    return (value & 0xf) === 0xf;
  }

  function needleGiven(player) {
    return (Number(player.getAttribute(SEWING_ATTRIBUTE)) || 0) & 1;
  }

  function threadsGiven(player) {
    return (Number(player.getAttribute(SEWING_ATTRIBUTE)) || 0) >>> 1;
  }

  function addThreads(player, amount) {
    const value = Number(player.getAttribute(SEWING_ATTRIBUTE)) || 0;
    const needle = value & 1;
    const threads = Math.min(5, (value >>> 1) + amount);
    player.setAttribute(SEWING_ATTRIBUTE, needle | (threads << 1));
  }

  function wearingGhostspeak(player) {
    const amulet = player.getEquipment?.().get?.(Equipment.AMULET_SLOT);
    const id = amulet?.getId?.();
    return GHOSTSPEAK_AMULET_IDS.has(id);
  }

  function journalPart(player, bit, label) {
    return partFound(player, bit) ? `<str>${label}</str>` : label;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Dr Fenkenstrain hired me to assemble a creature from the</str>",
        "<str>bodies in the Morytanian graves.</str>",
        "<str>I repaired the lightning conductor and the creature was</str>",
        "<str>brought to life, but it turned on its maker.</str>",
        "<str>I stole the Ring of Charos and ended his experiments.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_CONVINCED) {
      return [
        "<str>The creature told me the truth about Fenkenstrain.</str>",
        "",
        "I must take the <col=800000>Ring of Charos</col> from",
        "<col=800000>Dr Fenkenstrain</col> to stop his experiments.",
      ];
    }
    if (stage >= STAGE_CREATURE_LOOSE) {
      return [
        "<str>I repaired the lightning conductor and the creature came alive.</str>",
        "",
        "Fenkenstrain says the creature is loose in the tower.",
        "I should deal with it - and take the fight out of it.",
      ];
    }
    if (stage >= STAGE_CREATURE_ALIVE) {
      return [
        "<str>Fenkenstrain sewed the body parts together and the creature</str>",
        "<str>was brought to life by the lightning.</str>",
        "",
        "I should speak to <col=800000>Dr Fenkenstrain</col>.",
      ];
    }
    if (stage >= STAGE_CONDUCTOR) {
      return [
        "<str>The body is sewn and waiting for the spark of life.</str>",
        "",
        "I need to repair the <col=800000>lightning conductor</col> on the",
        "balcony above the castle. A conductor can be cast from a",
        "<col=800000>silver bar</col> with the conductor mould.",
        "The mould can be brushed out of a chimney with an",
        "<col=800000>extended brush</col>.",
      ];
    }
    if (stage >= STAGE_SEWING) {
      const lines = [
        "<str>I gave Fenkenstrain the body parts.</str>",
        "",
        "He needs a <col=800000>needle</col> and <col=800000>5 lots of thread</col>",
        "to sew the parts together.",
      ];
      lines.push(needleGiven(player) ? "<str>I have given him the needle.</str>" : "I still need the needle.");
      const threads = threadsGiven(player);
      lines.push(
        threads >= 5
          ? "<str>I have given him all 5 lots of thread.</str>"
          : `I have given him ${threads}, and need ${5 - threads} more.`
      );
      return lines;
    }
    if (stage >= STAGE_BODY_PARTS) {
      return [
        "<str>I offered my grave-digging service to Dr Fenkenstrain, who</str>",
        "<str>wants body parts for a creature he plans to bring to life.</str>",
        "",
        "I need to dig up:",
        journalPart(player, 2, "a torso"),
        journalPart(player, 4, "a pair of arms"),
        journalPart(player, 8, "a pair of legs"),
        journalPart(player, 1, "a head"),
      ];
    }
    return [
      "I can start this quest by reading the <col=800000>signpost</col> in",
      "the centre of <col=800000>Canifis</col>, or by speaking to",
      "<col=800000>Dr Fenkenstrain</col> in the castle to the north-east.",
      "",
      "I must be able to defeat a <col=800000>level 51 monster</col>.",
      "Requirements: 20 Crafting, 25 Thieving,",
      "<col=800000>Priest in Peril</col> and <col=800000>The Restless Ghost</col>.",
    ];
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === DR_FENKENSTRAIN_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-dr-fenkenstrain";
      if (stage >= STAGE_CONVINCED) return "convincing-dr-fenkenstrain-to-stop-his-experiments";
      if (stage >= STAGE_CREATURE_ALIVE) {
        // The post-repair conversation sends the player to destroy the creature
        // in the tower and hands over the tower key (no action id in the dump).
        if (stage < STAGE_CREATURE_LOOSE) {
          quest.setStage(player, STAGE_CREATURE_LOOSE);
          if (!held(player, ItemIdentifiers.TOWER_KEY)) {
            player.getInventory().adds(ItemIdentifiers.TOWER_KEY, 1);
          }
          ensureMonster(player);
        }
        return "talking-to-dr-fenkenstrain-after-using-the-conductor";
      }
      if (stage >= STAGE_CONDUCTOR) {
        return "talking-to-dr-fenkenstrain-with-the-body-parts-talking-to-dr-fenkenstrain-again-after-sewing-the-body-parts-together";
      }
      if (stage >= STAGE_SEWING) {
        return "talking-to-dr-fenkenstrain-with-the-body-parts-talking-to-dr-fenkenstrain-again";
      }
      if (stage >= STAGE_BODY_PARTS) {
        const carryingPart =
          held(player, ItemIdentifiers.DECAPITATED_HEAD_2) ||
          held(player, ItemIdentifiers.TORSO) ||
          held(player, ItemIdentifiers.ARMS) ||
          held(player, ItemIdentifiers.LEGS);
        return carryingPart || allPartsGiven(player)
          ? "talking-to-dr-fenkenstrain-with-the-body-parts"
          : "dr-fenkenstrain-talking-to-dr-fenkenstrain-talking-to-dr-fenkenstrain-again";
      }
      return "dr-fenkenstrain-talking-to-dr-fenkenstrain";
    }
    if (npcId === MONSTER_NPC_ID) {
      if (stage === STAGE_CREATURE_LOOSE) {
        // First conversation sobers the creature and moves the quest on.
        quest.setStage(player, STAGE_CONVINCED);
        removeMonster(player);
        return "talking-to-the-creature-of-fenkenstrain";
      }
      if (stage === STAGE_CONVINCED) {
        return "talking-to-the-creature-of-fenkenstrain-talking-to-the-creature-of-fenkenstrain-again";
      }
      return null;
    }
    if (npcId === LORD_ROLOGARTH_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Lord Rologarth", variant: "after-creature-of-fenkenstrain" };
      }
      return null;
    }
    if (npcId === GARDENER_GHOST_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Gardener Ghost", variant: "after-creature-of-fenkenstrain" };
      }
      if (stage >= STAGE_CREATURE_ALIVE) {
        return "talking-to-the-gardener-ghost-after-using-the-conductor";
      }
      if (stage >= STAGE_SEWING) return "getting-help-from-the-gardener-ghost";
      if (stage >= STAGE_BODY_PARTS) return "decapitated-head-talking-to-the-gardener-ghost";
      return null;
    }
    return null;
  }

  /** Answer the page's prose conditions (return null for the ones we do not own). */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    if (value.includes("not wearing the amulet of ghostspeak") || value.includes("not wearing the ghostspeak amulet")) {
      return !wearingGhostspeak(player);
    }
    if (value.includes("wearing the amulet of ghostspeak") || value.includes("wearing the ghostspeak amulet")) {
      return wearingGhostspeak(player);
    }
    if (value.includes("reads the signpost")) return true;
    if (value.includes("already found the head")) {
      return (
        held(player, ItemIdentifiers.DECAPITATED_HEAD) ||
        held(player, ItemIdentifiers.DECAPITATED_HEAD_2) ||
        partFound(player, 1)
      );
    }
    if (value.includes("does not have the head")) return !partFound(player, 1);
    if (value.includes("gardener was following the player")) return hasFlag(player, FLAG_GARDENER_FOLLOWING);

    // Body-part hand-in (the first matching part is the one given this time).
    if (value.includes("brought all parts to dr fenkenstrain")) return allPartsGiven(player);
    if (value.includes("has the decapitated head with the brain")) return has(ItemIdentifiers.DECAPITATED_HEAD_2);
    if (value.includes("has the torso")) return has(ItemIdentifiers.TORSO);
    if (value.includes("has the arms")) return has(ItemIdentifiers.ARMS);
    if (value.includes("has the legs")) return has(ItemIdentifiers.LEGS);

    // Needle and thread.
    const hasNeedle = has(ItemIdentifiers.NEEDLE);
    const hasThread = has(ItemIdentifiers.THREAD);
    if (value.includes("does not have either the needle or five thread")) {
      return !hasNeedle && !hasThread && !needleGiven(player) && threadsGiven(player) === 0;
    }
    if (value.includes("has a costume needle")) return false;
    if (value.includes("only has a needle in their inventory")) return !needleGiven(player) && hasNeedle && !hasThread;
    if (value.includes("only has 1-5 thread in their inventory")) {
      const completing = needleGiven(player) && threadsGiven(player) + player.getInventory().getAmount(ItemIdentifiers.THREAD) >= 5;
      return !hasNeedle && hasThread && !completing;
    }
    if (value.includes("only brought the needle and speaks to him again")) {
      return needleGiven(player) && threadsGiven(player) < 5 && !hasThread && !hasNeedle;
    }
    if (value.includes("only brought the thread and speaks to him again")) {
      return !needleGiven(player) && threadsGiven(player) > 0 && !hasThread && !hasNeedle;
    }
    if (value.includes("brought the needle and five thread to dr fenkenstrain")) {
      return (hasNeedle || needleGiven(player)) &&
        threadsGiven(player) + player.getInventory().getAmount(ItemIdentifiers.THREAD) >= 5;
    }

    // Pickled brain and the decapitated head.
    const coins = player.getInventory().getAmount(ItemIdentifiers.COINS);
    if (value.includes("attempts to pick up the pickled brain")) {
      return !has(ItemIdentifiers.PICKLED_BRAIN) && !has(ItemIdentifiers.DECAPITATED_HEAD_2);
    }
    if (value.includes("attempts to take the pickled brain whilst having one")) {
      return has(ItemIdentifiers.PICKLED_BRAIN) || has(ItemIdentifiers.DECAPITATED_HEAD_2);
    }
    if (value.includes("does not have 50 coins")) return coins < 50;
    if (value.includes("has 50 coins")) return coins >= 50;
    if (value.includes("uses the decapitated head on the brain")) return false;

    // Amulets.
    if (value.includes("does not have the marble amulet")) {
      return !has(ItemIdentifiers.MARBLE_AMULET) && !has(ItemIdentifiers.STAR_AMULET);
    }
    if (value.includes("marble or star amulet is in the player's inventory")) {
      return has(ItemIdentifiers.MARBLE_AMULET) || has(ItemIdentifiers.STAR_AMULET);
    }
    if (value.includes("without the obsidian amulet")) {
      return !has(ItemIdentifiers.OBSIDIAN_AMULET) && !has(ItemIdentifiers.STAR_AMULET);
    }
    if (value.includes("obsidian or star amulet is in the backpack")) {
      return has(ItemIdentifiers.OBSIDIAN_AMULET) || has(ItemIdentifiers.STAR_AMULET);
    }
    if (value.includes("combines the marble and obsidian amulets")) return false;
    if (value.includes("pickpockets dr fenkenstrain")) return true;
    return null;
  }

  function startQuest(player) {
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_BODY_PARTS);
  }

  function handleHook({ player, npcId, hook }) {
    if (hook !== START_HOOK) return;
    if (npcId !== DR_FENKENSTRAIN_NPC_ID && npcId !== GARDENER_GHOST_NPC_ID) return;
    startQuest(player);
  }

  /** The grave-digging interview branch starts the quest (no hook slug in the dump). */
  function handleChoice({ player, npcId, option }) {
    if (npcId !== DR_FENKENSTRAIN_NPC_ID) return;
    if (quest.getStage(player) !== 0) return;
    if (String(option) === "Grave-digging.") startQuest(player);
  }

  /** Handing a body part over when its condition branch is chosen. */
  function handleCondition(event) {
    const { player, stepId } = event;
    if (event.npcId !== DR_FENKENSTRAIN_NPC_ID) return;
    if (stepId === ALL_PARTS_CONDITION_ID) {
      if (allPartsGiven(player) && quest.getStage(player) === STAGE_BODY_PARTS) {
        quest.setStage(player, STAGE_SEWING);
      }
      return;
    }
    if (stepId === SEWING_COMPLETE_CONDITION_ID) {
      if (held(player, ItemIdentifiers.NEEDLE)) player.getInventory().deleteNumber(ItemIdentifiers.NEEDLE, 1);
      const thread = Math.min(5, player.getInventory().getAmount(ItemIdentifiers.THREAD));
      if (thread > 0) player.getInventory().deleteNumber(ItemIdentifiers.THREAD, thread);
      if (quest.getStage(player) === STAGE_SEWING) quest.setStage(player, STAGE_CONDUCTOR);
      return;
    }
    if (stepId === "oEzclq") {
      // "Ah, a needle. Wonderful." - take the needle and remember it.
      if (held(player, ItemIdentifiers.NEEDLE)) player.getInventory().deleteNumber(ItemIdentifiers.NEEDLE, 1);
      setBit(player, SEWING_ATTRIBUTE, 1);
      return;
    }
    if (stepId === "hSMvAF") {
      // "Some thread, excellent." - take up to five lots and remember them.
      const thread = Math.min(5, player.getInventory().getAmount(ItemIdentifiers.THREAD));
      if (thread > 0) {
        player.getInventory().deleteNumber(ItemIdentifiers.THREAD, thread);
        addThreads(player, thread);
      }
      return;
    }
    const part = PART_CONDITIONS.get(stepId);
    if (!part) return;
    if (held(player, part.itemId)) player.getInventory().deleteNumber(part.itemId, 1);
    setBit(player, PARTS_GIVEN_ATTRIBUTE, part.bit);
  }

  /** Item hand-outs embedded in transcript message/action steps. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (event.kind === "message") {
      if (stepId === SIGNPOST_NOTE_MESSAGE_ID || stepId === QUEST_STARTED_MESSAGE_ID) {
        startQuest(player);
      } else if (stepId === CHEST_KEY_MESSAGE_ID) {
        if (quest.getStage(player) >= STAGE_BODY_PARTS && !held(player, ItemIdentifiers.CAVERN_KEY)) {
          player.getInventory().adds(ItemIdentifiers.CAVERN_KEY, 1);
        }
      }
      return;
    }
    const grant = (itemId) => {
      if (!held(player, itemId)) player.getInventory().adds(itemId, 1);
      event.handled = true;
    };
    switch (stepId) {
      case HEAD_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.DECAPITATED_HEAD);
        return;
      case BRAIN_RECEIVE_ACTION_ID:
        if (player.getInventory().getAmount(ItemIdentifiers.COINS) >= 50) {
          player.getInventory().deleteNumber(ItemIdentifiers.COINS, 50);
          grant(ItemIdentifiers.PICKLED_BRAIN);
        }
        return;
      case HEAD_WITH_BRAIN_ACTION_ID:
        grant(ItemIdentifiers.DECAPITATED_HEAD_2);
        return;
      case MARBLE_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.MARBLE_AMULET);
        return;
      case OBSIDIAN_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.OBSIDIAN_AMULET);
        return;
      case STAR_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.STAR_AMULET);
        return;
      case TORSO_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.TORSO);
        return;
      case ARMS_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.ARMS);
        return;
      case LEGS_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.LEGS);
        return;
      case MOULD_RECEIVE_ACTION_ID:
        setFlag(player, FLAG_MOULD_TAKEN);
        grant(ItemIdentifiers.CONDUCTOR_MOULD);
        return;
      case CONDUCTOR_RECEIVE_ACTION_ID:
        player.getSkillManager().addExperiences(Skill.CRAFTING, 50);
        grant(ItemIdentifiers.CONDUCTOR);
        return;
      case SHED_KEY_ACTION_ID:
        grant(ItemIdentifiers.SHED_KEY);
        return;
      case BRUSH_RECEIVE_ACTION_ID:
        grant(ItemIdentifiers.GARDEN_BRUSH);
        return;
      case LETTER_RECEIVE_ACTION_ID:
        setFlag(player, FLAG_CLOCK_WOUND);
        grant(ItemIdentifiers.LETTER);
        return;
      case RING_STEAL_XP_ACTION_ID:
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_CONVINCED) quest.complete(player);
        return;
      case GARDENER_FOLLOW_ACTION_ID:
        setFlag(player, FLAG_GARDENER_FOLLOWING);
        event.handled = true;
        return;
      default:
        if (GARDENER_RETURN_ACTION_IDS.has(stepId)) {
          player.setAttribute(FLAGS_ATTRIBUTE, (Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0) & ~FLAG_GARDENER_FOLLOWING);
          event.handled = true;
        }
    }
  }

  function nearestGravePart(location, radius = 2) {
    if (!location) return null;
    let best;
    for (const grave of GRAVE_PARTS) {
      const distance = Math.max(Math.abs(grave.x - location.x), Math.abs(grave.y - location.y));
      if (distance <= radius && (!best || distance < best.distance)) best = { grave, distance };
    }
    return best?.grave ?? null;
  }

  function digGrave(player, location) {
    if (![...SPADE_IDS].some((id) => held(player, id))) {
      player.sendMessage("You don't have anything to dig with.");
      return;
    }
    player.sendMessage("You start digging...");
    const grave = quest.getStage(player) >= STAGE_BODY_PARTS ? nearestGravePart(location) : null;
    if (!grave || partFound(player, grave.bit)) {
      player.sendMessage("...but the grave is empty.");
      return;
    }
    setBit(player, PARTS_FOUND_ATTRIBUTE, grave.bit);
    player.getInventory().adds(grave.itemId, 1);
    player.sendMessage(grave.message);
    if (grave.bit === 1) {
      if (hasFlag(player, FLAG_GARDENER_FOLLOWING)) {
        player.sendMessage("This is the place where I met me' maker.");
        player.setAttribute(FLAGS_ATTRIBUTE, (Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0) & ~FLAG_GARDENER_FOLLOWING);
      }
    }
  }

  function readGrave(player, location) {
    let closest;
    for (const grave of GRAVE_NAMES) {
      const distance = Math.max(Math.abs(grave.x - location.x), Math.abs(grave.y - location.y));
      if (distance <= 2 && (!closest || distance < closest.distance)) closest = { grave, distance };
    }
    if (!closest) return;
    player.sendMessage("The grave says:");
    player.sendMessage(`'Here lies ${closest.grave.name} - REST IN PEACE'`);
  }

  function repairConductor(player) {
    const stage = quest.getStage(player);
    if (stage > STAGE_CONDUCTOR) {
      player.sendMessage("The lightning conductor is now beyond repair.");
      return;
    }
    if (!held(player, ItemIdentifiers.CONDUCTOR)) {
      player.sendMessage("You don't have anything to repair the conductor with.");
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.CONDUCTOR, 1);
    player.sendMessage(
      "You repair the lightning conductor not one moment too soon - a tremendous bolt of lightning melts the new lightning conductor, and power blazes throughout the castle, if only briefly."
    );
    if (stage >= STAGE_CONDUCTOR) quest.setStage(player, STAGE_CREATURE_ALIVE);
  }

  function searchCupboard(player) {
    if (!held(player, ItemIdentifiers.GARDEN_BRUSH) && ![...BRUSH_ITEMS].some((id) => held(player, id))) {
      player.getInventory().adds(ItemIdentifiers.GARDEN_BRUSH, 1);
      player.sendMessage("You find a garden brush in the cupboard.");
    } else {
      player.sendMessage("You search the cupboard but find nothing.");
    }
  }

  function searchBookcase(player, location) {
    const west = at(location, 3542, 3558, 1);
    const east = at(location, 3555, 3558, 1);
    if (!west && !east) {
      player.sendMessage("It is a bookcase full of books.");
      return;
    }
    const itemId = west ? ItemIdentifiers.MARBLE_AMULET : ItemIdentifiers.OBSIDIAN_AMULET;
    if (held(player, itemId) || held(player, ItemIdentifiers.STAR_AMULET) || hasFlag(player, FLAG_STAR_INSERTED)) {
      player.sendMessage("The secret compartment is empty.");
      return;
    }
    player.getInventory().adds(itemId, 1);
    player.sendMessage(`You find ${west ? "a marble" : "an obsidian"} amulet in the secret compartment.`);
  }

  function pushMemorial(player, location) {
    if (at(location, 3578, 3527, 0)) {
      if (!hasFlag(player, FLAG_STAR_INSERTED)) {
        player.sendMessage("The coffin is incredible heavy, and does not budge.");
        return;
      }
      player.moveTo(new Location(3577, 9927, 0));
      return;
    }
    if (at(location, 3505, 3571, 0)) {
      player.moveTo(new Location(3504, 9969, 0));
      return;
    }
    player.sendMessage("The coffin is incredible heavy, and does not budge.");
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location, clickType } = event;
    const actions = event.definition?.getActions?.() ?? [];
    const option = String(actions[clickType - 1] ?? "").toLowerCase();

    if (objectId === SIGNPOST_OBJECT_ID) {
      event.handled = true;
      if (quest.getStage(player) >= STAGE_BODY_PARTS) {
        player.sendMessage(
          "The signpost has a note pinned onto it. The note says:'~~~Braindead Butler Position Filled~~~****No Further Applicants Please****'"
        );
        return;
      }
      startTranscript(api, player, DR_FENKENSTRAIN_NPC_ID, PAGE, "reading-the-signpost-at-the-centre-of-canifis");
      return;
    }
    if (objectId === CLOCK_OBJECT_ID) {
      event.handled = true;
      if (!hasFlag(player, FLAG_CLOCK_WOUND) && !held(player, ItemIdentifiers.LETTER)) {
        setFlag(player, FLAG_CLOCK_WOUND);
        player.getInventory().adds(ItemIdentifiers.LETTER, 1);
        player.sendMessage(
          "As you wind the old clock a letter falls out. Judging by the thick covering of dust it must have been here for some time."
        );
      } else {
        player.sendMessage("You wind the old clock.");
      }
      return;
    }
    if (objectId === BOOKCASE_OBJECT_ID) {
      event.handled = true;
      searchBookcase(player, location);
      return;
    }
    if (objectId === MEMORIAL_OBJECT_ID) {
      event.handled = true;
      if (option === "push") {
        pushMemorial(player, location);
        return;
      }
      if (at(location, 3578, 3527, 0)) {
        player.sendMessage(
          hasFlag(player, FLAG_STAR_INSERTED)
            ? "The memorial stone holds a star amulet in place on its lid."
            : "You find a depression in the memorial stone in the shape of a six-pointed star."
        );
        return;
      }
      player.sendMessage("You find nothing remarkable about the memorial stone.");
      return;
    }
    if (GRAVE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (option === "dig") digGrave(player, location);
      else readGrave(player, location);
      return;
    }
    if (CUPBOARD_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (option === "open" || option === "search") searchCupboard(player);
      return;
    }
    if (objectId === PILE_OF_CANES_OBJECT_ID) {
      event.handled = true;
      player.getInventory().adds(ItemIdentifiers.GARDEN_CANE, 1);
      player.sendMessage("You take a garden cane from the pile.");
      return;
    }
    if (CHEST_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (option === "close") return;
      if (quest.getStage(player) >= STAGE_BODY_PARTS && !held(player, ItemIdentifiers.CAVERN_KEY)) {
        player.getInventory().adds(ItemIdentifiers.CAVERN_KEY, 1);
        player.sendMessage("You take a key out of the chest.");
      } else {
        player.sendMessage("The chest is empty.");
      }
      return;
    }
    if (LIGHTNING_CONDUCTOR_IDS.has(objectId)) {
      event.handled = true;
      if (objectId === ObjectIdentifiers.LIGHTNING_CONDUCTOR_2) {
        player.sendMessage("The lightning conductor is now beyond repair.");
        return;
      }
      repairConductor(player);
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    if (SPADE_IDS.has(itemId) && GRAVE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      digGrave(player, location);
      return;
    }
    if (itemId === ItemIdentifiers.STAR_AMULET && objectId === MEMORIAL_OBJECT_ID) {
      event.handled = true;
      if (!at(location, 3578, 3527, 0)) {
        player.sendMessage("Nothing interesting happens.");
        return;
      }
      player.getInventory().deleteNumber(ItemIdentifiers.STAR_AMULET, 1);
      setFlag(player, FLAG_STAR_INSERTED);
      player.sendMessage("The star amulet fits exactly into the depression on the coffin lid.");
      return;
    }
    if (itemId === ItemIdentifiers.CONDUCTOR && LIGHTNING_CONDUCTOR_IDS.has(objectId)) {
      event.handled = true;
      repairConductor(player);
      return;
    }
    if (BRUSH_ITEMS.has(itemId) && FIREPLACE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (itemId !== ItemIdentifiers.EXTENDED_BRUSH_3) {
        player.sendMessage(
          "You stick the garden brush up the chimney, but it is not long enough to clear the blockage."
        );
        return;
      }
      if (at(location, 3544, 3555, 1) && !held(player, ItemIdentifiers.CONDUCTOR_MOULD) && !hasFlag(player, FLAG_MOULD_TAKEN)) {
        setFlag(player, FLAG_MOULD_TAKEN);
        player.getInventory().adds(ItemIdentifiers.CONDUCTOR_MOULD, 1);
        player.sendMessage("A lightning conductor mould falls down out of the chimney.");
        return;
      }
      player.sendMessage("You give the chimney a jolly good clean out.");
    }
  }

  /** Use a silver bar on any furnace with the conductor mould to cast the rod. */
  function handleSilverOnFurnace(event) {
    if (event.itemId !== ItemIdentifiers.SILVER_BAR) return;
    const { player } = event;
    event.handled = true;
    if (!held(player, ItemIdentifiers.CONDUCTOR_MOULD)) {
      player.sendMessage("You need a conductor mould to cast anything useful.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 20) {
      player.sendMessage("You need level 20 Crafting to cast the conductor.");
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.SILVER_BAR, 1);
    player.getInventory().deleteNumber(ItemIdentifiers.CONDUCTOR_MOULD, 1);
    player.getInventory().adds(ItemIdentifiers.CONDUCTOR, 1);
    player.getSkillManager().addExperiences(Skill.CRAFTING, 50);
    player.sendMessage("You pour the molten silver into the conductor mould and cast a lightning conductor.");
  }

  function extendBrush(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = new Set([usedItemId, usedWithItemId]);
    const cane = ids.has(ItemIdentifiers.GARDEN_CANE);
    const brush = [...BRUSH_ITEMS].find((id) => ids.has(id));
    if (!cane && !brush) return false;
    event.handled = true;
    if (!cane || brush === undefined) {
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    if (brush === ItemIdentifiers.EXTENDED_BRUSH_3) {
      player.sendMessage("The brush is too long to attach any more canes.");
      return true;
    }
    if (!held(player, ItemIdentifiers.BRONZE_WIRE)) {
      player.sendMessage("You try to attach the canes, but you need something suitable to hold them together.");
      return true;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 20) {
      player.sendMessage("You need level 20 Crafting to attach the cane to the brush.");
      return true;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.BRONZE_WIRE, 1);
    player.getInventory().deleteNumber(ItemIdentifiers.GARDEN_CANE, 1);
    player.getInventory().deleteNumber(brush, 1);
    player.getInventory().adds(NEXT_BRUSH.get(brush), 1);
    player.sendMessage("You attach the cane to the brush.");
    return true;
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = new Set([usedItemId, usedWithItemId]);
    if (ids.has(ItemIdentifiers.MARBLE_AMULET) && ids.has(ItemIdentifiers.OBSIDIAN_AMULET)) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.MARBLE_AMULET, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.OBSIDIAN_AMULET, 1);
      player.getInventory().adds(ItemIdentifiers.STAR_AMULET, 1);
      player.sendMessage("The marble and obsidian amulets snap together tightly to form a six-pointed amulet.");
      return;
    }
    if (ids.has(ItemIdentifiers.DECAPITATED_HEAD) && ids.has(ItemIdentifiers.PICKLED_BRAIN)) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.DECAPITATED_HEAD, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.PICKLED_BRAIN, 1);
      player.getInventory().adds(ItemIdentifiers.DECAPITATED_HEAD_2, 1);
      player.sendMessage("You squeeze the pickled brain into the decapitated head.");
      return;
    }
    if (ids.has(ItemIdentifiers.BRONZE_WIRE) && (ids.has(ItemIdentifiers.GARDEN_CANE) || [...BRUSH_ITEMS].some((id) => ids.has(id)))) {
      event.handled = true;
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (ids.has(ItemIdentifiers.GARDEN_CANE) || [...BRUSH_ITEMS].some((id) => ids.has(id))) {
      extendBrush(event);
    }
  }

  /** Spade right-click Dig while standing next to one of the quest graves. */
  function handleItemAction(event) {
    if (!SPADE_IDS.has(event.itemId)) return;
    if (String(event.option).toLowerCase() !== "dig") return;
    const grave = nearestGravePart(event.player.getLocation?.());
    if (!grave) return;
    event.handled = true;
    digGrave(event.player, event.player.getLocation());
  }

  /** Picking the pub's pickled brain opens Roavar's sale dialogue. */
  function handleGroundItemPickup(event) {
    if (event.groundItemId !== ItemIdentifiers.PICKLED_BRAIN) return;
    event.handled = true;
    startTranscript(api, event.player, ROAVAR_NPC_ID, PAGE, "decapitated-head-finding-the-brains");
  }

  /** Pickpocketing the doctor drives the Ring of Charos ending. */
  function handleNpcInteraction(event) {
    if (event.npcId !== DR_FENKENSTRAIN_NPC_ID) return;
    const actions = event.definition?.getActions?.() ?? [];
    if (String(actions[event.clickType - 1] ?? "").toLowerCase() !== "pickpocket") return;
    event.handled = true;
    const { player } = event;
    if (quest.isComplete(player)) return;
    if (quest.getStage(player) >= STAGE_CONVINCED) {
      if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < 25) {
        player.sendMessage("You need level 25 Thieving to pickpocket Dr Fenkenstrain.");
        return;
      }
      startTranscript(api, player, DR_FENKENSTRAIN_NPC_ID, PAGE, "convincing-dr-fenkenstrain-to-stop-his-experiments-stealing-the-ring-of-charos");
      return;
    }
    startTranscript(api, player, DR_FENKENSTRAIN_NPC_ID, PAGE, "dr-fenkenstrain-attempting-to-pickpocket-dr-fenkenstrain-before-starting-the-quest");
  }

  /** Experiments in the cave drop the cavern key; the monster dying convinces it. */
  function handleNpcDeath(event) {
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (EXPERIMENT_NPC_IDS.has(event.npcId)) {
      if (
        player &&
        quest.getStage(player) === STAGE_BODY_PARTS &&
        !held(player, ItemIdentifiers.CAVERN_KEY)
      ) {
        player.getInventory().adds(ItemIdentifiers.CAVERN_KEY, 1);
      }
      return;
    }
    if (event.npcId === MONSTER_NPC_ID && player && quest.getStage(player) === STAGE_CREATURE_LOOSE) {
      removeMonster(player);
      quest.setStage(player, STAGE_CONVINCED);
    }
  }

  function spawnTracked(player, key, definition) {
    const entry = npcsByPlayer.get(player) ?? {};
    if (!entry[key]) {
      const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
      if (npc) entry[key] = npc;
    }
    npcsByPlayer.set(player, entry);
  }

  function ensureQuestNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    spawnTracked(player, "doctor", { id: DR_FENKENSTRAIN_NPC_ID, x: 3551, y: 3550, z: 0, wanderRadius: 0 });
    spawnTracked(player, "gardener", { id: GARDENER_GHOST_NPC_ID, x: 3551, y: 3561, z: 0, wanderRadius: 0 });
  }

  function ensureMonster(player) {
    if (!player || quest.getStage(player) !== STAGE_CREATURE_LOOSE) return;
    spawnTracked(player, "monster", { id: MONSTER_NPC_ID, x: 3547, y: 3555, z: 2, wanderRadius: 0 });
  }

  function removeMonster(player) {
    const entry = npcsByPlayer.get(player);
    if (!entry?.monster) return;
    api.removeNpc(entry.monster);
    delete entry.monster;
  }

  function clearNpcs(player) {
    const entry = npcsByPlayer.get(player);
    if (!entry) return;
    for (const npc of Object.values(entry)) api.removeNpc(npc);
    npcsByPlayer.delete(player);
  }

  function handleZoneEnter({ player }) {
    ensureQuestNpcs(player);
    ensureMonster(player);
  }

  function handleLogout({ player }) {
    clearNpcs(player);
  }

  function handleLogin({ player }) {
    ensureQuestNpcs(player);
    ensureMonster(player);
    refreshQuestList(player);
  }

  api.persistAttribute(PARTS_FOUND_ATTRIBUTE);
  api.persistAttribute(PARTS_GIVEN_ATTRIBUTE);
  api.persistAttribute(SEWING_ATTRIBUTE);
  api.persistAttribute(FLAGS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "creature_of_fenkenstrain",
    name: "Creature of Fenkenstrain",
    varpId: VARP_CREATURE_OF_FENKENSTRAIN,
    startedValue: STAGE_BODY_PARTS,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1000, label: "Thieving" }],
    rewardItemId: ItemIdentifiers.RING_OF_CHAROS,
    rewardItemLabel: "Ring of Charos",
    otherRewards: ["Access to the Werewolf Agility Course"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnObject("Silver bar", "Furnace", handleSilverOnFurnace, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Spade", { Dig: handleItemAction });
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(CASTLE_ZONE, handleZoneEnter);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
