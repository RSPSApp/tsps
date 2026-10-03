/**
 * Eadgar's Ruse (members).
 *
 * The words come from the "Eadgar's Ruse" transcript page; this plugin supplies
 * the variant selector for Eadgar, Burntmeat, Sanfew, Tegid, Parroty Pete and the
 * storeroom guards, the start hook, the prose-condition answers (Druidic Ritual,
 * Troll Stronghold and 31 Herblore gating) and the gameplay: parrot catching at
 * the Ardougne Zoo aviary, hiding the parrot under the Troll prison rack, the
 * scarecrow supplies, the troll truth potion, the fake-man swap with Burntmeat
 * and the goutweed storeroom.
 *
 * Stages (varp 335): 10 started, 15 goutweed advice heard, 20/25 the cook wants a
 * human, 30 parrot wanted, 50 plan explained, 60 parrot hidden, 70 supplies,
 * 80 truth potion, 85 parrot wanted back, 86 parrot retrieved, 87 fake man held,
 * 90 burnt meat, 100 storeroom unlocked, 110 complete.
 *
 * Eadgar (4118) is shared with Troll Stronghold: the selector returns null before
 * this quest starts so that quest's Eadgar branch keeps running, and every Eadgar
 * hook is gated on this quest's stages.
 *
 * Source: https://github.com/LostCityRS/Content/tree/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/quests/quest_eadgar
 * Gaps: the patrolling-guard and goutweed-guard knockouts are not simulated; the
 * stage-85 "Did you get that parrot back?" line and the generic Eadgar stew
 * exchange are absent from the transcript dump; Trollheim Teleport is reward text
 * only (no spell-unlock API); goutweed is exchanged for ranarr weed rather than
 * the level-scaled herb table; Troll thistle NPC movement is not simulated.
 */
module.exports = function registerEadgarsRuseQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Eadgar's Ruse";

  const EADGAR_NPC_ID = NpcIdentifiers.EADGAR; // 4118
  const BURNTMEAT_NPC_ID = NpcIdentifiers.BURNTMEAT; // 4157
  const SANFEW_NPC_ID = NpcIdentifiers.SANFEW; // 5044
  const TEGID_NPC_ID = NpcIdentifiers.TEGID; // 4766
  const PARROTY_PETE_NPC_ID = NpcIdentifiers.PARROTY_PETE; // 4769
  const THISTLE_NPC_ID = NpcIdentifiers.THISTLE; // 4767
  const PARROT_NPC_ID = NpcIdentifiers.PARROT; // 1827, rack transcript chathead
  const GUARD_NPC_IDS = new Set([
    NpcIdentifiers.GUARD_52, // 4148
    NpcIdentifiers.GUARD_53,
    NpcIdentifiers.GUARD_54,
    NpcIdentifiers.GUARD_55,
    NpcIdentifiers.GUARD_56,
    NpcIdentifiers.GUARD_57,
    NpcIdentifiers.GUARD_58,
    NpcIdentifiers.GUARD_59,
    NpcIdentifiers.GUARD_60, // 4156
  ]);

  const VARP_EADGARS_RUSE = 335;
  const STAGE_STARTED = 10;
  const STAGE_TOLD_ABOUT_COOK = 15;
  const STAGE_COOK_FIRST = 20;
  const STAGE_COOK_SECOND = 25;
  const STAGE_NEEDS_PARROT = 30;
  const STAGE_PLAN_EXPLAINED = 50;
  const STAGE_PARROT_HIDDEN = 60;
  const STAGE_NEEDS_ITEMS = 70;
  const STAGE_NEEDS_POTION = 80;
  const STAGE_NEEDS_PARROT_BACK = 85;
  const STAGE_GOT_PARROT_BACK = 86;
  const STAGE_GOT_FAKE_MAN = 87;
  const STAGE_GOT_BURNT_MEAT = 90;
  const STAGE_STOREROOM_OPEN = 100;
  const STAGE_COMPLETE = 110;

  const DRUIDIC_RITUAL_COMPLETE = 4;
  const TROLL_STRONGHOLD_COMPLETE = 50;
  const HERBLORE_LEVEL = 31;
  const TRUTH_POTION_XP = 11000;

  const GOUTWEED = ItemIdentifiers.GOUTWEED;
  const TROLL_THISTLE = ItemIdentifiers.TROLL_THISTLE;
  const DRIED_THISTLE = ItemIdentifiers.DRIED_THISTLE;
  const GROUND_THISTLE = ItemIdentifiers.GROUND_THISTLE;
  const TROLL_POTION = ItemIdentifiers.TROLL_POTION;
  const DRUNK_PARROT = ItemIdentifiers.DRUNK_PARROT;
  const DIRTY_ROBE = ItemIdentifiers.DIRTY_ROBE;
  const FAKE_MAN = ItemIdentifiers.FAKE_MAN;
  const STOREROOM_KEY = ItemIdentifiers.STOREROOM_KEY;
  const ALCO_CHUNKS = ItemIdentifiers.ALCO_CHUNKS;
  const PINEAPPLE_CHUNKS = ItemIdentifiers.PINEAPPLE_CHUNKS;
  const RANARR_POTION_UNF = ItemIdentifiers.RANARR_POTION_UNF_;
  const PESTLE_AND_MORTAR = ItemIdentifiers.PESTLE_AND_MORTAR;
  const RAW_CHICKEN = ItemIdentifiers.RAW_CHICKEN;
  const GRAIN = ItemIdentifiers.GRAIN;
  const BURNT_MEAT = ItemIdentifiers.BURNT_MEAT;
  const RANARR_WEED = ItemIdentifiers.RANARR_WEED;
  const LIQUOR_ITEM_IDS = new Set([
    ItemIdentifiers.VODKA,
    ItemIdentifiers.GIN,
    ItemIdentifiers.BRANDY,
    ItemIdentifiers.WHISKY,
  ]);
  const LOG_ITEM_IDS = [
    ItemIdentifiers.LOGS,
    ItemIdentifiers.ACHEY_TREE_LOGS,
    ItemIdentifiers.OAK_LOGS,
    ItemIdentifiers.WILLOW_LOGS,
    ItemIdentifiers.MAPLE_LOGS,
    ItemIdentifiers.YEW_LOGS,
    ItemIdentifiers.MAGIC_LOGS,
  ];

  const RACK_LOC_ID = ObjectIdentifiers.RACK_4; // 3821, torture rack
  const KITCHEN_DRAWERS_LOC_IDS = new Set([
    ObjectIdentifiers.KITCHEN_DRAWERS, // 3816
    ObjectIdentifiers.KITCHEN_DRAWERS_2, // 3817
  ]);
  const STOREROOM_DOOR_LOC_ID = ObjectIdentifiers.STOREROOM_DOOR; // 3810
  const GOUTWEED_CRATE_LOC_ID = ObjectIdentifiers.GOUTWEED_CRATE; // 3822
  const LAUNDRY_BASKET_LOC_ID = ObjectIdentifiers.LAUNDRY_BASKET; // 4039
  const TROLL_STEW_LOC_ID = ObjectIdentifiers.TROLL_STEW; // 3824, Eadgar's fire
  const AVIARY_HATCH_LOC_ID = ObjectIdentifiers.AVIARY_HATCH; // 4043

  const START_HOOK = "quest:eadgar-s-ruse:start";
  const COMPLETE_ACTION_ID = "ppjJ7y";
  const RECEIVE_PARROT_ACTION_ID = "RIBvA7";
  const GIVE_PINEAPPLE_ACTION_ID = "z2iD16";
  const GIVE_PARROT_ACTION_ID = "7FUg-e";
  const RECEIVE_FAKE_MAN_ACTION_ID = "a4owKo";
  const GIVE_FAKE_MAN_ACTION_ID = "3_aBrf";
  const RECEIVE_BURNT_MEAT_ACTION_ID = "fQ3BHD";
  const LOST_FAKE_MAN_CONDITION_ID = "1b0ym-";

  const SUPPLIES_ATTRIBUTE = "quest.eadgars_ruse.supplies";
  const PETE_ATTRIBUTE = "quest.eadgars_ruse.pete";
  const PETE_WHEN_BIT = 1;
  const PETE_FEED_BIT = 2;
  const SUPPLIES_LOGS = 1;
  const SUPPLIES_CLOTHES = 2;
  const CHICKENS_SHIFT = 2;
  const GRAIN_SHIFT = 5;

  const MAX_CHICKENS = 5;
  const MAX_GRAIN = 10;

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const countItem = (player, itemId) => player.getInventory().getAmount(itemId);

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function questStage(player, key) {
    return Number(player.getAttribute(`quest.${key}.stage`)) || 0;
  }

  function hasBaseRequirements(player) {
    return (
      questStage(player, "druidic_ritual") >= DRUIDIC_RITUAL_COMPLETE &&
      questStage(player, "troll_stronghold") >= TROLL_STRONGHOLD_COMPLETE
    );
  }

  function hasHerblore(player) {
    return player.getSkillManager().getCurrentLevel(Skill.HERBLORE) >= HERBLORE_LEVEL;
  }

  function baseHerblore(player) {
    return player.getSkillManager().getMaxLevel(Skill.HERBLORE);
  }

  // ---------------------------------------------------------------------------
  // Scarecrow supplies (packed attribute)
  // ---------------------------------------------------------------------------

  function supplies(player) {
    const value = Number(player.getAttribute(SUPPLIES_ATTRIBUTE)) || 0;
    return {
      logs: (value & SUPPLIES_LOGS) !== 0,
      clothes: (value & SUPPLIES_CLOTHES) !== 0,
      chickens: (value >> CHICKENS_SHIFT) & 0x7,
      grain: (value >> GRAIN_SHIFT) & 0xf,
    };
  }

  function writeSupplies(player, s) {
    const value =
      (s.logs ? SUPPLIES_LOGS : 0) |
      (s.clothes ? SUPPLIES_CLOTHES : 0) |
      ((s.chickens & 0x7) << CHICKENS_SHIFT) |
      ((s.grain & 0xf) << GRAIN_SHIFT);
    player.setAttribute(SUPPLIES_ATTRIBUTE, value);
  }

  function logAmount(player) {
    let amount = 0;
    for (const itemId of LOG_ITEM_IDS) amount += countItem(player, itemId);
    return amount;
  }

  function chickenWord(count) {
    if (count <= 0) return "no chickens";
    if (count === 1) return "one chicken";
    return `${count} chickens`;
  }

  function grainWord(count) {
    if (count <= 0) return "no grain";
    if (count === 1) return "one bundle of grain";
    return `${count} bundles of grain`;
  }

  /** "I have ..." line, computed before the items are consumed. */
  function describeHeldSupplies(player) {
    const s = supplies(player);
    const logs = !s.logs && logAmount(player) > 0 ? "the logs" : "no logs";
    const chickens = chickenWord(Math.min(countItem(player, RAW_CHICKEN), MAX_CHICKENS - s.chickens));
    const grain = grainWord(Math.min(countItem(player, GRAIN), MAX_GRAIN - s.grain));
    const clothes = !s.clothes && held(player, DIRTY_ROBE) ? "the dirty clothes" : "no dirty clothes";
    return `I have ${logs}, ${chickens}, ${grain} and ${clothes}.`;
  }

  /** Eadgar's "You now need ..." line, computed after the items are consumed. */
  function describeNeededSupplies(player) {
    const s = supplies(player);
    const logs = s.logs ? "no logs" : "the logs";
    const chickens = chickenWord(Math.max(0, MAX_CHICKENS - s.chickens));
    const grain = grainWord(Math.max(0, MAX_GRAIN - s.grain));
    const clothes = s.clothes ? "no dirty clothes" : "the dirty clothes";
    return `You now need ${logs}, ${chickens}, ${grain} and ${clothes}.`;
  }

  function suppliesReady(player) {
    const s = supplies(player);
    return (
      (s.logs || logAmount(player) > 0) &&
      (s.clothes || held(player, DIRTY_ROBE)) &&
      s.chickens + countItem(player, RAW_CHICKEN) >= MAX_CHICKENS &&
      s.grain + countItem(player, GRAIN) >= MAX_GRAIN
    );
  }

  function consumeSupplies(player) {
    const s = supplies(player);
    if (!s.logs) {
      const logId = LOG_ITEM_IDS.find((itemId) => held(player, itemId));
      if (logId !== undefined) {
        player.getInventory().deleteNumber(logId, 1);
        s.logs = true;
      }
    }
    const chickens = Math.min(countItem(player, RAW_CHICKEN), Math.max(0, MAX_CHICKENS - s.chickens));
    if (chickens > 0) {
      player.getInventory().deleteNumber(RAW_CHICKEN, chickens);
      s.chickens += chickens;
    }
    const grain = Math.min(countItem(player, GRAIN), Math.max(0, MAX_GRAIN - s.grain));
    if (grain > 0) {
      player.getInventory().deleteNumber(GRAIN, grain);
      s.grain += grain;
    }
    if (!s.clothes && held(player, DIRTY_ROBE)) {
      player.getInventory().deleteNumber(DIRTY_ROBE, 1);
      s.clothes = true;
    }
    writeSupplies(player, s);
  }

  // ---------------------------------------------------------------------------
  // Parroty Pete varbits
  // ---------------------------------------------------------------------------

  function peteBits(player) {
    return Number(player.getAttribute(PETE_ATTRIBUTE)) || 0;
  }

  function setPeteBit(player, bit) {
    player.setAttribute(PETE_ATTRIBUTE, peteBits(player) | bit);
  }

  // ---------------------------------------------------------------------------
  // Journal
  // ---------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to <col=800000>Sanfew</col>",
        "after completing the <col=800000>Druidic Ritual</col> quest in",
        "<col=800000>Taverley</col>.",
        "",
        "To complete this quest I need <col=800000>Level 31 Herblore</col>.",
        "I also need to have rescued <col=800000>Mad Eadgar</col> from the",
        "<col=800000>Troll Stronghold</col>.",
      ];
    }
    const lines = ["<str>Sanfew asked me to find him some Goutweed.</str>", ""];
    if (stage >= STAGE_COOK_FIRST) {
      lines.push("<str>The Troll Cook will tell me how to find goutweed if I bring him</str>");
      lines.push("<str>a tasty human.</str>");
    }
    if (stage >= STAGE_NEEDS_PARROT) {
      lines.push("<str>Mad Eadgar has a plan.</str>");
    }
    if (stage >= STAGE_PLAN_EXPLAINED) {
      lines.push("<str>I got the parrot Eadgar wanted.</str>");
    }
    if (stage >= STAGE_PARROT_HIDDEN) {
      lines.push("<str>I hid the parrot under the rack in the Troll prison.</str>");
    }
    if (stage >= STAGE_NEEDS_POTION) {
      lines.push("<str>Eadgar wants to make a fake human to give the Troll Cook. I</str>");
      lines.push("<str>gave Eadgar everything he needed.</str>");
    }
    if (stage >= STAGE_NEEDS_PARROT_BACK) {
      lines.push("<str>I made the Troll potion and gave it to Mad Eadgar.</str>");
    }
    if (stage >= STAGE_GOT_PARROT_BACK) {
      lines.push("<str>I fetched the parrot back from the Troll prison rack.</str>");
    }
    if (stage >= STAGE_GOT_FAKE_MAN) {
      lines.push("<str>I gave it to Eadgar and got his fake man.</str>");
    }
    if (stage >= STAGE_GOT_BURNT_MEAT) {
      lines.push("<str>I gave the fake man to the Troll Cook.</str>");
    }
    if (stage >= STAGE_STOREROOM_OPEN) {
      lines.push("<str>I've unlocked the storeroom!</str>");
    }
    if (stage >= STAGE_COMPLETE) {
      lines.push(
        "<str>I snuck into the storeroom and got some goutweed. I gave it to</str>",
        "<str>Sanfew and he taught me the Trollheim Teleport spell.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>"
      );
      return lines;
    }
    lines.push("");
    if (stage === STAGE_STARTED) {
      lines.push("I need to find out where to get <col=800000>Goutweed</col> - <col=800000>Mad Eadgar</col> may be able to help.");
    } else if (stage === STAGE_TOLD_ABOUT_COOK) {
      lines.push("I should ask the <col=800000>Troll Cook</col>.");
    } else if (stage === STAGE_COOK_FIRST || stage === STAGE_COOK_SECOND) {
      lines.push("I need to get <col=800000>a tasty human</col> for the <col=800000>Troll Cook</col>. Mad Eadgar may be able to help.");
    } else if (stage === STAGE_NEEDS_PARROT) {
      lines.push("I need to bring Eadgar a <col=800000>parrot</col> from the <col=800000>Zoo</col>.");
    } else if (stage === STAGE_PLAN_EXPLAINED) {
      lines.push("I need to <col=800000>hide the parrot</col> somewhere it can hear what Trolls expect humans to sound like.");
    } else if (stage === STAGE_PARROT_HIDDEN) {
      lines.push("I should go and find out the rest of <col=800000>Mad Eadgar's</col> plan.");
    } else if (stage === STAGE_NEEDS_ITEMS) {
      const s = supplies(player);
      lines.push("Eadgar wants to make a <col=800000>fake human</col> to give the <col=800000>Troll Cook</col>.");
      lines.push("I still need to bring him:");
      if (!s.logs) lines.push("<col=800000>Logs</col>");
      if (s.chickens < MAX_CHICKENS) {
        lines.push(`<col=800000>${MAX_CHICKENS - s.chickens} raw chicken${MAX_CHICKENS - s.chickens === 1 ? "" : "s"}</col>`);
      }
      if (s.grain < MAX_GRAIN) {
        lines.push(`<col=800000>${MAX_GRAIN - s.grain} sheaf${MAX_GRAIN - s.grain === 1 ? "" : "ves"} of grain</col>`);
      }
      if (!s.clothes) lines.push("<col=800000>Some dirty clothes</col>");
    } else if (stage === STAGE_NEEDS_POTION) {
      lines.push(
        held(player, TROLL_POTION)
          ? "I made the Troll potion. I should go give it to <col=800000>Mad Eadgar</col>"
          : "I need to make a troll truth potion by putting <col=800000>dried, ground troll thistle</col> in a <col=800000>potion of ranarr weed</col>."
      );
    } else if (stage === STAGE_NEEDS_PARROT_BACK) {
      lines.push("I need to fetch the parrot back from the <col=800000>prison rack</col>.");
    } else if (stage === STAGE_GOT_PARROT_BACK) {
      lines.push("I should go tell Eadgar.");
    } else if (stage === STAGE_GOT_FAKE_MAN) {
      lines.push("I should give the fake man to the <col=800000>Troll Cook</col>.");
    } else if (stage === STAGE_GOT_BURNT_MEAT) {
      lines.push("I should get the <col=800000>key to the storeroom</col> from the kitchen drawers and unlock it.");
    } else if (stage >= STAGE_STOREROOM_OPEN) {
      lines.push(
        held(player, GOUTWEED)
          ? "I snuck into the storeroom and got some goutweed. I should bring this to <col=800000>Sanfew</col> and collect my reward."
          : "I should sneak in and get some <col=800000>goutweed</col>."
      );
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HERBLORE, TRUTH_POTION_XP);
  }

  // ---------------------------------------------------------------------------
  // Dialogue selection and conditions
  // ---------------------------------------------------------------------------

  function selectEadgarVariant(player, stage) {
    if (stage < STAGE_STARTED) return null; // Troll Stronghold's Eadgar branch owns this
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-eadgar-after-finishing-the-quest";
    if (stage >= STAGE_GOT_BURNT_MEAT) {
      return "getting-the-goutweed-talking-to-eadgar-after-getting-access-to-the-storeroom";
    }
    if (stage >= STAGE_GOT_FAKE_MAN) {
      return "returning-to-eadgar-with-supplies-talking-to-eadgar-after-getting-the-fake-man";
    }
    if (stage >= STAGE_GOT_PARROT_BACK) {
      return "returning-to-eadgar-with-supplies-talking-to-eadgar-after-taking-the-parrot-out-from-the-rack";
    }
    if (stage >= STAGE_NEEDS_PARROT_BACK) return null; // gap: line not in transcript dump
    if (stage >= STAGE_NEEDS_POTION) {
      return held(player, TROLL_POTION)
        ? "returning-to-eadgar-with-supplies-talking-to-eadgar-with-the-troll-potion"
        : "returning-to-eadgar-with-supplies-talking-to-eadgar-after-learning-to-make-troll-potion";
    }
    if (stage >= STAGE_NEEDS_ITEMS) {
      return "returning-to-eadgar-with-supplies-talking-to-eadgar-with-the-supplies";
    }
    if (stage >= STAGE_PARROT_HIDDEN) {
      return "preparing-the-fake-man-talking-to-eadgar-after-putting-the-parrot-under-the-rack";
    }
    if (stage >= STAGE_PLAN_EXPLAINED) {
      return "preparing-the-fake-man-talking-to-eadgar-before-preparing-the-fake-man";
    }
    if (stage >= STAGE_NEEDS_PARROT) {
      return held(player, DRUNK_PARROT)
        ? "preparing-the-fake-man-talking-to-eadgar-while-holding-the-parrot"
        : "finding-eadgar-taking-to-eadgar-again-before-getting-a-parrot";
    }
    if (stage >= STAGE_COOK_FIRST) return "finding-eadgar-taking-to-eadgar-after-talking-to-burntmeat";
    return "finding-eadgar-taking-to-eadgar-before-talking-to-burntmeat";
  }

  function selectBurntmeatVariant(player, stage) {
    if (stage < STAGE_STARTED) return null;
    if (stage >= STAGE_GOT_BURNT_MEAT) {
      return "returning-to-eadgar-with-supplies-talking-to-burntmeat-after-giving-him-the-fake-man";
    }
    if (stage >= STAGE_GOT_FAKE_MAN && held(player, FAKE_MAN)) {
      return "returning-to-eadgar-with-supplies-talking-to-burntmeat-while-holding-the-fake-man";
    }
    if (stage > STAGE_TOLD_ABOUT_COOK) return "finding-eadgar-talking-to-burntmeat-again";
    return "finding-eadgar-talking-to-burntmeat";
  }

  function selectSanfewVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-sanfew-after-finishing-the-quest";
    if (held(player, GOUTWEED)) return "getting-the-goutweed-talking-to-sanfew-after-getting-goutweed";
    if (stage >= STAGE_NEEDS_ITEMS && !supplies(player).clothes && !held(player, DIRTY_ROBE)) {
      return "obtaining-the-robes-talking-to-sanfew-about-the-robes";
    }
    if (stage >= STAGE_STARTED) return "getting-started-talking-to-sanfew-after-starting-the-quest";
    return "getting-started-talking-to-sanfew";
  }

  function selectTegidVariant(player, stage) {
    if (stage >= STAGE_NEEDS_ITEMS && stage < STAGE_COMPLETE) {
      const s = supplies(player);
      if (!s.clothes && !held(player, DIRTY_ROBE)) return "obtaining-the-robes-talking-to-tegid-about-the-robes";
    }
    return "getting-started-talking-to-tegid";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === EADGAR_NPC_ID) return selectEadgarVariant(player, stage);
    if (npcId === BURNTMEAT_NPC_ID) return selectBurntmeatVariant(player, stage);
    if (npcId === SANFEW_NPC_ID) return selectSanfewVariant(player, stage);
    if (npcId === TEGID_NPC_ID) return selectTegidVariant(player, stage);
    if (npcId === PARROTY_PETE_NPC_ID) return "visiting-ardougne-talking-to-parroty-pete";
    if (GUARD_NPC_IDS.has(npcId)) return "getting-the-goutweed-being-caught-by-a-goutweed-guard-troll";
    return null;
  }

  function answerCondition({ player, pages, text }) {
    // Conditions on other pages that happen to share wording are not ours.
    if (Array.isArray(pages) && !pages.some((entry) => entry && entry.page === PAGE)) return null;
    const value = String(text).toLowerCase();
    const base = hasBaseRequirements(player);
    if (value.includes("requirements") && value.includes("eadgar")) {
      if (value.includes("doesn't have") || value.includes("does not have")) return !base;
      if (value.includes("except herblore")) return base && !hasHerblore(player);
      if (value.includes("has the requirements")) return base && hasHerblore(player);
    }
    if (value.includes("boosted herblore")) return hasHerblore(player) && baseHerblore(player) < HERBLORE_LEVEL;
    const stage = quest.getStage(player);
    if (value.includes("talked to eadgar before talking to burntmeat") && !value.includes("did not")) {
      return stage === STAGE_TOLD_ABOUT_COOK;
    }
    if (value.includes("did not talk to eadgar before talking to burntmeat")) {
      return stage === STAGE_COOK_FIRST;
    }
    if (value.includes("not spoken to eadgar with the drunk parrot")) {
      return stage < STAGE_PLAN_EXPLAINED;
    }
    if (value.includes("spoken to eadgar with the drunk parrot")) {
      return stage >= STAGE_PLAN_EXPLAINED;
    }
    if (value.includes("not yet given all the supplies")) return !suppliesReady(player);
    if (value.includes("lost the parrot")) return !held(player, DRUNK_PARROT);
    if (value.includes("still has the parrot")) return held(player, DRUNK_PARROT);
    if (value.includes("still has the fake man")) return held(player, FAKE_MAN);
    if (value.includes("lost the fake man")) return !held(player, FAKE_MAN);
    if (value.includes("already has the key")) return held(player, STOREROOM_KEY);
    if (value.includes("no inventory space")) return freeSlots(player) <= 0;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Dialogue events
  // ---------------------------------------------------------------------------

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== SANFEW_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleEadgarLine(event) {
    const { player } = event;
    let text = event.text;
    if (text.includes("{{")) {
      text = text.replace(/\{\{[^}]*\}\}/g, "");
      event.text = text;
    }
    if (text.startsWith("I have [no/the] logs")) {
      event.text = describeHeldSupplies(player);
      consumeSupplies(player);
      return;
    }
    if (text.startsWith("You now need [no/the] logs")) {
      event.text = describeNeededSupplies(player);
      return;
    }
    const stage = quest.getStage(player);
    if (text.startsWith("Goutweed is used as an ingredient in troll cooking")) {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_TOLD_ABOUT_COOK);
      return;
    }
    if (text.startsWith("At the zoo, where else?")) {
      if (stage < STAGE_NEEDS_PARROT) quest.setStage(player, STAGE_NEEDS_PARROT);
      return;
    }
    if (text.startsWith("That's the plan.")) {
      if (stage < STAGE_PLAN_EXPLAINED) quest.setStage(player, STAGE_PLAN_EXPLAINED);
      return;
    }
    if (text.startsWith("I hid the parrot under the rack in the troll prison.")) {
      if (stage < STAGE_NEEDS_ITEMS) quest.setStage(player, STAGE_NEEDS_ITEMS);
      return;
    }
    if (text.startsWith("Okay, I'll be back with that soon.")) {
      if (stage >= STAGE_NEEDS_ITEMS && stage < STAGE_NEEDS_POTION && suppliesReady(player)) {
        quest.setStage(player, STAGE_NEEDS_POTION);
      }
      return;
    }
    if (text.startsWith("I've got the troll truth potion.")) {
      if (held(player, TROLL_POTION)) player.getInventory().deleteNumber(TROLL_POTION, 1);
      if (stage < STAGE_NEEDS_PARROT_BACK) quest.setStage(player, STAGE_NEEDS_PARROT_BACK);
    }
  }

  function handleBurntmeatLine(event) {
    if (!event.text.startsWith("Right. I'll just...go fetch that for you then. Bye!")) return;
    const stage = quest.getStage(event.player);
    if (stage >= STAGE_COOK_FIRST) return;
    quest.setStage(event.player, stage >= STAGE_TOLD_ABOUT_COOK ? STAGE_COOK_SECOND : STAGE_COOK_FIRST);
  }

  function handleDialogueLine(event) {
    if (typeof event.text !== "string") return;
    if (event.npcId === EADGAR_NPC_ID) return handleEadgarLine(event);
    if (event.npcId === BURNTMEAT_NPC_ID) return handleBurntmeatLine(event);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === COMPLETE_ACTION_ID && npcId === SANFEW_NPC_ID) {
      if (quest.isComplete(player) || !held(player, GOUTWEED)) return;
      player.getInventory().deleteNumber(GOUTWEED, 1);
      quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === RECEIVE_PARROT_ACTION_ID) {
      if (!held(player, DRUNK_PARROT)) player.getInventory().adds(DRUNK_PARROT, 1);
      event.handled = true;
      return;
    }
    if (stepId === GIVE_PINEAPPLE_ACTION_ID) {
      player.getInventory().deleteNumber(PINEAPPLE_CHUNKS, 1);
      event.handled = true;
      return;
    }
    if (stepId === GIVE_PARROT_ACTION_ID) {
      player.getInventory().deleteNumber(DRUNK_PARROT, 1);
      event.handled = true;
      return;
    }
    if (stepId === RECEIVE_FAKE_MAN_ACTION_ID) {
      player.getInventory().deleteNumber(DRUNK_PARROT, 1);
      if (!held(player, FAKE_MAN)) player.getInventory().adds(FAKE_MAN, 1);
      if (quest.getStage(player) < STAGE_GOT_FAKE_MAN) quest.setStage(player, STAGE_GOT_FAKE_MAN);
      event.handled = true;
      return;
    }
    if (stepId === GIVE_FAKE_MAN_ACTION_ID) {
      player.getInventory().deleteNumber(FAKE_MAN, 1);
      event.handled = true;
      return;
    }
    if (stepId === RECEIVE_BURNT_MEAT_ACTION_ID) {
      if (!held(player, BURNT_MEAT)) player.getInventory().adds(BURNT_MEAT, 1);
      if (quest.getStage(player) < STAGE_GOT_BURNT_MEAT) quest.setStage(player, STAGE_GOT_BURNT_MEAT);
      event.handled = true;
    }
  }

  function handleCondition({ player, npcId, stepId }) {
    if (npcId !== EADGAR_NPC_ID || stepId !== LOST_FAKE_MAN_CONDITION_ID) return;
    if (!held(player, FAKE_MAN)) player.getInventory().adds(FAKE_MAN, 1);
  }

  function handleChoice({ player, npcId, option }) {
    const value = String(option ?? "").toLowerCase();
    if (npcId === TEGID_NPC_ID) {
      if (quest.getStage(player) !== STAGE_NEEDS_ITEMS) return;
      if (value.includes("sanfew won't be happy") || value.includes("give me those robes")) {
        const s = supplies(player);
        if (!s.clothes && !held(player, DIRTY_ROBE)) player.getInventory().adds(DIRTY_ROBE, 1);
      }
      return;
    }
    if (npcId === PARROTY_PETE_NPC_ID) {
      if (value.includes("when did you add it")) setPeteBit(player, PETE_WHEN_BIT);
      if (value.includes("what do you feed them")) setPeteBit(player, PETE_FEED_BIT);
      return;
    }
    if (npcId === SANFEW_NPC_ID && value.includes("more goutweed") && held(player, GOUTWEED)) {
      player.getInventory().deleteNumber(GOUTWEED, 1);
      player.getInventory().adds(RANARR_WEED, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Gameplay interactions
  // ---------------------------------------------------------------------------

  function playVariant(player, npcId, variant) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  function isFireObject(object) {
    return object?.getDefinition?.()?.getName?.() === "Fire";
  }

  function makeAlcoChunks(player, liquorId) {
    if (quest.isComplete(player)) {
      player.sendMessage("You don't need to make any more.");
      return;
    }
    const bits = peteBits(player);
    if ((bits & PETE_WHEN_BIT) === 0 || (bits & PETE_FEED_BIT) === 0) {
      player.sendMessage("Why would you want to do that?");
      return;
    }
    if (held(player, DRUNK_PARROT)) {
      player.sendMessage("You don't need to make any more.");
      return;
    }
    player.getInventory().deleteNumber(PINEAPPLE_CHUNKS, 1);
    player.getInventory().deleteNumber(liquorId, 1);
    player.getInventory().adds(ALCO_CHUNKS, 1);
  }

  function useOnAviaryHatch(player, itemId) {
    if (itemId === ALCO_CHUNKS) {
      if (held(player, DRUNK_PARROT)) {
        player.sendMessage("You've already caught one.");
        return;
      }
      player.getInventory().deleteNumber(ALCO_CHUNKS, 1);
      const played = playVariant(player, PARROTY_PETE_NPC_ID, "visiting-ardougne-using-alco-chunks-on-the-hatch");
      if (!played && !held(player, DRUNK_PARROT)) player.getInventory().adds(DRUNK_PARROT, 1);
      return;
    }
    if (itemId === PINEAPPLE_CHUNKS) {
      player.getInventory().deleteNumber(PINEAPPLE_CHUNKS, 1);
      playVariant(player, PARROTY_PETE_NPC_ID, "visiting-ardougne-using-pineapple-chunks-on-the-hatch");
      return;
    }
    if (LIQUOR_ITEM_IDS.has(itemId)) {
      playVariant(player, PARROTY_PETE_NPC_ID, "visiting-ardougne-using-vodka-on-the-aviary-hatch");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId === TROLL_STEW_LOC_ID) {
      event.handled = true;
      player.sendMessage("You decide to leave Eadgar's stew alone.");
      return;
    }
    if (objectId === AVIARY_HATCH_LOC_ID) {
      event.handled = true;
      useOnAviaryHatch(player, itemId);
      return;
    }
    if (objectId === RACK_LOC_ID) {
      if (itemId !== DRUNK_PARROT) return;
      event.handled = true;
      if (quest.getStage(player) === STAGE_PLAN_EXPLAINED) {
        player.getInventory().deleteNumber(DRUNK_PARROT, 1);
        quest.setStage(player, STAGE_PARROT_HIDDEN);
        player.sendMessage("You hide the parrot under the torture rack.");
      } else {
        player.sendMessage("Why would you want to do that?");
      }
      return;
    }
    if (itemId === TROLL_THISTLE && isFireObject(event.object)) {
      event.handled = true;
      player.getInventory().deleteNumber(TROLL_THISTLE, 1);
      player.getInventory().adds(DRIED_THISTLE, 1);
      player.sendMessage("You dry the troll thistle over the fire.");
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = (x, y) =>
      (usedItemId === x && usedWithItemId === y) || (usedItemId === y && usedWithItemId === x);
    const pineOnLiquor =
      (usedItemId === PINEAPPLE_CHUNKS && LIQUOR_ITEM_IDS.has(usedWithItemId)) ||
      (usedWithItemId === PINEAPPLE_CHUNKS && LIQUOR_ITEM_IDS.has(usedItemId));
    if (pineOnLiquor) {
      event.handled = true;
      makeAlcoChunks(player, LIQUOR_ITEM_IDS.has(usedItemId) ? usedItemId : usedWithItemId);
      return;
    }
    if (pair(TROLL_THISTLE, RANARR_POTION_UNF)) {
      event.handled = true;
      player.sendMessage("I need to dry it over a fire first.");
      return;
    }
    if (pair(DRIED_THISTLE, RANARR_POTION_UNF)) {
      event.handled = true;
      player.sendMessage("It's too big to fit in the vial.");
      return;
    }
    if (pair(DRIED_THISTLE, PESTLE_AND_MORTAR)) {
      event.handled = true;
      player.getInventory().deleteNumber(DRIED_THISTLE, 1);
      player.getInventory().adds(GROUND_THISTLE, 1);
      player.sendMessage("You grind the Troll Thistle.");
      return;
    }
    if (pair(GROUND_THISTLE, RANARR_POTION_UNF)) {
      event.handled = true;
      const stage = quest.getStage(player);
      if (stage < STAGE_NEEDS_POTION) {
        player.sendMessage("Hmmm...perhaps I shouldn't try and mix these together. It might have unpredictable results...");
      } else if (stage > STAGE_NEEDS_POTION) {
        player.sendMessage("You don't need to make any more.");
      } else {
        player.getInventory().deleteNumber(GROUND_THISTLE, 1);
        player.getInventory().deleteNumber(RANARR_POTION_UNF, 1);
        player.getInventory().adds(TROLL_POTION, 1);
        player.sendMessage("You add the ground Troll Thistle to the potion.");
      }
    }
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== FAKE_MAN || event.target?.getId?.() !== BURNTMEAT_NPC_ID) return;
    event.handled = true;
    if (quest.getStage(event.player) !== STAGE_GOT_FAKE_MAN) return;
    playVariant(
      event.player,
      BURNTMEAT_NPC_ID,
      "returning-to-eadgar-with-supplies-talking-to-burntmeat-while-holding-the-fake-man"
    );
  }

  function handleNpcInteraction(event) {
    if (event.npcId !== THISTLE_NPC_ID) return;
    event.handled = true;
    event.player.getInventory().adds(TROLL_THISTLE, 1);
    event.player.sendMessage("You pick the Troll Thistle.");
  }

  function searchRack(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_PARROT_HIDDEN && stage <= STAGE_NEEDS_POTION) {
      playVariant(player, PARROT_NPC_ID, "preparing-the-fake-man-search-rack-after-putting-parrot-under-it");
      return;
    }
    if (stage === STAGE_NEEDS_PARROT_BACK) {
      player.getInventory().adds(DRUNK_PARROT, 1);
      quest.setStage(player, STAGE_GOT_PARROT_BACK);
      const played = playVariant(player, PARROT_NPC_ID, "returning-to-eadgar-with-supplies-taking-the-parrot-from-under-the-rack");
      if (!played) player.sendMessage("You look under the rack and find the drunk parrot.");
      return;
    }
    player.sendMessage("You look under the rack but find nothing.");
  }

  function searchDrawers(player) {
    player.sendMessage("You search the drawers...");
    if (quest.getStage(player) < STAGE_GOT_BURNT_MEAT || held(player, STOREROOM_KEY)) {
      player.sendMessage("You don't find anything.");
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You open the fake bottom of the drawer and see a key, but don't have space to take it.");
      return;
    }
    player.getInventory().adds(STOREROOM_KEY, 1);
    player.sendMessage("You open the fake bottom of the drawer and find the storeroom key.");
  }

  function useStoreroomDoor(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_STOREROOM_OPEN) {
      player.sendMessage("The storeroom door is already unlocked.");
      return;
    }
    if (stage >= STAGE_GOT_BURNT_MEAT && held(player, STOREROOM_KEY)) {
      player.getInventory().deleteNumber(STOREROOM_KEY, 1);
      quest.setStage(player, STAGE_STOREROOM_OPEN);
      player.sendMessage("You unlock the door.");
      return;
    }
    player.sendMessage("You need to find the right key to open this door.");
  }

  function takeGoutweed(player) {
    player.getInventory().adds(GOUTWEED, 1);
    player.sendMessage("You've found some goutweed!");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === RACK_LOC_ID) {
      event.handled = true;
      searchRack(player);
      return;
    }
    if (KITCHEN_DRAWERS_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchDrawers(player);
      return;
    }
    if (objectId === STOREROOM_DOOR_LOC_ID) {
      event.handled = true;
      useStoreroomDoor(player);
      return;
    }
    if (objectId === GOUTWEED_CRATE_LOC_ID) {
      event.handled = true;
      takeGoutweed(player);
      return;
    }
    if (objectId === LAUNDRY_BASKET_LOC_ID) {
      event.handled = true;
      player.sendMessage("You search the laundry basket... It's full of dirty robes.");
    }
  }

  function releaseDrunkParrot(event) {
    event.player.getInventory().deleteNumber(DRUNK_PARROT, 1);
    event.player.sendMessage("You release the parrot, and it flies away.");
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(SUPPLIES_ATTRIBUTE);
  api.persistAttribute(PETE_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "eadgars_ruse",
    name: "Eadgar's Ruse",
    varpId: VARP_EADGARS_RUSE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.HERBLORE.getIndex(), amount: TRUTH_POTION_XP, label: "Herblore" }],
    scrollItemId: GOUTWEED,
    rewardItemLabel: "The ability to use the Trollheim Teleport spell",
    otherRewards: ["Goutweed can be exchanged with Sanfew for herbs"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onNpcInteraction(handleNpcInteraction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction("Drunk parrot", { Release: releaseDrunkParrot });
  api.onPlayerLogin(handleLogin);
};
