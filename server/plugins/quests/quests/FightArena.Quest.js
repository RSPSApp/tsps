/**
 * Fight Arena (members).
 *
 * The words come from the "Fight Arena" transcript page; this plugin supplies the
 * variant selector for Lady Servil, Hengrad, Sammy/Jeremy, Justin, the Khazard
 * guards (Head Guard and Door Guards included), Joe/Kelvin, the slaves, the
 * Spectator and General Khazard, the start hook, the prose-condition answers,
 * the armour chest and cell-key/lock object interactions, the arena-fight
 * deaths (Khazard Ogre -> Khazard Scorpion -> Bouncer -> General Khazard), the
 * jail teleports and the Lady Servil completion action.
 *
 * Stages (varp 17, RuneLite VarPlayerID.ARENAQUEST; LostCity
 * quest_arena/configs/quest_arena.constant): 1 started, 2 armour obtained,
 * 3 told of the Khali brew, 5 Head Guard drunk + cell keys, 6 Sammy freed /
 * first arena fight, 8 ogre defeated, 9 jailed, 10 scorpion defeated,
 * 11 Bouncer defeated, 12 Servils freed / Khazard attacks, 13 Khazard
 * defeated, 14 complete, 15 complete (Khazard defeated).
 * Source: https://github.com/LostCityRS/Content/tree/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/quests/quest_arena
 * Gaps: the cutscenes/camera moves and NPC pathing are not reproduced; the
 * arena beasts are not spawned or caged, so progression reads their world
 * spawns (1224/1225/1226) and their deaths; the Khazard barman (1214) is
 * indexed to the "Khazard Barman" page, whose flat transcript has no
 * Khali-brew option, so this plugin plays the Fight Arena barman branch
 * directly through startTranscript once the brew is known.
 */
module.exports = function registerFightArenaQuest(api) {
  const {
    Skill,
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const VARP_FIGHT_ARENA = 17;

  const STAGE_STARTED = 1;
  const STAGE_OBTAINED_ARMOUR = 2;
  const STAGE_TOLD_OF_BREW = 3;
  const STAGE_GIVEN_KHALI_BREW = 5;
  const STAGE_ENTERED_OGRE_FIGHT = 6;
  const STAGE_DEFEATED_OGRE = 8;
  const STAGE_SENT_JAIL = 9;
  const STAGE_DEFEATED_SCORPION = 10;
  const STAGE_DEFEATED_BOUNCER = 11;
  const STAGE_FREED_SERVILS = 12;
  const STAGE_DEFEATED_KHAZARD = 13;
  const STAGE_COMPLETE = 14;
  const STAGE_COMPLETE_DEFEATED_KHAZARD = 15;

  const KHAZARD_HELMET = ItemIdentifiers.KHAZARD_HELMET;
  const KHAZARD_ARMOUR = ItemIdentifiers.KHAZARD_ARMOUR;
  const KHAZARD_CELL_KEYS = ItemIdentifiers.KHAZARD_CELL_KEYS;
  const KHALI_BREW = ItemIdentifiers.KHALI_BREW;
  const COINS = ItemIdentifiers.COINS;

  // Fight Arena objects (cache ids 75-82; the generated names are generic).
  const ARMOUR_CHEST = ObjectIdentifiers.CHEST; // 75, shut, "Search"
  const PRISON_DOOR = ObjectIdentifiers.PRISON_GATE_3; // 79, arena_prisondoor
  const SAMMY_CELL_DOOR = ObjectIdentifiers.PRISON_GATE_4; // 80, arena_jeremydoor
  const ARENA_DOOR = ObjectIdentifiers.DOOR_9; // 82, fightarena_door2

  const KHAZARD_GUARD_IDS = new Set([
    NpcIdentifiers.KHAZARD_GUARD,
    NpcIdentifiers.KHAZARD_GUARD_3,
    NpcIdentifiers.KHAZARD_GUARD_4,
    NpcIdentifiers.KHAZARD_GUARD_2,
    NpcIdentifiers.KHAZARD_GUARD_5,
    NpcIdentifiers.KHAZARD_GUARD_6,
    NpcIdentifiers.KHAZARD_GUARD_7,
    NpcIdentifiers.KHAZARD_GUARD_8,
    NpcIdentifiers.KHAZARD_GUARD_9,
  ]);
  const HEAD_GUARD_NPC_ID = NpcIdentifiers.HEAD_GUARD;
  const DOOR_GUARD_NPC_IDS = new Set([NpcIdentifiers.DOOR_GUARD, NpcIdentifiers.DOOR_GUARD_2]);
  const JOE_KELVIN_NPC_IDS = new Set([NpcIdentifiers.JOE, NpcIdentifiers.KELVIN]);
  const SLAVE_NPC_IDS = new Set([NpcIdentifiers.SLAVE, NpcIdentifiers.SLAVE_20]);
  const SAMMY_NPC_IDS = new Set([
    NpcIdentifiers.SAMMY_SERVIL,
    NpcIdentifiers.SAMMY_SERVIL_2,
    NpcIdentifiers.SAMMY_SERVIL_3,
    1220, // ponytail: historical Jeremy/Sammy id, no generated identifier
    1221, // ponytail: historical Jeremy/Sammy id, no generated identifier
  ]);
  const LADY_SERVIL_NPC_IDS = new Set([
    NpcIdentifiers.LADY_SERVIL,
    1219, // ponytail: historical Lady Servil id, no generated identifier
  ]);
  const HENGRAD_NPC_IDS = new Set([NpcIdentifiers.HENGRAD]);
  const JUSTIN_NPC_IDS = new Set([
    NpcIdentifiers.JUSTIN_SERVIL,
    NpcIdentifiers.JUSTIN_SERVIL_2,
  ]);
  const SPECTATOR_NPC_IDS = new Set([NpcIdentifiers.SPECTATOR]);
  const GENERAL_KHAZARD_NPC_IDS = new Set([
    NpcIdentifiers.GENERAL_KHAZARD,
    NpcIdentifiers.GENERAL_KHAZARD_2,
    NpcIdentifiers.GENERAL_KHAZARD_3,
    NpcIdentifiers.GENERAL_KHAZARD_4,
    NpcIdentifiers.GENERAL_KHAZARD_5,
    NpcIdentifiers.GENERAL_KHAZARD_6,
    NpcIdentifiers.GENERAL_KHAZARD_7,
    NpcIdentifiers.GENERAL_KHAZARD_8,
    NpcIdentifiers.GENERAL_KHAZARD_9,
    NpcIdentifiers.GENERAL_KHAZARD_10,
  ]);
  const KHAZARD_OGRE_IDS = new Set([
    NpcIdentifiers.KHAZARD_OGRE,
    NpcIdentifiers.KHAZARD_OGRE_2,
    NpcIdentifiers.KHAZARD_OGRE_3,
  ]);
  const KHAZARD_SCORPION_IDS = new Set([
    NpcIdentifiers.KHAZARD_SCORPION,
    NpcIdentifiers.KHAZARD_SCORPION_2,
    NpcIdentifiers.KHAZARD_SCORPION_3,
  ]);
  const BOUNCER_IDS = new Set([
    NpcIdentifiers.BOUNCER,
    NpcIdentifiers.BOUNCER_2,
    NpcIdentifiers.BOUNCER_3,
    NpcIdentifiers.BOUNCER_4,
    NpcIdentifiers.BOUNCER_5,
    NpcIdentifiers.BOUNCER_6,
  ]);

  const KHAZARD_BARMAN_NPC_ID = NpcIdentifiers.KHAZARD_BARMAN;

  const PAGE = "Fight Arena";
  const START_HOOK = "quest:fight-arena:start";

  // Cell / arena / jail tiles from the reference coords.
  const JAIL_TILE = { x: 2605, y: 3141, z: 0 };
  const ARENA_TILE = { x: 2607, y: 3155, z: 0 };
  const GENERAL_KHAZARD_TILE = { x: 2607, y: 3156, z: 0 };

  // npc-dialogue:action step ids from the transcript.
  const BARMAN_BREW_MESSAGE_ID = "Dg8YuY";
  const HAND_BREW_MESSAGE_ID = "tRXEfT";
  const KEYS_GIVEN_MESSAGE_ID = "rUfSrN";
  const SPARE_KEYS_MESSAGE_ID = "Ck1lJV";
  const JAIL_TELEPORT_ID = "ND1rhG";
  const JAIL_RETURN_TELEPORT_ID = "CDVO1E";
  const ARENA_TELEPORT_ID = "XDkdB3";
  const KHAZARD_ATTACKS_ID = "ZGx6Rg";
  const OGRE_ATTACKS_ID = "jXf_Wp";
  const COMPLETE_ACTION_IDS = new Set([
    "VZ72SC", // after escaping Khazard
    "aAxtbU", // after defeating Khazard
  ]);

  let quest;
  const generalByPlayer = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function worn(player, slot) {
    return player.getEquipment().get(slot)?.getId?.();
  }

  function wearingArmour(player) {
    return (
      worn(player, Equipment.HEAD_SLOT) === KHAZARD_HELMET &&
      worn(player, Equipment.BODY_SLOT) === KHAZARD_ARMOUR
    );
  }

  function hasHelmet(player) {
    return held(player, KHAZARD_HELMET) || worn(player, Equipment.HEAD_SLOT) === KHAZARD_HELMET;
  }

  function hasArmour(player) {
    return held(player, KHAZARD_ARMOUR) || worn(player, Equipment.BODY_SLOT) === KHAZARD_ARMOUR;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>General Khazard's men kidnapped the Servil family</str>",
        "<str>for his Fight Arena. I rescued Sammy, fought the</str>",
        "<str>ogre, scorpion and Bouncer, and Lady Servil paid me.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_DEFEATED_KHAZARD) {
      return [
        "I defeated General Khazard in battle.",
        "I should return to <col=800000>Lady Servil</col> for my reward.",
      ];
    }
    if (stage >= STAGE_FREED_SERVILS) {
      return [
        "The Servils are free, but General Khazard is attacking me.",
        "I should defeat him or escape and speak to <col=800000>Lady Servil</col>.",
      ];
    }
    if (stage >= STAGE_DEFEATED_BOUNCER) {
      return [
        "I killed Bouncer. General Khazard is furious and attacks me.",
        "I must survive and speak to <col=800000>Lady Servil</col>.",
      ];
    }
    if (stage >= STAGE_DEFEATED_SCORPION) {
      return [
        "I defeated the Khazard Scorpion.",
        "General Khazard has set his pet <col=800000>Bouncer</col> on me.",
      ];
    }
    if (stage >= STAGE_SENT_JAIL) {
      return [
        "General Khazard locked me in his jail.",
        "I should talk to <col=800000>Hengrad</col> and fight my way out.",
      ];
    }
    if (stage >= STAGE_DEFEATED_OGRE) {
      return [
        "I defeated the Khazard Ogre and saved Justin Servil.",
        "I should talk to <col=800000>Sammy Servil</col>.",
      ];
    }
    if (stage >= STAGE_ENTERED_OGRE_FIGHT) {
      return [
        "Sammy ran into the arena to help his father.",
        "I must defeat the <col=800000>Khazard Ogre</col>.",
      ];
    }
    if (stage >= STAGE_GIVEN_KHALI_BREW) {
      return [
        "The Head Guard gave me the Khazard cell keys.",
        "I should use them on <col=800000>Sammy's cell</col> and free him.",
      ];
    }
    if (stage >= STAGE_TOLD_OF_BREW) {
      return [
        "The Head Guard wants a <col=800000>Khali brew</col>.",
        "I should buy one from the Khazard barman and give it to him.",
      ];
    }
    if (stage >= STAGE_OBTAINED_ARMOUR) {
      return [
        "I stole a set of Khazard armour from the guards' chest.",
        "I should infiltrate the Fight Arena to the south.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "General Khazard's men kidnapped Sir Servil and his son",
        "Jeremy/Sammy for the Fight Arena. I need to find them.",
        "A guard's chest in the building may hold a disguise.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Lady Servil</col>",
      "north-east of the <col=800000>Fight Arena</col>.",
      "",
      "There are no requirements, but combat level 50 is recommended.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, 12175);
    player.getSkillManager().addExperiences(Skill.THIEVING, 2175);
    player.getInventory().adds(COINS, 999); // registerQuest adds the 1,000th coin
  }

  // ==========================================================================
  // Dialogue variant selection
  // ==========================================================================

  function ladyServilVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE_DEFEATED_KHAZARD) return "the-battles-talking-to-lady-servil-after-defeating-khazard";
    if (stage >= STAGE_COMPLETE) return "the-battles-talking-to-lady-servil-after-khazard-attacks";
    if (stage >= STAGE_DEFEATED_KHAZARD) return "the-battles-talking-to-lady-servil-after-defeating-khazard";
    if (stage >= STAGE_FREED_SERVILS) return "the-battles-talking-to-lady-servil-after-khazard-attacks";
    if (stage >= STAGE_ENTERED_OGRE_FIGHT) return "the-battles-talking-to-lady-servil-after-freeing-sammy-from-the-jail";
    if (stage >= STAGE_TOLD_OF_BREW) return "getting-the-keys-talking-to-lady-servil-after-entering-the-arena";
    if (stage >= STAGE_OBTAINED_ARMOUR) return "entering-the-arena-talking-to-lady-servil-after-getting-armour";
    if (stage >= STAGE_STARTED) return "getting-started-talking-to-lady-servil-after-starting-the-quest";
    return "getting-started-talking-to-lady-servil";
  }

  function hengradVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_DEFEATED_SCORPION) {
      return "the-battles-talking-to-hengrad-in-the-jail-cell-talking-to-hengrad-after-teleporting-out-of-a-fight";
    }
    if (stage >= STAGE_SENT_JAIL) return "the-battles-talking-to-hengrad-in-the-jail-cell";
    if (stage >= STAGE_TOLD_OF_BREW) return "getting-the-keys-talking-to-hengrad";
    return "entering-the-arena-talking-to-hengrad";
  }

  function sammyVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_DEFEATED_BOUNCER) return "the-battles-upon-killing-bouncer";
    if (stage >= STAGE_DEFEATED_OGRE) return "the-battles-upon-killing-the-khazard-ogre";
    if (stage >= STAGE_GIVEN_KHALI_BREW) {
      return held(player, KHAZARD_CELL_KEYS)
        ? "getting-the-keys-talking-to-sammy-servil-after-getting-the-keys"
        : "getting-the-keys-talking-to-sammy-again";
    }
    if (stage >= STAGE_STARTED) return "getting-the-keys-talking-to-sammy-servil";
    return null;
  }

  function justinVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_SENT_JAIL) return "the-battles-talking-to-hengrad-in-the-jail-cell";
    return null;
  }

  function headGuardVariant(player) {
    const stage = quest.getStage(player);
    const wearing = wearingArmour(player);
    if (stage >= STAGE_ENTERED_OGRE_FIGHT) return "getting-the-keys-talking-to-the-head-guard-after-getting-the-keys";
    if (stage >= STAGE_GIVEN_KHALI_BREW) {
      if (!wearing) return "getting-the-keys-talking-to-the-head-guard-after-getting-him-drunk-without-khazard-armour-equipped";
      return held(player, KHAZARD_CELL_KEYS)
        ? "getting-the-keys-talking-to-the-head-guard-after-getting-the-keys"
        : "getting-the-keys-talking-to-the-head-guard-after-losing-the-keys";
    }
    if (stage >= STAGE_TOLD_OF_BREW) {
      if (!wearing) return "entering-the-arena-talking-to-the-head-guard-without-khazard-armour-equipped";
      return held(player, KHALI_BREW)
        ? "getting-the-keys-talking-to-the-head-guard-while-holding-khali-brew"
        : "entering-the-arena-talking-to-the-head-guard-again";
    }
    if (stage >= STAGE_OBTAINED_ARMOUR) {
      if (!wearing) return "entering-the-arena-talking-to-the-head-guard-without-khazard-armour-equipped";
      if (stage < STAGE_TOLD_OF_BREW) quest.setStage(player, STAGE_TOLD_OF_BREW);
      return "entering-the-arena-talking-to-the-head-guard-with-khazard-armour-equipped";
    }
    return "entering-the-arena-talking-to-the-head-guard-without-khazard-armour-equipped";
  }

  function guardVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_FREED_SERVILS) {
      return "the-battles-upon-killing-bouncer-opening-the-door-to-the-arena-after-khazard-attacks";
    }
    if (stage >= STAGE_ENTERED_OGRE_FIGHT) {
      return wearingArmour(player)
        ? "entering-the-arena-talking-to-khazard-guards-with-khazard-armour-equipped"
        : "entering-the-arena-talking-to-a-khazard-guard-inside-the-building-with-the-armour-unequipped";
    }
    if (stage >= STAGE_OBTAINED_ARMOUR) {
      return "entering-the-arena-talking-to-khazard-guard-by-the-armour-chest-after-stealing-the-armour";
    }
    return "entering-the-arena-talking-to-off-duty-khazard-guard-by-the-armour-chest";
  }

  function doorGuardVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_DEFEATED_OGRE) {
      return "the-battles-talking-to-a-spectator-after-defeating-the-ogre-talking-to-a-door-guard";
    }
    if (stage >= STAGE_STARTED) return "entering-the-arena-talking-to-the-door-guard-with-khazard-armour-equipped";
    return null;
  }

  function prisonerVariant(player) {
    return quest.getStage(player) >= STAGE_OBTAINED_ARMOUR
      ? "getting-the-keys-talking-to-joe-or-kelvin"
      : "entering-the-arena-talking-to-joe-or-kelvin";
  }

  function slaveVariant(player) {
    return quest.getStage(player) >= STAGE_OBTAINED_ARMOUR
      ? "getting-the-keys-talking-to-a-slave"
      : "entering-the-arena-talking-to-slave";
  }

  function spectatorVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_DEFEATED_BOUNCER) {
      return "the-battles-upon-killing-bouncer-talking-to-the-spectator-after-defeating-khazard";
    }
    if (stage >= STAGE_DEFEATED_OGRE) return "the-battles-talking-to-a-spectator-after-defeating-the-ogre";
    if (stage >= STAGE_ENTERED_OGRE_FIGHT) return "the-battles-talking-to-a-spectator";
    if (stage >= STAGE_OBTAINED_ARMOUR) return "entering-the-arena-talking-to-spectator-after-getting-the-armour";
    if (stage >= STAGE_STARTED) return "getting-started-talking-to-spectator-after-starting-the-quest";
    return null;
  }

  function generalKhazardVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_DEFEATED_KHAZARD) return "the-battles-upon-defeating-general-khazard";
    if (stage >= STAGE_FREED_SERVILS) return "the-battles-upon-killing-bouncer";
    if (stage >= STAGE_DEFEATED_SCORPION) return "the-battles-upon-killing-the-scorpion";
    if (stage >= STAGE_DEFEATED_OGRE) return "the-battles-upon-killing-the-khazard-ogre";
    return null;
  }

  function selectVariant({ npcId, player }) {
    if (KHAZARD_GUARD_IDS.has(npcId)) return guardVariant(player);
    if (npcId === HEAD_GUARD_NPC_ID) return headGuardVariant(player);
    if (DOOR_GUARD_NPC_IDS.has(npcId)) return doorGuardVariant(player);
    if (JOE_KELVIN_NPC_IDS.has(npcId)) return prisonerVariant(player);
    if (SLAVE_NPC_IDS.has(npcId)) return slaveVariant(player);
    if (SAMMY_NPC_IDS.has(npcId)) return sammyVariant(player);
    if (LADY_SERVIL_NPC_IDS.has(npcId)) return ladyServilVariant(player);
    if (HENGRAD_NPC_IDS.has(npcId)) return hengradVariant(player);
    if (JUSTIN_NPC_IDS.has(npcId)) return justinVariant(player);
    if (SPECTATOR_NPC_IDS.has(npcId)) return spectatorVariant(player);
    if (GENERAL_KHAZARD_NPC_IDS.has(npcId)) return generalKhazardVariant(player);
    return null;
  }

  /** Answers the Fight Arena page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("full inventory")) return player.getInventory().isFull?.() === true;
    if (
      value.includes("does not have the khazard armour equipped") ||
      value.includes("doesn't have the khazard armour equipped") ||
      value.includes("without the khazard armour equipped")
    ) {
      return !wearingArmour(player);
    }
    if (value.includes("with the khazard armour equipped") || value.includes("has the khazard armour equipped")) {
      return wearingArmour(player);
    }
    if (value.includes("5 coins")) return player.getInventory().getAmount(COINS) < 5;
    return null;
  }

  // ==========================================================================
  // Start hook / dialogue actions
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (!LADY_SERVIL_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function teleport(player, tile) {
    player.moveTo(new api.core.Location(tile.x, tile.y, tile.z));
  }

  function spawnGeneralKhazard(player) {
    if (generalByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: NpcIdentifiers.GENERAL_KHAZARD,
      x: GENERAL_KHAZARD_TILE.x,
      y: GENERAL_KHAZARD_TILE.y,
      z: GENERAL_KHAZARD_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) generalByPlayer.set(player, npc);
  }

  function removeGeneralKhazard(player) {
    const npc = generalByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    generalByPlayer.delete(player);
  }

  /** Item hand-outs and teleports hidden in transcript message/action steps. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    // `message` steps fire twice: once as an action, once with kind "message".
    if (event.kind === "message") {
      if (stepId === BARMAN_BREW_MESSAGE_ID) {
        if (player.getInventory().getAmount(COINS) >= 5) {
          player.getInventory().deleteNumber(COINS, 5);
          player.getInventory().adds(KHALI_BREW, 1);
        }
        return;
      }
      if (stepId === HAND_BREW_MESSAGE_ID) {
        if (held(player, KHALI_BREW)) player.getInventory().deleteNumber(KHALI_BREW, 1);
        if (!held(player, KHAZARD_CELL_KEYS)) player.getInventory().adds(KHAZARD_CELL_KEYS, 1);
        if (quest.getStage(player) < STAGE_GIVEN_KHALI_BREW) {
          quest.setStage(player, STAGE_GIVEN_KHALI_BREW);
        }
        return;
      }
      if (stepId === KEYS_GIVEN_MESSAGE_ID || stepId === SPARE_KEYS_MESSAGE_ID) {
        if (!held(player, KHAZARD_CELL_KEYS)) player.getInventory().adds(KHAZARD_CELL_KEYS, 1);
        if (quest.getStage(player) < STAGE_GIVEN_KHALI_BREW) {
          quest.setStage(player, STAGE_GIVEN_KHALI_BREW);
        }
        return;
      }
      return;
    }

    if (COMPLETE_ACTION_IDS.has(stepId)) {
      if (quest.isComplete(player)) {
        event.handled = true;
        event.end = true;
        return;
      }
      const defeatedKhazard = quest.getStage(player) >= STAGE_DEFEATED_KHAZARD;
      quest.complete(player);
      if (defeatedKhazard) quest.setStage(player, STAGE_COMPLETE_DEFEATED_KHAZARD);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === OGRE_ATTACKS_ID) {
      if (quest.getStage(player) < STAGE_ENTERED_OGRE_FIGHT) {
        quest.setStage(player, STAGE_ENTERED_OGRE_FIGHT);
      }
      event.handled = true;
      return;
    }
    if (stepId === JAIL_TELEPORT_ID) {
      if (quest.getStage(player) < STAGE_SENT_JAIL) quest.setStage(player, STAGE_SENT_JAIL);
      teleport(player, JAIL_TILE);
      event.handled = true;
      return;
    }
    if (stepId === ARENA_TELEPORT_ID) {
      teleport(player, ARENA_TILE);
      event.handled = true;
      return;
    }
    if (stepId === JAIL_RETURN_TELEPORT_ID) {
      teleport(player, JAIL_TILE);
      event.handled = true;
      return;
    }
    if (stepId === KHAZARD_ATTACKS_ID) {
      if (quest.getStage(player) < STAGE_FREED_SERVILS) quest.setStage(player, STAGE_FREED_SERVILS);
      spawnGeneralKhazard(player);
      event.handled = true;
    }
  }

  /** The Khazard barman's Fight Arena branch is unreachable through the index. */
  function handleNpcInteraction(event) {
    if (event.npcId !== KHAZARD_BARMAN_NPC_ID || event.handled) return;
    const actions = event.definition?.getActions?.() ?? [];
    if (String(actions[event.clickType - 1] ?? "").toLowerCase() !== "talk-to") return;
    const { player } = event;
    if (!player || quest.getStage(player) < STAGE_TOLD_OF_BREW) return;
    event.handled = true;
    startTranscript(
      api,
      player,
      KHAZARD_BARMAN_NPC_ID,
      PAGE,
      "getting-the-keys-talking-to-khazard-barman-after-learning-about-the-khali-brew"
    );
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function searchArmourChest(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) {
      player.sendMessage("The chest is securely locked.");
      return;
    }
    const helmet = hasHelmet(player);
    const armour = hasArmour(player);
    if (helmet && armour) {
      player.sendMessage("You search the chest, but find nothing.");
      return;
    }
    const missing = [];
    if (!helmet) missing.push(KHAZARD_HELMET);
    if (!armour) missing.push(KHAZARD_ARMOUR);
    if (freeSlots(player) < missing.length) {
      player.sendMessage(
        "You search the chest and find a helmet and platebody. However, you don't have enough room to take them."
      );
      return;
    }
    for (const itemId of missing) player.getInventory().adds(itemId, 1);
    if (missing.length === 2) {
      player.sendMessage("You search the chest, and find a helmet and armour of a Khazard guard.");
    } else {
      player.sendMessage(
        missing[0] === KHAZARD_HELMET
          ? "You search the chest, and find the helmet of a Khazard guard."
          : "You search the chest, and find the armour of a Khazard guard."
      );
    }
    if (stage === STAGE_STARTED) quest.setStage(player, STAGE_OBTAINED_ARMOUR);
  }

  function handleObjectInteraction(event) {
    const { objectId, player } = event;
    if (!player) return;
    if (objectId === ARMOUR_CHEST) {
      event.handled = true;
      searchArmourChest(player);
      return;
    }
    if (objectId === SAMMY_CELL_DOOR || objectId === PRISON_DOOR) {
      event.handled = true;
      player.sendMessage("The gate is securely locked.");
      return;
    }
    if (objectId === ARENA_DOOR && quest.getStage(player) < STAGE_ENTERED_OGRE_FIGHT) {
      event.handled = true;
      player.sendMessage("The door is securely locked.");
    }
  }

  function handleItemOnObject(event) {
    if (event.itemId !== KHAZARD_CELL_KEYS) return;
    const { objectId, player } = event;
    if (objectId === SAMMY_CELL_DOOR) {
      event.handled = true;
      const stage = quest.getStage(player);
      if (stage < STAGE_GIVEN_KHALI_BREW) {
        player.sendMessage("The gate is securely locked.");
        return;
      }
      if (stage === STAGE_GIVEN_KHALI_BREW) {
        player.sendMessage("You unlock Sammy's cell and Sammy steps out.");
        player.sendMessage("Sammy runs off towards the arena.");
        quest.setStage(player, STAGE_ENTERED_OGRE_FIGHT);
        return;
      }
      if (stage < STAGE_DEFEATED_BOUNCER) {
        player.sendMessage("Sammy is in the arena with his father now.");
        return;
      }
      player.sendMessage("You've already rescued Sammy from the fight arena.");
      return;
    }
    if (objectId === PRISON_DOOR) {
      event.handled = true;
      player.sendMessage("The gate is locked, but Sammy's not in there anyway.");
    }
  }

  // ==========================================================================
  // Arena fights
  // ==========================================================================

  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    if (!player) return;
    const { npcId } = event;
    const stage = quest.getStage(player);
    if (KHAZARD_OGRE_IDS.has(npcId) && stage >= STAGE_ENTERED_OGRE_FIGHT && stage < STAGE_DEFEATED_OGRE) {
      quest.setStage(player, STAGE_DEFEATED_OGRE);
      player.sendMessage("You have defeated the Khazard Ogre.");
      return;
    }
    if (KHAZARD_SCORPION_IDS.has(npcId) && stage >= STAGE_SENT_JAIL && stage < STAGE_DEFEATED_SCORPION) {
      quest.setStage(player, STAGE_DEFEATED_SCORPION);
      player.sendMessage("You have defeated the Khazard Scorpion. General Khazard releases Bouncer!");
      return;
    }
    if (BOUNCER_IDS.has(npcId) && stage >= STAGE_DEFEATED_SCORPION && stage < STAGE_DEFEATED_BOUNCER) {
      quest.setStage(player, STAGE_DEFEATED_BOUNCER);
      player.sendMessage("You have defeated Bouncer. General Khazard is furious!");
      return;
    }
    if (GENERAL_KHAZARD_NPC_IDS.has(npcId) && stage >= STAGE_FREED_SERVILS && stage < STAGE_DEFEATED_KHAZARD) {
      generalByPlayer.delete(player);
      quest.setStage(player, STAGE_DEFEATED_KHAZARD);
      player.sendMessage("General Khazard yields. The Servils are free to leave.");
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (player) removeGeneralKhazard(player);
  }

  quest = registerQuest(api, {
    key: "fight_arena",
    name: "Fight Arena",
    varpId: VARP_FIGHT_ARENA,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.ATTACK.getIndex(), amount: 12175, label: "Attack" },
      { skillId: Skill.THIEVING.getIndex(), amount: 2175, label: "Thieving" },
    ],
    rewardItemId: COINS,
    rewardItemLabel: "1,000 Coins",
    otherRewards: ["Access to the Fight Arena"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
