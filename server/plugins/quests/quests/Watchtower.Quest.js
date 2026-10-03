/**
 * Watchtower (members).
 *
 * The words come from the "Watchtower" transcript page; this plugin supplies the
 * variant selector for the Watchtower Wizard and the tower wizards, the tower
 * guard, Og, Grew, Toban, Gorad, the Gu'Tanoth guards, the city guard, the
 * skavids, the enclave guard and the ogre shamans, the prose-condition answers,
 * the start hook, the evidence hand-ins, the four power crystals (Grew, the mad
 * skavid, the sixth shaman and the Rock of Dalgroth), the ogre relic assembly,
 * the skavid riddle/language, the ogre potion and the shield-generator
 * completion.
 *
 * Stages (varp 212): 1 started, 2 fingernails shown, 3 relic assembled,
 * 4 relic shown to the north-west guard (inside Gu'Tanoth), 5 riddle given,
 * 6 riddle solved (skavid map), 7 mad skavid's crystal, 8 guard distracted with
 * cave nightshade, 9 potion recipe learned, 10 magic ogre potion, 11 all four
 * crystals, 12 complete, 14 spell scroll read.
 *
 * Per-NPC progress (task taken, item handed over, which relic parts the wizard
 * holds, skavid words learned, shaman kills) lives in the persisted
 * "quest.watchtower.bits" attribute, mirroring the reference's bit-packed varp.
 *
 * Source: LostCity quest_itwatchtower at 65b754f (pinned in issue #196).
 *
 * Gaps: the tower ladder and Gu'Tanoth gate objects are not wired (the trellis,
 * bushes, chest, lever, rock and skavid cave entrances are); the dark-cave
 * fallback, the enclave cutscene and the crystal-on-pillar placement are not
 * simulated (the lever completes the quest directly); the "Gor cur" skavid that
 * teaches "Ar" is absent from the transcript dump, so the mad skavid accepts
 * the three teachable words; guard gate/bridge/southern roles are best-effort
 * from their spawn coordinates; the rock cake source and the bank-storage
 * branches rely on the shared item/bank systems.
 */
module.exports = function registerWatchtowerQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Watchtower";

  const VARP_WATCHTOWER = 212;
  const STAGE_STARTED = 1;
  const STAGE_GIVEN_FINGERNAILS = 2;
  const STAGE_MADE_RELIC = 3;
  const STAGE_GIVEN_RELIC = 4;
  const STAGE_GIVEN_RIDDLE = 5;
  const STAGE_SOLVED_RIDDLE = 6;
  const STAGE_SKAVID_CRYSTAL = 7;
  const STAGE_FED_NIGHTSHADE = 8;
  const STAGE_LEARNED_POTION = 9;
  const STAGE_MADE_POTION = 10;
  const STAGE_FOUND_ALL_CRYSTALS = 11;
  const STAGE_COMPLETE = 12;
  const STAGE_READ_SCROLL = 14;

  const BITS_ATTRIBUTE = "quest.watchtower.bits";
  const OBJECT_ATTRIBUTE = "quest.watchtower.object";
  const VARIANT_ATTRIBUTE = "quest.watchtower.variant";

  const BIT_SPOKEN_TOBAN = 0;
  const BIT_HELPED_TOBAN = 1;
  const BIT_SPOKEN_GREW = 2;
  const BIT_HELPED_GREW = 3;
  const BIT_SPOKEN_OG = 4;
  const BIT_HELPED_OG = 5;
  const BIT_RELIC = [6, 7, 8];
  const BIT_LOOKING_RELIC = 9;
  const BIT_MARKET_WANTS = 10;
  const BIT_MARKET_GIVEN = 11;
  const BIT_LEARNING_SKAVID = 12;
  const BIT_LEARNED_AR = 13;
  const BIT_LEARNED_IG = 14;
  const BIT_LEARNED_CUR = 15;
  const BIT_LEARNED_NOD = 16;
  const BIT_GORAD_DEAD = 17;
  const BIT_KILLS_SHIFT = 18;
  const KILLS_MASK = 0x7;
  const MAX_SHAMAN_KILLS = 6;

  const WIZARD_ID = NpcIdentifiers.WATCHTOWER_WIZARD;
  const OTHER_WIZARD_IDS = new Set([
    NpcIdentifiers.WIZARD_4,
    NpcIdentifiers.WIZARD_5,
    NpcIdentifiers.WIZARD_6,
  ]);
  const TOWER_GUARD_ID = NpcIdentifiers.TOWER_GUARD;
  const CHIEFTAIN_ID = NpcIdentifiers.OGRE_CHIEFTAIN;
  const OG_ID = NpcIdentifiers.OG;
  const GREW_ID = NpcIdentifiers.GREW;
  const TOBAN_ID = NpcIdentifiers.TOBAN;
  const GORAD_ID = NpcIdentifiers.GORAD;
  const ENTRANCE_GUARD_IDS = new Set([NpcIdentifiers.OGRE_GUARD_3, NpcIdentifiers.OGRE_GUARD_5]);
  const SOUTHERN_GUARD_IDS = new Set([NpcIdentifiers.OGRE_GUARD_6]);
  const MARKET_GUARD_IDS = new Set([NpcIdentifiers.OGRE_GUARD_7]);
  const BRIDGE_GUARD_IDS = new Set([NpcIdentifiers.OGRE_GUARD_4]);
  const CITY_GUARD_ID = NpcIdentifiers.CITY_GUARD;
  const SCARED_SKAVID_ID = NpcIdentifiers.SCARED_SKAVID;
  const MAD_SKAVID_ID = NpcIdentifiers.MAD_SKAVID;
  const SKAVID_VARIANTS = new Map([
    [NpcIdentifiers.SKAVID_2, "skavid-search-learning-skavid-skavid-2"],
    [NpcIdentifiers.SKAVID_3, "skavid-search-learning-skavid-skavid-1"],
    [NpcIdentifiers.SKAVID_4, "skavid-search-learning-skavid-skavid-1"],
    [NpcIdentifiers.SKAVID_5, "skavid-search-learning-skavid-skavid-3"],
    [NpcIdentifiers.SKAVID_6, "skavid-search-learning-skavid-skavid-2"],
  ]);
  const ENCLAVE_GUARD_ID = NpcIdentifiers.ENCLAVE_GUARD;
  const SHAMAN_IDS = new Set([
    NpcIdentifiers.OGRE_SHAMAN_3,
    NpcIdentifiers.OGRE_SHAMAN_4,
    NpcIdentifiers.OGRE_SHAMAN_5,
    NpcIdentifiers.OGRE_SHAMAN_6,
    NpcIdentifiers.OGRE_SHAMAN_7,
    NpcIdentifiers.OGRE_SHAMAN_8,
    NpcIdentifiers.OGRE_SHAMAN_9,
    NpcIdentifiers.OGRE_SHAMAN_10,
    NpcIdentifiers.OGRE_SHAMAN_11,
    NpcIdentifiers.OGRE_SHAMAN_12,
    NpcIdentifiers.OGRE_SHAMAN_13,
    NpcIdentifiers.OGRE_SHAMAN_14,
    NpcIdentifiers.OGRE_SHAMAN_15,
    NpcIdentifiers.OGRE_SHAMAN_16,
  ]);

  const FINGERNAILS = ItemIdentifiers.FINGERNAILS;
  const OLD_ROBE = ItemIdentifiers.OLD_ROBE;
  const UNUSUAL_ARMOUR = ItemIdentifiers.UNUSUAL_ARMOUR;
  const DAMAGED_DAGGER = ItemIdentifiers.DAMAGED_DAGGER;
  const TATTERED_EYE_PATCH = ItemIdentifiers.TATTERED_EYE_PATCH;
  const EVIDENCE_IDS = [FINGERNAILS, OLD_ROBE, UNUSUAL_ARMOUR, DAMAGED_DAGGER, TATTERED_EYE_PATCH];
  const DECOY_EVIDENCE_IDS = [OLD_ROBE, UNUSUAL_ARMOUR, DAMAGED_DAGGER, TATTERED_EYE_PATCH];
  const RELIC_PART_IDS = [
    ItemIdentifiers.RELIC_PART_1,
    ItemIdentifiers.RELIC_PART_2,
    ItemIdentifiers.RELIC_PART_3,
  ];
  const OGRE_RELIC = ItemIdentifiers.OGRE_RELIC;
  const SKAVID_MAP = ItemIdentifiers.SKAVID_MAP;
  const OGRE_TOOTH = ItemIdentifiers.OGRE_TOOTH;
  const TOBANS_KEY = ItemIdentifiers.TOBANS_KEY;
  const TOBANS_GOLD = ItemIdentifiers.TOBANS_GOLD;
  const ROCK_CAKE = ItemIdentifiers.ROCK_CAKE;
  const CRYSTAL_1 = ItemIdentifiers.CRYSTAL;
  const CRYSTAL_2 = ItemIdentifiers.CRYSTAL_2;
  const CRYSTAL_3 = ItemIdentifiers.CRYSTAL_3;
  const CRYSTAL_4 = ItemIdentifiers.CRYSTAL_4;
  const CRYSTAL_IDS = [CRYSTAL_1, CRYSTAL_2, CRYSTAL_3, CRYSTAL_4];
  const CAVE_NIGHTSHADE = ItemIdentifiers.CAVE_NIGHTSHADE;
  const MAGIC_OGRE_POTION = ItemIdentifiers.MAGIC_OGRE_POTION;
  const SPELL_SCROLL = ItemIdentifiers.SPELL_SCROLL;
  const DRAGON_BONES = ItemIdentifiers.DRAGON_BONES;
  const DEATH_RUNE = ItemIdentifiers.DEATH_RUNE;
  const COINS = ItemIdentifiers.COINS;
  const TINDERBOX = ItemIdentifiers.TINDERBOX;
  const VIAL_OF_WATER = ItemIdentifiers.VIAL_OF_WATER;
  const JANGERBERRIES = ItemIdentifiers.JANGERBERRIES;
  const GUAM_LEAF = ItemIdentifiers.GUAM_LEAF;
  const GUAM_POTION_UNF = ItemIdentifiers.GUAM_POTION_UNF_;
  const JANGER_VIAL = ItemIdentifiers.VIAL_3;
  const GUAM_JANGER_VIAL = ItemIdentifiers.VIAL_4;
  const OGRE_POTION = ItemIdentifiers.POTION_3;
  const GROUND_BAT_BONES = ItemIdentifiers.GROUND_BAT_BONES;

  const LIGHT_SOURCES = new Set([
    ItemIdentifiers.LIT_CANDLE,
    ItemIdentifiers.LIT_TORCH,
    ItemIdentifiers.CANDLE_LANTERN,
    ItemIdentifiers.OIL_LANTERN,
    ItemIdentifiers.BULLSEYE_LANTERN,
    ItemIdentifiers.SAPPHIRE_LANTERN,
    ItemIdentifiers.LIT_BUG_LANTERN,
    ItemIdentifiers.BRUMA_TORCH,
  ]);

  const BUSH_IDS = new Set([
    ObjectIdentifiers.BUSH_11,
    ObjectIdentifiers.BUSH_12,
    ObjectIdentifiers.BUSH_13,
    ObjectIdentifiers.BUSH_14,
    ObjectIdentifiers.BUSH_15,
    ObjectIdentifiers.BUSH_16,
  ]);
  const BUSH_ITEMS = new Map([
    [ObjectIdentifiers.BUSH_12, FINGERNAILS],
    [ObjectIdentifiers.BUSH_13, DAMAGED_DAGGER],
    [ObjectIdentifiers.BUSH_14, TATTERED_EYE_PATCH],
    [ObjectIdentifiers.BUSH_15, OLD_ROBE],
    [ObjectIdentifiers.BUSH_16, UNUSUAL_ARMOUR],
  ]);
  const TRELLIS_IDS = new Set([ObjectIdentifiers.TRELLIS_3, ObjectIdentifiers.TRELLIS_4]);
  const LEVER_ID = ObjectIdentifiers.LEVER_17;
  const CHEST_ID = ObjectIdentifiers.CHEST_23;
  const ROCK_ID = ObjectIdentifiers.ROCK_OF_DALGROTH;
  const CAVE_ENTRANCES = new Map([
    [ObjectIdentifiers.CAVE_ENTRANCE_6, { x: 2498, y: 9418 }],
    [ObjectIdentifiers.CAVE_ENTRANCE_7, { x: 2532, y: 9469 }],
    [ObjectIdentifiers.CAVE_ENTRANCE_8, { x: 2518, y: 9455 }],
    [ObjectIdentifiers.CAVE_ENTRANCE_9, { x: 2498, y: 9451 }],
    [ObjectIdentifiers.CAVE_ENTRANCE_10, { x: 2504, y: 9441 }],
    [ObjectIdentifiers.CAVE_ENTRANCE_11, { x: 2522, y: 9411 }],
  ]);
  const CAVE_EXITS = new Map([
    [ObjectIdentifiers.CAVE_EXIT_2, { x: 2562, y: 3024 }],
    [ObjectIdentifiers.CAVE_EXIT_3, { x: 2524, y: 3070 }],
    [ObjectIdentifiers.CAVE_EXIT_4, { x: 2540, y: 3054 }],
    [ObjectIdentifiers.CAVE_EXIT_5, { x: 2553, y: 3054 }],
    [ObjectIdentifiers.CAVE_EXIT_6, { x: 2552, y: 3034 }],
    [ObjectIdentifiers.CAVE_EXIT_7, { x: 2529, y: 3013 }],
  ]);
  const RECEIVE_ITEMS = new Map([
    ["dQ-zw3", FINGERNAILS],
    ["C8UbfC", OLD_ROBE],
    ["Xje1jx", UNUSUAL_ARMOUR],
    ["Bt1nR2", DAMAGED_DAGGER],
    ["h6thcG", TATTERED_EYE_PATCH],
    ["-QBFep", SKAVID_MAP],
    ["IAWRsb", SPELL_SCROLL],
  ]);
  const HAND_IN_RELIC_STEPS = new Map([
    ["c6SUn4", 0],
    ["XLwHKL", 1],
    ["Dp7Zpc", 2],
  ]);

  const START_HOOK = "quest:watchtower:start";

  let quest;

  function bits(player) {
    const value = Number(player.getAttribute(BITS_ATTRIBUTE));
    return Number.isFinite(value) ? value | 0 : 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & (1 << bit)) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | (1 << bit));
  }

  function shamanKills(player) {
    return (bits(player) >>> BIT_KILLS_SHIFT) & KILLS_MASK;
  }

  function setShamanKills(player, kills) {
    const value = bits(player);
    const next = (value & ~(KILLS_MASK << BIT_KILLS_SHIFT)) | ((kills & KILLS_MASK) << BIT_KILLS_SHIFT);
    player.setAttribute(BITS_ATTRIBUTE, next | 0);
  }

  function learnedWords(player) {
    return [BIT_LEARNED_AR, BIT_LEARNED_IG, BIT_LEARNED_CUR, BIT_LEARNED_NOD].filter((bit) =>
      hasBit(player, bit)
    ).length;
  }

  function relicPartsHeld(player) {
    return BIT_RELIC.filter((bit) => hasBit(player, bit)).length;
  }

  function held(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function bankAmount(player, itemId) {
    try {
      const bank = player.getBank?.();
      return Number(bank?.getAmount?.(itemId) ?? 0);
    } catch {
      return 0;
    }
  }

  function give(player, itemId) {
    if (!held(player, itemId)) player.getInventory().adds(itemId, 1);
  }

  function remove(player, itemId) {
    if (held(player, itemId)) player.getInventory().deleteNumber(itemId, 1);
  }

  function allCrystals(player) {
    return CRYSTAL_IDS.every((itemId) => held(player, itemId));
  }

  function hasLightSource(player) {
    for (const itemId of LIGHT_SOURCES) if (held(player, itemId)) return true;
    return false;
  }

  function bushObject(player) {
    const value = Number(player.getAttribute(OBJECT_ATTRIBUTE));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function normalized(text) {
    return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I recovered the four power crystals and restored the</str>",
        "<str>Watchtower shield, saving Yanille from the ogres.</str>",
        "",
        stage >= STAGE_READ_SCROLL
          ? "<str>I read the spell scroll and can cast Watchtower Teleport.</str>"
          : "I should read the spell scroll the wizard gave me.",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to the",
        "<col=800000>Watchtower Wizard</col> on the top floor of the",
        "Watchtower north of Yanille. I can climb the",
        "<col=800000>trellis</col> on the north wall (18 Agility).",
        "",
        "To complete this quest I need:",
        "Level 14 Magic, 14 Herblore, 15 Thieving, 40 Mining and 25 Agility.",
      ];
    }
    if (stage === STAGE_STARTED) {
      return [
        "The Watchtower's power crystals were stolen.",
        "I should search the <col=800000>bushes</col> north of the",
        "Watchtower for evidence.",
      ];
    }
    if (stage === STAGE_GIVEN_FINGERNAILS) {
      return [
        "<str>I found skavid fingernails and showed them to the wizard.</str>",
        "",
        "I must deal with the tribal ogres around Gu'Tanoth",
        "and find a way into the city of the ogres.",
      ];
    }
    if (stage === STAGE_MADE_RELIC) {
      return [
        "<str>I assembled the ogre relic for the wizard.</str>",
        "",
        "I should use the <col=800000>relic</col> to trick my way",
        "past the guards at <col=800000>Gu'Tanoth</col>.",
      ];
    }
    if (stage === STAGE_GIVEN_RELIC || stage === STAGE_GIVEN_RIDDLE) {
      const lines = ["<str>I entered Gu'Tanoth using the ogre relic.</str>", ""];
      if (stage === STAGE_GIVEN_RIDDLE) {
        lines.push("A city guard has set me a riddle: bring the item");
        lines.push("whose letters his poem describes.");
      } else {
        lines.push("I need a <col=800000>map</col> of the skavid caves.");
        lines.push("The city guards in the market may know more.");
      }
      return lines;
    }
    if (stage === STAGE_SOLVED_RIDDLE) {
      const lines = [
        "<str>A guard's riddle won me a map of the skavid caves.</str>",
        "",
        "I need a <col=800000>light source</col> and the map",
        "to search the skavid caves for the next crystal.",
      ];
      if (hasBit(player, BIT_LEARNING_SKAVID)) {
        lines.push("A scared skavid is teaching me their language:");
        lines.push("ar, nod, gor, ig, cur.");
      }
      lines.push(`I have learned ${learnedWords(player)} of the skavid words.`);
      return lines;
    }
    if (stage === STAGE_SKAVID_CRYSTAL) {
      return [
        "<str>The mad skavid gave me a crystal for speaking skavid.</str>",
        "",
        "I need to get into the <col=800000>shamans' enclave</col>.",
        "The wizard says <col=800000>cave nightshade</col> will distract",
        "the enclave guard.",
      ];
    }
    if (stage === STAGE_FED_NIGHTSHADE) {
      return [
        "<str>I distracted the enclave guard with cave nightshade.</str>",
        "",
        "The shamans are protected by magic. I should ask the",
        "Watchtower Wizard for advice.",
      ];
    }
    if (stage === STAGE_LEARNED_POTION) {
      return [
        "The wizard told me how to make a potion to destroy the",
        "shamans: <col=800000>guam leaf</col>, <col=800000>jangerberries</col>",
        "and <col=800000>ground bat bones</col> (14 Herblore).",
        held(player, OGRE_POTION)
          ? "I have mixed the potion and must have it enchanted."
          : "I must mix the potion and take it to the wizard.",
      ];
    }
    if (stage === STAGE_MADE_POTION) {
      const lines = [
        "<str>The wizard enchanted the ogre potion for me.</str>",
        "",
        `I must destroy ${Math.max(0, MAX_SHAMAN_KILLS - shamanKills(player))} more ogre shaman(s) with it.`,
      ];
      if (shamanKills(player) >= MAX_SHAMAN_KILLS) {
        lines.push("The shamans are dead; I can mine the");
        lines.push("<col=800000>Rock of Dalgroth</col> for the last crystal.");
      }
      return lines;
    }
    if (stage === STAGE_FOUND_ALL_CRYSTALS) {
      return [
        "<str>I have all four power crystals.</str>",
        "",
        "I should pull the <col=800000>lever</col> on the top floor",
        "of the Watchtower to activate the shield generator.",
      ];
    }
    return [
      "I helped the wizards of Yanille restore the Watchtower.",
      "I should return all four crystals to the wizard.",
    ];
  }

  function grantReward(player) {
    player.getInventory().adds(COINS, 5000);
  }

  function selectOgVariant(player, stage) {
    if (stage < STAGE_GIVEN_FINGERNAILS || stage >= STAGE_MADE_RELIC) return null;
    if (hasBit(player, BIT_HELPED_OG)) return "ogre-investigations-og-speaking-to-og-after-giving-him-toban-s-gold";
    if (hasBit(player, BIT_SPOKEN_OG)) return "ogre-investigations-og-speaking-to-og-again";
    return "ogre-investigations-og";
  }

  function selectGrewVariant(player, stage) {
    if (stage < STAGE_GIVEN_FINGERNAILS || stage >= STAGE_MADE_RELIC) return null;
    if (hasBit(player, BIT_HELPED_GREW)) {
      return "ogre-investigations-grew-speaking-to-grew-after-giving-him-gorad-s-tooth";
    }
    if (hasBit(player, BIT_SPOKEN_GREW)) return "ogre-investigations-grew-speaking-to-grew-again";
    return "ogre-investigations-grew";
  }

  function selectTobanVariant(player, stage) {
    if (stage < STAGE_GIVEN_FINGERNAILS || stage >= STAGE_MADE_RELIC) return null;
    if (hasBit(player, BIT_HELPED_TOBAN)) {
      return "ogre-investigations-toban-speaking-to-toban-after-giving-him-dragon-bones";
    }
    if (hasBit(player, BIT_SPOKEN_TOBAN)) return "ogre-investigations-toban-speaking-to-toban-again";
    return "ogre-investigations-toban";
  }

  function selectWizardVariant(player, stage) {
    if (stage <= 0) return "getting-started-speaking-to-the-watchtower-wizard";
    if (stage === STAGE_STARTED) return "searching-for-evidence-talking-to-the-watchtower-wizard";
    if (stage === STAGE_GIVEN_FINGERNAILS) return "ogre-investigations-talking-to-the-watchtower-wizard";
    if (stage === STAGE_MADE_RELIC) return "ogre-investigations-talking-to-the-watchtower-wizard-again";
    if (stage === STAGE_GIVEN_RELIC || stage === STAGE_GIVEN_RIDDLE) {
      return "entering-gu-tanoth-talking-to-the-watchtower-wizard-after-gaining-access-to-the-city";
    }
    if (stage === STAGE_SOLVED_RIDDLE) {
      return "skavid-search-talking-to-the-watchtower-wizard-after-getting-the-skavid-map";
    }
    if (stage === STAGE_SKAVID_CRYSTAL) {
      return "skavid-search-talking-to-the-watchtower-wizard-after-learning-to-navigate-the-skavid-caves";
    }
    if (stage === STAGE_FED_NIGHTSHADE) {
      return "entering-the-enclave-talking-to-the-watchtower-wizard-after-discovering-the-shamans-are-invincible";
    }
    if (stage === STAGE_LEARNED_POTION) {
      if (held(player, OGRE_POTION)) {
        remove(player, OGRE_POTION);
        player.getInventory().adds(MAGIC_OGRE_POTION, 1);
        player.sendMessage("The wizard infuses the potion with magic.");
        quest.setStage(player, STAGE_MADE_POTION);
        return "entering-the-enclave-talking-to-the-watchtower-wizard-after-making-the-potion";
      }
      return "entering-the-enclave-talking-to-the-watchtower-wizard-after-discovering-the-shamans-are-invincible-talking-to-the-watchtower-wizard-again";
    }
    if (stage === STAGE_MADE_POTION) {
      if (allCrystals(player)) {
        quest.setStage(player, STAGE_FOUND_ALL_CRYSTALS);
        return "reviving-the-watchtower-talking-to-the-watchtower-wizard-with-all-the-crystals";
      }
      if (shamanKills(player) >= MAX_SHAMAN_KILLS) {
        return "entering-the-enclave-returning-to-the-watchtower-wizard-after-killing-the-shamans-without-mining-the-rock";
      }
      return "entering-the-enclave-talking-to-the-watchtower-wizard-after-making-the-potion";
    }
    if (stage === STAGE_FOUND_ALL_CRYSTALS) {
      return "reviving-the-watchtower-talking-to-the-watchtower-wizard-again";
    }
    return "post-quest-talking-to-the-watchtower-wizard";
  }

  function selectOtherWizardVariant(stage) {
    if (stage <= 0) return "getting-started-speaking-to-a-wizard";
    if (stage === STAGE_STARTED) return "searching-for-evidence-speaking-to-a-wizard";
    if (stage === STAGE_GIVEN_FINGERNAILS) return "ogre-investigations-talking-to-a-wizard";
    if (stage === STAGE_MADE_RELIC) return "ogre-investigations-talking-to-a-wizard-2";
    if (stage === STAGE_GIVEN_RELIC || stage === STAGE_GIVEN_RIDDLE) {
      return "entering-gu-tanoth-talking-to-the-wizards-after-gaining-access-to-the-city";
    }
    if (stage === STAGE_SOLVED_RIDDLE) {
      return "skavid-search-talking-to-the-wizards-after-getting-the-skavid-map";
    }
    if (stage === STAGE_SKAVID_CRYSTAL) {
      return "skavid-search-talking-to-the-wizards-after-learning-to-navigate-the-skavid-caves";
    }
    if (stage === STAGE_FED_NIGHTSHADE) {
      return "entering-the-enclave-talking-to-the-wizards-after-discovering-the-shamans-are-invincible";
    }
    if (stage === STAGE_LEARNED_POTION) {
      return "entering-the-enclave-talking-to-the-watchtower-wizard-after-discovering-the-shamans-are-invincible-talking-to-the-wizards-after-learning-the-potion-recipe";
    }
    if (stage === STAGE_MADE_POTION) return "reviving-the-watchtower-talking-to-a-wizard";
    if (stage === STAGE_FOUND_ALL_CRYSTALS) {
      return "reviving-the-watchtower-talking-to-a-wizard-before-activating-the-generator";
    }
    return "post-quest-talking-to-a-wizard";
  }

  function selectCityGuardVariant(stage) {
    if (stage < STAGE_GIVEN_RELIC) return null;
    if (stage < STAGE_GIVEN_RIDDLE) return "entering-gu-tanoth-seeking-passage";
    if (stage === STAGE_GIVEN_RIDDLE) return "entering-gu-tanoth-seeking-passage-talking-to-the-city-guard-again";
    return "entering-gu-tanoth-seeking-passage-talking-to-him-after-having-given-him-the-rune";
  }

  function selectScaredSkavidVariant(player, stage) {
    if (stage < STAGE_SOLVED_RIDDLE || stage >= STAGE_COMPLETE) return null;
    if (!hasBit(player, BIT_LEARNING_SKAVID)) return "skavid-search-scared-skavid";
    if (learnedWords(player) >= 3) return "skavid-search-talking-to-the-scared-skavid-after-learning-skavid";
    return "skavid-search-scared-skavid-talking-to-the-scared-skavid-again";
  }

  function selectMadSkavidVariant(player, stage) {
    if (stage < STAGE_SOLVED_RIDDLE) return null;
    if (stage >= STAGE_SKAVID_CRYSTAL) return "skavid-search-the-mad-skavid-talking-to-the-mad-skavid-again";
    if (!hasBit(player, BIT_LEARNING_SKAVID) || learnedWords(player) < 3) return null;
    return "skavid-search-the-mad-skavid";
  }

  function selectSkavidTeacherVariant(player, stage, npcId) {
    if (stage < STAGE_SOLVED_RIDDLE || stage >= STAGE_COMPLETE) return null;
    if (!hasBit(player, BIT_LEARNING_SKAVID)) return null;
    return SKAVID_VARIANTS.get(npcId);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === WIZARD_ID) return selectWizardVariant(player, stage);
    if (OTHER_WIZARD_IDS.has(npcId)) return selectOtherWizardVariant(stage);
    if (npcId === TOWER_GUARD_ID) {
      return stage >= STAGE_STARTED
        ? "getting-started-attempting-to-climb-the-ladder"
        : "getting-started-speaking-to-a-tower-guard";
    }
    if (npcId === CHIEFTAIN_ID) {
      return stage >= STAGE_FED_NIGHTSHADE
        ? "entering-the-enclave-inside-the-enclave-talking-to-an-ogre-chieftain"
        : null;
    }
    if (npcId === OG_ID) return selectOgVariant(player, stage);
    if (npcId === GREW_ID) return selectGrewVariant(player, stage);
    if (npcId === TOBAN_ID) return selectTobanVariant(player, stage);
    if (npcId === GORAD_ID) {
      return stage >= STAGE_GIVEN_FINGERNAILS && stage < STAGE_MADE_RELIC
        ? "ogre-investigations-grew-facing-gorad"
        : null;
    }
    if (ENTRANCE_GUARD_IDS.has(npcId)) {
      return stage >= STAGE_GIVEN_FINGERNAILS ? "entering-gu-tanoth-city-guard" : null;
    }
    if (SOUTHERN_GUARD_IDS.has(npcId)) {
      return stage >= STAGE_GIVEN_FINGERNAILS ? "entering-gu-tanoth-talking-to-the-southern-ogre-guard" : null;
    }
    if (MARKET_GUARD_IDS.has(npcId)) {
      if (stage < STAGE_GIVEN_RELIC) return null;
      if (!hasBit(player, BIT_MARKET_WANTS)) {
        setBit(player, BIT_MARKET_WANTS);
        return "entering-gu-tanoth-ogre-guard";
      }
      return "entering-gu-tanoth-ogre-guard-talking-to-the-ogre-guard-again";
    }
    if (BRIDGE_GUARD_IDS.has(npcId)) {
      return stage >= STAGE_GIVEN_RELIC ? "entering-gu-tanoth-crossing-the-bridge" : null;
    }
    if (npcId === CITY_GUARD_ID) return selectCityGuardVariant(stage);
    if (npcId === SCARED_SKAVID_ID) return selectScaredSkavidVariant(player, stage);
    if (npcId === MAD_SKAVID_ID) return selectMadSkavidVariant(player, stage);
    if (SKAVID_VARIANTS.has(npcId)) {
      const variant = selectSkavidTeacherVariant(player, stage, npcId);
      if (variant) player.setAttribute(VARIANT_ATTRIBUTE, variant);
      return variant;
    }
    if (npcId === ENCLAVE_GUARD_ID) {
      return stage >= STAGE_SKAVID_CRYSTAL
        ? "entering-the-enclave-talking-to-an-enclave-guard"
        : null;
    }
    if (SHAMAN_IDS.has(npcId)) {
      return stage >= STAGE_FED_NIGHTSHADE
        ? "entering-the-enclave-inside-the-enclave-talking-to-an-ogre-shaman"
        : null;
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition(event) {
    const { player, text, stepId } = event;
    if (!player || text === undefined) return null;
    const value = String(text).toLowerCase();
    const has = (itemId) => held(player, itemId);
    const bank = (itemId) => bankAmount(player, itemId) > 0;
    const anyPart = () => RELIC_PART_IDS.some(has);

    if (value.includes("with no evidence to show him")) {
      return !EVIDENCE_IDS.some(has);
    }
    if (value.includes("with any of the evidence besides fingernails")) {
      return !has(FINGERNAILS) && DECOY_EVIDENCE_IDS.some(has);
    }
    if (value.includes("with the fingernails")) return has(FINGERNAILS);

    if (value.includes("old robe:")) {
      return bushObject(player) === ObjectIdentifiers.BUSH_15 && !has(OLD_ROBE);
    }
    if (value.includes("unusual armour:")) {
      return bushObject(player) === ObjectIdentifiers.BUSH_16 && !has(UNUSUAL_ARMOUR);
    }
    if (value.includes("damaged dagger:")) {
      return bushObject(player) === ObjectIdentifiers.BUSH_13 && !has(DAMAGED_DAGGER);
    }
    if (value.includes("tattered eye patch:")) {
      return bushObject(player) === ObjectIdentifiers.BUSH_14 && !has(TATTERED_EYE_PATCH);
    }
    if (value.includes("fingernails:")) {
      return bushObject(player) === ObjectIdentifiers.BUSH_12 && !has(FINGERNAILS);
    }
    if (value.includes("searching the same bush after finding an item in it")) {
      const itemId = BUSH_ITEMS.get(bushObject(player));
      return itemId !== undefined && has(itemId);
    }
    if (value.includes("finding nothing")) {
      return bushObject(player) === ObjectIdentifiers.BUSH_11;
    }

    if (value.includes("without dragon bones")) return !has(DRAGON_BONES);
    if (value.includes("with dragon bones")) return has(DRAGON_BONES);

    if (value.includes("with toban's key")) return has(TOBANS_KEY);
    if (value.includes("without toban's key")) return !has(TOBANS_KEY);
    if (value.includes("if the player does have the gold")) return has(TOBANS_GOLD);
    if (value.includes("if the player doesn't have the gold")) return !has(TOBANS_GOLD);
    if (value.includes("if the player no longer has the key")) return !has(TOBANS_KEY) && !bank(TOBANS_KEY);
    if (value.includes("if the player has the key on them")) return has(TOBANS_KEY);
    if (value.includes("if the player has the key stored somewhere")) return bank(TOBANS_KEY);

    if (value.includes("if the player has the relic part on them")) {
      if (stepId === "9Vr3sO") return has(RELIC_PART_IDS[2]);
      if (stepId === "rnvWxa") return has(RELIC_PART_IDS[0]);
      if (stepId === "_zSkbp") return has(RELIC_PART_IDS[1]);
      return anyPart();
    }
    if (value.includes("if the player lost the relic part")) {
      if (stepId === "dgZQL8") return !has(RELIC_PART_IDS[1]) && !bank(RELIC_PART_IDS[1]);
      if (stepId === "qlelFq") return !has(RELIC_PART_IDS[0]) && !bank(RELIC_PART_IDS[0]);
      return !anyPart();
    }
    if (value.includes("if the relic part is stored somewhere")) {
      if (stepId === "U7LsnZ") return bank(RELIC_PART_IDS[1]);
      if (stepId === "JvNuhW") return bank(RELIC_PART_IDS[0]);
      return RELIC_PART_IDS.some(bank);
    }

    if (value.includes("without the ogre tooth")) return !has(OGRE_TOOTH);
    if (value.includes("with the ogre tooth")) return has(OGRE_TOOTH);
    if (value.includes("after killing gorad")) {
      return hasBit(player, BIT_GORAD_DEAD) || has(OGRE_TOOTH);
    }

    if (value.includes("handing in relic part 1")) return has(RELIC_PART_IDS[0]);
    if (value.includes("handing in relic part 2")) return has(RELIC_PART_IDS[1]);
    if (value.includes("handing in relic part 3")) return has(RELIC_PART_IDS[2]);
    if (value.includes("after handing in one relic part")) return relicPartsHeld(player) === 1;
    if (value.includes("after handing in two relic parts")) return relicPartsHeld(player) === 2;
    if (value.includes("after handing in the third relic part")) return relicPartsHeld(player) === 3;

    if (value.includes("if the player has the relic in their inventory")) return has(OGRE_RELIC);
    if (value.includes("if the player lost the relic")) {
      return !has(OGRE_RELIC) && !bank(OGRE_RELIC);
    }
    if (value.includes("if the player stored the relic somewhere")) return bank(OGRE_RELIC);
    if (value.includes("if the player is not carrying the relic")) return !has(OGRE_RELIC);
    if (value.includes("if the player is carrying the relic")) return has(OGRE_RELIC);

    if (value.includes("without an ogre rockcake")) return !has(ROCK_CAKE);
    if (value.includes("with an ogre rockcake")) return has(ROCK_CAKE);

    if (value.includes("if the player doesn't have 20 coins")) {
      return player.getInventory().getAmount(COINS) < 20;
    }
    if (value.includes("if the player has 20 coins")) {
      return player.getInventory().getAmount(COINS) >= 20;
    }

    if (value.includes("if the player does not have a skavid map in their inventory or bank")) {
      return !has(SKAVID_MAP) && !bank(SKAVID_MAP);
    }
    if (value.includes("if the player has a skavid map in their bank")) return bank(SKAVID_MAP);
    if (value.includes("if the player has a skavid map in their inventory")) return has(SKAVID_MAP);

    if (value.includes("with a light source but no tinderbox")) {
      return hasLightSource(player) && !has(TINDERBOX);
    }

    if (value.includes("if the player has the crystal on them")) return has(CRYSTAL_1);
    if (value.includes("if the player doesn't have the crystal")) {
      return !has(CRYSTAL_1) && !bank(CRYSTAL_1);
    }
    if (value.includes("if the crystal is stored somewhere")) {
      if (stepId === "7FXG2l") return bank(CRYSTAL_1);
      if (stepId === "Sm4F0t") return bank(CRYSTAL_2);
      return bank(CRYSTAL_1) || bank(CRYSTAL_2);
    }
    if (value.includes("if the player lost the crystal")) {
      return !has(CRYSTAL_2) && !bank(CRYSTAL_2);
    }
    if (value.includes("if the player has the crystal")) return has(CRYSTAL_2);

    if (value.includes("after killing one shaman")) return shamanKills(player) === 1;
    if (value.includes("after killing two shamans")) return shamanKills(player) === 2;
    if (value.includes("after killing three shamans")) return shamanKills(player) === 3;
    if (value.includes("after killing four shamans")) return shamanKills(player) === 4;
    if (value.includes("after killing five shamans")) return shamanKills(player) === 5;
    if (value.includes("after killing the last shaman")) return shamanKills(player) >= MAX_SHAMAN_KILLS;

    if (value.includes("searching the shaman robe while already having the crystal")) {
      return has(CRYSTAL_3);
    }
    if (value.includes("searching the shaman robe while not having the crystal")) {
      return !has(CRYSTAL_3) && !bank(CRYSTAL_3);
    }

    if (value.includes("if the player has read the spell scroll")) {
      return quest.getStage(player) >= STAGE_READ_SCROLL;
    }
    if (value.includes("if the player has not read the spell scroll")) {
      return quest.getStage(player) < STAGE_READ_SCROLL;
    }
    if (value.includes("if the player lost the spell scroll")) {
      return !has(SPELL_SCROLL) && !bank(SPELL_SCROLL);
    }
    if (value.includes("if the player has the spell scroll")) return has(SPELL_SCROLL);

    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== WIZARD_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handInRelicPart(player, index) {
    const itemId = RELIC_PART_IDS[index];
    if (!hasBit(player, BIT_RELIC[index]) && held(player, itemId)) {
      remove(player, itemId);
      setBit(player, BIT_RELIC[index]);
    }
    if (relicPartsHeld(player) === RELIC_PART_IDS.length) {
      give(player, OGRE_RELIC);
      if (quest.getStage(player) < STAGE_MADE_RELIC) quest.setStage(player, STAGE_MADE_RELIC);
      player.sendMessage("The wizard gives you a complete statue.");
    }
  }

  /** Hand-ins triggered by a chosen prose condition (npc-dialogue:condition). */
  function handleCondition(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    if (stepId === "Q3Ag5X") {
      if (!held(player, FINGERNAILS)) return;
      remove(player, FINGERNAILS);
      if (quest.getStage(player) < STAGE_GIVEN_FINGERNAILS) {
        quest.setStage(player, STAGE_GIVEN_FINGERNAILS);
      }
      return;
    }
    if (HAND_IN_RELIC_STEPS.has(stepId)) {
      handInRelicPart(player, HAND_IN_RELIC_STEPS.get(stepId));
      return;
    }
    if (stepId === "flM0eA") {
      setBit(player, BIT_LOOKING_RELIC);
      return;
    }
    if (stepId === "7ZK2kb") {
      if (quest.getStage(player) < STAGE_GIVEN_RELIC) quest.setStage(player, STAGE_GIVEN_RELIC);
      return;
    }
    if (stepId === "Q47TiK") {
      setBit(player, BIT_GORAD_DEAD);
      give(player, OGRE_TOOTH);
      return;
    }
    if (stepId === "qgYC5r") {
      give(player, TOBANS_KEY);
      return;
    }
    if (stepId === "qlelFq") {
      give(player, RELIC_PART_IDS[0]);
      return;
    }
    if (stepId === "dgZQL8") {
      give(player, RELIC_PART_IDS[1]);
      return;
    }
    if (stepId === "KFfnxk") {
      give(player, CRYSTAL_1);
      return;
    }
    if (stepId === "GrYvML") {
      give(player, CRYSTAL_2);
    }
  }

  /** Start/report choices: task givers, the riddle, skavid lessons. */
  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player) return;
    const key = normalized(option);

    if (npcId === OG_ID && key.startsWith("iseekentrance")) {
      if (!hasBit(player, BIT_SPOKEN_OG)) {
        setBit(player, BIT_SPOKEN_OG);
        give(player, TOBANS_KEY);
        player.sendMessage("Og gives you a key to Toban's chest.");
      }
      return;
    }
    if (npcId === TOBAN_ID) {
      if (key.startsWith("icoulddosomethingforyou")) {
        setBit(player, BIT_SPOKEN_TOBAN);
        return;
      }
      if (key.startsWith("icantfindtherelicpart")) {
        if (!held(player, RELIC_PART_IDS[2]) && bankAmount(player, RELIC_PART_IDS[2]) <= 0) {
          player.getInventory().adds(RELIC_PART_IDS[2], 1);
          player.sendMessage("Toban gives you another relic part.");
        }
        return;
      }
      return;
    }
    if (npcId === GREW_ID && key.startsWith("donteatmecanhelp")) {
      setBit(player, BIT_SPOKEN_GREW);
      return;
    }
    if (npcId === CITY_GUARD_ID && key.startsWith("iseekpassage")) {
      if (quest.getStage(player) < STAGE_GIVEN_RIDDLE) quest.setStage(player, STAGE_GIVEN_RIDDLE);
      return;
    }
    if (npcId === SCARED_SKAVID_ID && key.startsWith("okayokay")) {
      setBit(player, BIT_LEARNING_SKAVID);
      return;
    }
    if (SKAVID_VARIANTS.has(npcId)) {
      const variant = String(player.getAttribute(VARIANT_ATTRIBUTE));
      if (variant.includes("skavid-1") && key === "cur") setBit(player, BIT_LEARNED_CUR);
      if (variant.includes("skavid-2") && key === "ig") setBit(player, BIT_LEARNED_IG);
      if (variant.includes("skavid-3") && key === "nod") setBit(player, BIT_LEARNED_NOD);
    }
  }

  /** Message steps carry the quest item hand-outs and the terminal completion. */
  function handleMessage(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    if (stepId === "0-eoVh") {
      remove(player, DRAGON_BONES);
      give(player, RELIC_PART_IDS[2]);
      setBit(player, BIT_HELPED_TOBAN);
      return;
    }
    if (stepId === "qdm4Oz") {
      give(player, TOBANS_GOLD);
      return;
    }
    if (stepId === "ezI70R") {
      remove(player, TOBANS_GOLD);
      give(player, RELIC_PART_IDS[0]);
      setBit(player, BIT_HELPED_OG);
      return;
    }
    if (stepId === "g2LcFM") {
      remove(player, OGRE_TOOTH);
      give(player, RELIC_PART_IDS[1]);
      give(player, CRYSTAL_1);
      setBit(player, BIT_HELPED_GREW);
      return;
    }
    if (stepId === "Hc4rny") {
      setBit(player, BIT_GORAD_DEAD);
      give(player, OGRE_TOOTH);
      return;
    }
    if (stepId === "kS6m_z") {
      give(player, OGRE_RELIC);
      if (quest.getStage(player) < STAGE_MADE_RELIC) quest.setStage(player, STAGE_MADE_RELIC);
      return;
    }
    if (stepId === "KRA6Uf") {
      give(player, OGRE_RELIC);
      return;
    }
    if (stepId === "WGTZbp") {
      remove(player, ROCK_CAKE);
      setBit(player, BIT_MARKET_GIVEN);
      return;
    }
    if (stepId === "SYijHA") {
      remove(player, DEATH_RUNE);
      give(player, SKAVID_MAP);
      if (quest.getStage(player) < STAGE_SOLVED_RIDDLE) quest.setStage(player, STAGE_SOLVED_RIDDLE);
      return;
    }
    if (stepId === "F_ChuY") {
      give(player, SKAVID_MAP);
      return;
    }
    if (stepId === "-ZqDtE") {
      give(player, CRYSTAL_2);
      if (quest.getStage(player) < STAGE_SKAVID_CRYSTAL) quest.setStage(player, STAGE_SKAVID_CRYSTAL);
      return;
    }
    if (stepId === "KXRXHc" || stepId === "BOIu3d") {
      give(player, CRYSTAL_3);
      return;
    }
    if (stepId === "55Yxf-") {
      give(player, CRYSTAL_4);
      return;
    }
    if (stepId === "QGCKsr") {
      remove(player, SPELL_SCROLL);
      if (quest.getStage(player) < STAGE_READ_SCROLL) {
        quest.setStage(player, STAGE_READ_SCROLL);
      }
      return;
    }
    if (stepId === "UT4_jQ") {
      if (!quest.isComplete(player)) completeWatchtower(player);
      event.handled = true;
      event.end = true;
    }
  }

  function completeWatchtower(player) {
    for (const crystalId of CRYSTAL_IDS) {
      const amount = player.getInventory().getAmount(crystalId);
      if (amount > 0) player.getInventory().deleteNumber(crystalId, amount);
    }
    quest.complete(player);
  }

  /** Action steps: item receives, the bridge toll, the reward action. */
  function handleActionStep(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;

    if (RECEIVE_ITEMS.has(stepId)) {
      give(player, RECEIVE_ITEMS.get(stepId));
      event.handled = true;
      return;
    }
    if (stepId === "rEZMuS") {
      if (player.getInventory().getAmount(COINS) >= 20) {
        player.getInventory().deleteNumber(COINS, 20);
        player.getSkillManager().addExperiences(Skill.AGILITY, 50);
        player.sendMessage("You daringly jump across the chasm.");
      }
      event.handled = true;
      return;
    }
    if (stepId === "tTts4h") {
      // Rewards are granted when the terminal completion message is handled.
      event.handled = true;
    }
  }

  function handleAction(event) {
    if (!event.player || !event.stepId) return;
    if (event.kind === "message") {
      handleMessage(event);
      return;
    }
    if (event.step?.type === "action") handleActionStep(event);
  }

  function searchBush(player, objectId) {
    if (quest.getStage(player) < STAGE_STARTED) {
      player.sendMessage("I am not sure why I am searching this bush.");
      return;
    }
    player.setAttribute(OBJECT_ATTRIBUTE, objectId);
    startTranscript(api, player, TOWER_GUARD_ID, PAGE, "searching-for-evidence-searching-the-bushes");
    player.setAttribute(OBJECT_ATTRIBUTE, 0);
  }

  function openTobanChest(player) {
    if (quest.getStage(player) < STAGE_GIVEN_FINGERNAILS) {
      player.sendMessage("The chest is locked.");
      return;
    }
    startTranscript(api, player, TOBAN_ID, PAGE, "ogre-investigations-toban-looting-toban-s-chest");
    if (held(player, TOBANS_KEY)) {
      remove(player, TOBANS_KEY);
      player.sendMessage("You use the key Og gave you.");
    }
  }

  function enterSkavidCave(player, objectId) {
    if (!held(player, SKAVID_MAP)) {
      player.sendMessage("There's no way I can find my way through without a map of some kind.");
      return;
    }
    if (!hasLightSource(player)) {
      player.sendMessage("It is far too dark in there. I will need a light source.");
      return;
    }
    const destination = CAVE_ENTRANCES.get(objectId);
    if (destination) player.moveTo(new Location(destination.x, destination.y, 0));
  }

  function mineRock(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MADE_POTION || shamanKills(player) < MAX_SHAMAN_KILLS) {
      player.sendMessage("I can't touch it... Perhaps it is linked with the shamans in some strange way?");
      return;
    }
    if (held(player, CRYSTAL_4) || bankAmount(player, CRYSTAL_4) > 0) {
      startTranscript(
        api,
        player,
        WIZARD_ID,
        PAGE,
        "entering-the-enclave-attempting-to-mine-the-rock-of-dalgroth-again"
      );
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < 40) {
      player.sendMessage("You need at least level 40 Mining to mine this rock.");
      return;
    }
    startTranscript(api, player, WIZARD_ID, PAGE, "entering-the-enclave-mining-the-rock-of-dalgroth");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (BUSH_IDS.has(objectId)) {
      event.handled = true;
      searchBush(player, objectId);
      return;
    }
    if (TRELLIS_IDS.has(objectId)) {
      event.handled = true;
      if (player.getSkillManager().getCurrentLevel(Skill.AGILITY) < 18) {
        player.sendMessage("You need an Agility level of 18 to climb this wall.");
        return;
      }
      player.sendMessage("You climb up the wall...");
      player.sendMessage("...and squeeze in through the window.");
      player.moveTo(new Location(2546, 3116, 2));
      return;
    }
    if (objectId === CHEST_ID) {
      event.handled = true;
      openTobanChest(player);
      return;
    }
    if (objectId === LEVER_ID) {
      event.handled = true;
      if (allCrystals(player) && quest.getStage(player) >= STAGE_FOUND_ALL_CRYSTALS) {
        startTranscript(
          api,
          player,
          WIZARD_ID,
          PAGE,
          "reviving-the-watchtower-activating-the-shield-generator"
        );
      } else {
        startTranscript(
          api,
          player,
          WIZARD_ID,
          PAGE,
          "reviving-the-watchtower-pulling-the-lever-before-placing-the-crystals"
        );
      }
      return;
    }
    if (objectId === ROCK_ID) {
      event.handled = true;
      const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
      if (option.includes("prospect")) {
        if (held(player, CRYSTAL_4)) {
          startTranscript(
            api,
            player,
            WIZARD_ID,
            PAGE,
            "entering-the-enclave-prospecting-the-rock-of-dalgroth-after-mining-it"
          );
        } else {
          player.sendMessage("The rock contains a crystal!");
        }
        return;
      }
      mineRock(player);
      return;
    }
    if (CAVE_ENTRANCES.has(objectId)) {
      event.handled = true;
      enterSkavidCave(player, objectId);
      return;
    }
    if (CAVE_EXITS.has(objectId)) {
      event.handled = true;
      const destination = CAVE_EXITS.get(objectId);
      player.sendMessage("You climb out of the cave.");
      player.moveTo(new Location(destination.x, destination.y, 0));
      return;
    }
  }

  function potionOnShaman(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MADE_POTION) return;
    if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < 14) {
      player.sendMessage("You need a Magic level of 14 or over to use this potion.");
      return;
    }
    const kills = shamanKills(player);
    if (kills >= MAX_SHAMAN_KILLS) return;
    remove(player, MAGIC_OGRE_POTION);
    player.sendMessage("There is a bright flash!");
    player.sendMessage("The ogre dissolves into spirit form.");
    setShamanKills(player, kills + 1);
    if (kills + 1 >= MAX_SHAMAN_KILLS) {
      give(player, CRYSTAL_3);
      player.sendMessage("A crystal drops from the hand of the disappearing ogre. You snatch it up quickly.");
    } else {
      player.sendMessage("That is one ogre shaman destroyed!");
    }
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const targetId = event.target?.getId?.();
    if (!player || !targetId) return;

    if (targetId === CITY_GUARD_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_GIVEN_RELIC) return;
      if (itemId === DEATH_RUNE && stage === STAGE_GIVEN_RIDDLE) {
        startTranscript(
          api,
          player,
          CITY_GUARD_ID,
          PAGE,
          "entering-gu-tanoth-seeking-passage-using-the-death-rune-on-the-guard"
        );
        event.handled = true;
        return;
      }
      if (itemId !== DEATH_RUNE && stage < STAGE_COMPLETE) {
        startTranscript(
          api,
          player,
          CITY_GUARD_ID,
          PAGE,
          "entering-gu-tanoth-seeking-passage-using-the-wrong-item-on-the-guard"
        );
        event.handled = true;
      }
      return;
    }
    if (targetId === TOBAN_ID && itemId === DRAGON_BONES) {
      if (!hasBit(player, BIT_SPOKEN_TOBAN) || hasBit(player, BIT_HELPED_TOBAN)) return;
      startTranscript(api, player, TOBAN_ID, PAGE, "ogre-investigations-toban-speaking-to-toban-again");
      event.handled = true;
      return;
    }
    if (targetId === OG_ID && itemId === TOBANS_GOLD) {
      if (!hasBit(player, BIT_SPOKEN_OG) || hasBit(player, BIT_HELPED_OG)) return;
      startTranscript(api, player, OG_ID, PAGE, "ogre-investigations-og-speaking-to-og-again");
      event.handled = true;
      return;
    }
    if (targetId === GREW_ID && itemId === OGRE_TOOTH) {
      if (!hasBit(player, BIT_SPOKEN_GREW) || hasBit(player, BIT_HELPED_GREW)) return;
      startTranscript(api, player, GREW_ID, PAGE, "ogre-investigations-grew-speaking-to-grew-again");
      event.handled = true;
      return;
    }
    if (targetId === WIZARD_ID) {
      const stage = quest.getStage(player);
      if (RELIC_PART_IDS.includes(itemId) && stage >= STAGE_GIVEN_FINGERNAILS && stage < STAGE_MADE_RELIC) {
        startTranscript(api, player, WIZARD_ID, PAGE, "ogre-investigations-assembling-the-relic");
        event.handled = true;
        return;
      }
      if (itemId === OGRE_POTION && stage === STAGE_LEARNED_POTION) {
        remove(player, OGRE_POTION);
        player.getInventory().adds(MAGIC_OGRE_POTION, 1);
        player.sendMessage("The wizard infuses the potion with magic.");
        quest.setStage(player, STAGE_MADE_POTION);
        startTranscript(
          api,
          player,
          WIZARD_ID,
          PAGE,
          "entering-the-enclave-talking-to-the-watchtower-wizard-after-making-the-potion"
        );
        event.handled = true;
        return;
      }
      if (itemId === FINGERNAILS && stage === STAGE_STARTED) {
        startTranscript(
          api,
          player,
          WIZARD_ID,
          PAGE,
          "searching-for-evidence-talking-to-the-watchtower-wizard"
        );
        event.handled = true;
      }
      return;
    }
    if (targetId === ENCLAVE_GUARD_ID && itemId === CAVE_NIGHTSHADE) {
      const stage = quest.getStage(player);
      if (stage < STAGE_SKAVID_CRYSTAL) {
        player.sendMessage("I think I had better deal with those skavids first...");
        event.handled = true;
        return;
      }
      remove(player, CAVE_NIGHTSHADE);
      if (stage === STAGE_SKAVID_CRYSTAL) quest.setStage(player, STAGE_FED_NIGHTSHADE);
      startTranscript(
        api,
        player,
        ENCLAVE_GUARD_ID,
        PAGE,
        "entering-the-enclave-using-cave-nightshade-on-an-enclave-guard"
      );
      event.handled = true;
      return;
    }
    if (SHAMAN_IDS.has(targetId) && itemId === MAGIC_OGRE_POTION) {
      potionOnShaman(player);
      event.handled = true;
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    if (!player) return;
    const ids = [event.usedItemId, event.usedWithItemId];
    const both = (a, b) => ids.includes(a) && ids.includes(b);

    if (RELIC_PART_IDS.includes(ids[0]) && RELIC_PART_IDS.includes(ids[1])) {
      player.sendMessage("I think these fit together, but I can't seem to make them fit.");
      player.sendMessage("I am going to need someone with experience to help me with this.");
      event.handled = true;
      return;
    }
    const mixable =
      both(VIAL_OF_WATER, JANGERBERRIES) ||
      both(JANGER_VIAL, GUAM_LEAF) ||
      both(GUAM_POTION_UNF, JANGERBERRIES) ||
      both(GUAM_JANGER_VIAL, GROUND_BAT_BONES);
    if (!mixable) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_LEARNED_POTION) {
      player.sendMessage("Hmm, perhaps I shouldn't mix these together. It might have unpredictable results.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < 14) {
      player.sendMessage("You need a Herblore level of 14 or above to make this potion.");
      return;
    }
    if (both(VIAL_OF_WATER, JANGERBERRIES)) {
      remove(player, VIAL_OF_WATER);
      remove(player, JANGERBERRIES);
      player.getInventory().adds(JANGER_VIAL, 1);
      player.getSkillManager().addExperiences(Skill.HERBLORE, 100);
      player.sendMessage("You mix the jangerberries into the water.");
      return;
    }
    if (both(JANGER_VIAL, GUAM_LEAF)) {
      remove(player, JANGER_VIAL);
      remove(player, GUAM_LEAF);
      player.getInventory().adds(GUAM_JANGER_VIAL, 1);
      player.getSkillManager().addExperiences(Skill.HERBLORE, 100);
      player.sendMessage("You mix the guam leaf into your potion.");
      return;
    }
    if (both(GUAM_POTION_UNF, JANGERBERRIES)) {
      remove(player, GUAM_POTION_UNF);
      remove(player, JANGERBERRIES);
      player.getInventory().adds(GUAM_JANGER_VIAL, 1);
      player.getSkillManager().addExperiences(Skill.HERBLORE, 100);
      player.sendMessage("You mix the jangerberries into your potion.");
      return;
    }
    remove(player, GUAM_JANGER_VIAL);
    remove(player, GROUND_BAT_BONES);
    player.getInventory().adds(OGRE_POTION, 1);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 100);
    player.sendMessage("You mix the ground bones into the liquid.");
    player.sendMessage("You produce a strong potion.");
  }

  function readSpellScroll(event) {
    const { player } = event;
    if (!player || !held(player, SPELL_SCROLL)) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_COMPLETE) return;
    startTranscript(api, player, WIZARD_ID, PAGE, "post-quest-reading-the-spell-scroll");
  }

  function searchShamanRobe(event) {
    const { player } = event;
    if (!player) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_MADE_POTION || shamanKills(player) < MAX_SHAMAN_KILLS) {
      return;
    }
    if (held(player, CRYSTAL_3) || bankAmount(player, CRYSTAL_3) > 0) {
      player.sendMessage("You search the robe, but find nothing. You already have the shamans' crystal.");
      return;
    }
    give(player, CRYSTAL_3);
    player.sendMessage("You search the robe and find a crystal!");
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (objectId === CHEST_ID && itemId === TOBANS_KEY) {
      event.handled = true;
      startTranscript(api, player, TOBAN_ID, PAGE, "ogre-investigations-toban-looting-toban-s-chest");
      remove(player, TOBANS_KEY);
    }
  }

  function handleNpcDeath({ player, npcId }) {
    if (!player || npcId !== GORAD_ID) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_GIVEN_FINGERNAILS || stage >= STAGE_MADE_RELIC) return;
    setBit(player, BIT_GORAD_DEAD);
    if (!held(player, OGRE_TOOTH)) {
      player.getInventory().adds(OGRE_TOOTH, 1);
      player.sendMessage("He's dropped a tooth. You grab it quickly.");
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "watchtower",
    name: "Watchtower",
    varpId: VARP_WATCHTOWER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    xpRewards: [{ skillId: Skill.MAGIC.getIndex(), amount: 15250, label: "Magic" }],
    rewardItemId: SPELL_SCROLL,
    rewardItemLabel: "A spell scroll",
    otherRewards: ["5,000 Coins", "Access to the Ogre Enclave"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(BITS_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction("Spell scroll", { Read: readSpellScroll });
  api.onItemAction("Shaman robe", { Search: searchShamanRobe });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
