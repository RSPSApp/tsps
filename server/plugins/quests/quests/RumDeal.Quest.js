/**
 * Rum Deal (members).
 *
 * The words come from the "Rum Deal" transcript page; this plugin selects the
 * variant for Pirate Pete, Captain Braindeath, 50% Luke, Davey, Captain Donnie,
 * the zombie protesters/swabs and the brewers (all indexed), answers the prose
 * conditions, runs the start (the page has no quest hook, so the knock-out
 * action and the "Keep the money" choice start it), the zombie-pirate 'rum'
 * brewing (blindweed patch -> intake hopper -> stagnant water -> sluglings/
 * Karamthulhu -> pressure barrel -> possessed brewing controls -> fever spider),
 * the Holy Wrench blessing, the Evil Spirit fight and the completion action.
 *
 * Stages (varp 600, real OSRS stage map): 1 agreed to help Pete, 2 knocked out
 * on the island, 3 met Braindeath (no room for seed), 4 given seeds, 5 grown
 * blindweed, 6 shown blindweed, 7 blindweed added, 8 fetch water, 9 water
 * collected, 10 water added, 11 catch creatures, 12 pressurised, 13 bless
 * wrench, 14 spirit banished, 15 kill spider, 16 spider added, 17 collect
 * swill, 18 told Donnie, 19 complete.
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/quest/member/rum_deal/RumDeal.kt
 * (stage map + dialogue from data/quest/members/rum_deal/rum_deal.varps.toml and
 * data/area/morytania/braindeath_island/*). Rewards per the OSRS Wiki: 2 Quest
 * points, 7,000 Prayer/Fishing/Farming XP and the Holy wrench.
 *
 * Gaps: the intro cutscene camera/transform, the grow-cutscene and the fishing
 * roll are text/state only; the blindweed growth is a flat 60s timer instead of
 * the real farming tick cycle; the bailing bucket named in the issue belongs to
 * Fishing Trawler, not this quest (the reference uses a plain bucket); 50% Luke
 * and the gate are handled by NPC dialogue + a one-tile pass-through rather than
 * the reference's object swap; zombie swabs only play the six insult variants
 * (roam-away/re-intimidate are not fired); the Fishing spot uses NPC 635 (the
 * only spot spawned on Braindeath Island in this cache).
 */
module.exports = function registerRumDealQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Rum Deal";
  const VARP_RUM_DEAL = 600; // real OSRS varp, unused in this repo

  const STAGE_STARTED = 1;
  const STAGE_KNOCKED_OUT = 2;
  const STAGE_MET_BRAINDEATH = 3;
  const STAGE_GIVEN_SEEDS = 4;
  const STAGE_GROWN_BLINDWEED = 5;
  const STAGE_SHOW_BLINDWEED = 6;
  const STAGE_BLINDWEED_ADDED = 7;
  const STAGE_FETCH_WATER = 8;
  const STAGE_COLLECTED_WATER = 9;
  const STAGE_WATER_ADDED = 10;
  const STAGE_CATCH_CREATURES = 11;
  const STAGE_PRESSURISED = 12;
  const STAGE_BLESS_WRENCH = 13;
  const STAGE_SPIRIT_BANISHED = 14;
  const STAGE_KILL_SPIDER = 15;
  const STAGE_SPIDER_ADDED = 16;
  const STAGE_COLLECT_SWILL = 17;
  const STAGE_TOLD_DONNIE = 18;
  const STAGE_COMPLETE = 19;

  const BLINDWEED_SEED = ItemIdentifiers.BLINDWEED_SEED; // 6710
  const BLINDWEED = ItemIdentifiers.BLINDWEED; // 6711
  const STAGNANT_WATER = ItemIdentifiers.BUCKET_OF_WATER_3; // 6712 (stagnant)
  const WRENCH = ItemIdentifiers.WRENCH; // 6713
  const HOLY_WRENCH = ItemIdentifiers.HOLY_WRENCH; // 6714
  const SLUGLINGS = ItemIdentifiers.SLUGLINGS; // 6715
  const KARAMTHULHU = ItemIdentifiers.KARAMTHULHU; // 6716
  const FEVER_SPIDER_BODY = ItemIdentifiers.FEVER_SPIDER_BODY; // 6718
  const UNSANITARY_SWILL = ItemIdentifiers.UNSANITARY_SWILL; // 6719
  const BUCKET = ItemIdentifiers.BUCKET; // 1925
  const FISHBOWL = ItemIdentifiers.FISHBOWL; // 6668
  const BIG_FISHING_NET = ItemIdentifiers.BIG_FISHING_NET; // 305
  const FISHBOWL_AND_NET = ItemIdentifiers.FISHBOWL_AND_NET; // 6673
  const RAKE = ItemIdentifiers.RAKE; // 5341
  const SEED_DIBBER = ItemIdentifiers.SEED_DIBBER; // 5343
  const WATERING_CAN = ItemIdentifiers.WATERING_CAN; // 5331
  const SLAYER_GLOVES = ItemIdentifiers.SLAYER_GLOVES; // 6708

  const PETE_NPC_IDS = new Set([
    NpcIdentifiers.PIRATE_PETE, // 601
    NpcIdentifiers.PIRATE_PETE_2, // 602
    NpcIdentifiers.PIRATE_PETE_3, // 3389
    NpcIdentifiers.PIRATE_PETE_4, // 4814
    NpcIdentifiers.PIRATE_PETE_5, // 4816
  ]);
  const BRAINDEATH_NPC_ID = NpcIdentifiers.CAPTAIN_BRAINDEATH; // 603
  const LUKE_NPC_ID = NpcIdentifiers._50_LUKE; // 604
  const DAVEY_NPC_ID = NpcIdentifiers.DAVEY; // 605
  const DONNIE_NPC_ID = NpcIdentifiers.CAPTAIN_DONNIE; // 606
  const PROTESTER_NPC_IDS = new Set([
    NpcIdentifiers.ZOMBIE_PROTESTER, // 607
    NpcIdentifiers.ZOMBIE_PROTESTER_2, // 608
    NpcIdentifiers.ZOMBIE_PROTESTER_3, // 609
    NpcIdentifiers.ZOMBIE_PROTESTER_4, // 610
    NpcIdentifiers.ZOMBIE_PROTESTER_5, // 611
    NpcIdentifiers.ZOMBIE_PROTESTER_6, // 612
  ]);
  const SWAB_NPC_IDS = new Set([
    NpcIdentifiers.ZOMBIE_SWAB, // 619
    NpcIdentifiers.ZOMBIE_SWAB_2, // 620
    NpcIdentifiers.ZOMBIE_SWAB_3, // 621
    NpcIdentifiers.ZOMBIE_SWAB_4, // 622
    NpcIdentifiers.ZOMBIE_SWAB_5, // 623
    NpcIdentifiers.ZOMBIE_SWAB_6, // 624
  ]);
  const BREWER_NPC_IDS = new Set([
    NpcIdentifiers.BREWER, // 627
    NpcIdentifiers.BREWER_2, // 628
    NpcIdentifiers.BREWER_3, // 629
    NpcIdentifiers.BREWER_4, // 630
    NpcIdentifiers.BREWER_5, // 631
    NpcIdentifiers.BREWER_6, // 632
    NpcIdentifiers.BREWER_7, // 633
    NpcIdentifiers.BREWER_8, // 634
  ]);
  const EVIL_SPIRIT_NPC_ID = NpcIdentifiers.EVIL_SPIRIT; // 625
  const FEVER_SPIDER_NPC_ID = NpcIdentifiers.FEVER_SPIDER; // 626
  const FISHING_SPOT_NPC_ID = NpcIdentifiers.FISHING_SPOT; // 635, only spawned on Braindeath

  const INTAKE_HOPPER_OBJECT_ID = ObjectIdentifiers.HOPPER_2; // 10170
  const PRESSURE_BARREL_OBJECT_ID = ObjectIdentifiers.PRESSURE_BARREL; // 10171
  const PRESSURE_LEVER_OBJECT_IDS = new Set([
    ObjectIdentifiers.PRESSURE_LEVER, // 10165
    ObjectIdentifiers.PRESSURE_LEVER_2, // 10166
  ]);
  const STAGNANT_LAKE_OBJECT_ID = ObjectIdentifiers.STAGNANT_LAKE; // 10105
  const OUTPUT_TAP_OBJECT_ID = ObjectIdentifiers.OUTPUT_TAP; // 10148
  const BREWING_CONTROL_OBJECT_IDS = new Set([
    ObjectIdentifiers.BREWING_CONTROL, // 10142
    ObjectIdentifiers.BREWING_CONTROL_2, // 10143
    ObjectIdentifiers.BREWING_CONTROL_3, // 10144
  ]);
  const TOOL_CUPBOARD_OBJECT_IDS = new Set([
    ObjectIdentifiers.CUPBOARD_34, // 10162
    ObjectIdentifiers.OPEN_CUPBOARD_4, // 10163
  ]);
  const BLINDWEED_PATCH_OBJECT_IDS = new Set([
    ObjectIdentifiers.BLINDWEED_PATCH, // 10097
    ObjectIdentifiers.BLINDWEED_PATCH_2, // 10098
    ObjectIdentifiers.BLINDWEED_PATCH_3, // 10099
    ObjectIdentifiers.BLINDWEED_PATCH_4, // 10100
    ObjectIdentifiers.BLINDWEED_PATCH_5, // 10101
    ObjectIdentifiers.BLINDWEED_PATCH_6, // 10102
  ]);
  const TRASHED_PATCH_OBJECT_ID = ObjectIdentifiers.TRASHED_PATCH; // 10103
  const GATE_OBJECT_IDS = new Set([
    ObjectIdentifiers.GATE_96, // 10172
    ObjectIdentifiers.GATE_104, // 11771
  ]);

  const INTRO_ATTRIBUTE = "quest.rum_deal.intro";
  const PLANTED_ATTRIBUTE = "quest.rum_deal.planted";
  const SLUGLINGS_ATTRIBUTE = "quest.rum_deal.slugs";
  const KARAMTHULHU_ATTRIBUTE = "quest.rum_deal.karam";
  const SPIRIT_ATTRIBUTE = "quest.rum_deal.spirit";

  // ponytail: flat growth timer; swap to the Farming plugin's tick data if the
  // patch ever needs real growth stages.
  const BLINDWEED_GROWTH_MS = 60000;

  const START_HOOK = "quest:rum-deal:start";
  const CUPBOARD_VARIANT = "getting-your-beer-ings-searching-the-basement-cupboard-for-farming-supplies";

  let quest;
  const spirits = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  const hasFreeSlot = (player) => freeSlots(player) > 0;
  const level = (player, skill) => player.getSkillManager().getCurrentLevel(skill);

  function meetsRequirements(player) {
    return (
      level(player, Skill.FARMING) >= 40 &&
      level(player, Skill.FISHING) >= 50 &&
      level(player, Skill.PRAYER) >= 47 &&
      level(player, Skill.CRAFTING) >= 42 &&
      level(player, Skill.SLAYER) >= 42
    );
  }

  function wearingSlayerGloves(player) {
    return player.getEquipment().get(Equipment.HANDS_SLOT)?.getId?.() === SLAYER_GLOVES;
  }

  function plantedAt(player) {
    return Number(player.getAttribute(PLANTED_ATTRIBUTE)) || 0;
  }

  function blindweedGrown(player) {
    const planted = plantedAt(player);
    return planted > 0 && Date.now() - planted >= BLINDWEED_GROWTH_MS;
  }

  function introPlayed(player) {
    return Boolean(Number(player.getAttribute(INTRO_ATTRIBUTE)) || 0);
  }

  function giveIfMissing(player, itemId) {
    if (!held(player, itemId) && hasFreeSlot(player)) player.getInventory().adds(itemId, 1);
  }

  function requiredItemLine(player, skill, amount, label) {
    return level(player, skill) >= amount
      ? `<str>${label}</str>`
      : `<col=800000>${label}</col>`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Pirate Pete</col>",
        "in <col=800000>Port Phasmatys</col>.",
        "",
        "To complete this quest I need:",
        requiredItemLine(player, Skill.FARMING, 40, "40 Farming"),
        requiredItemLine(player, Skill.FISHING, 50, "50 Fishing"),
        requiredItemLine(player, Skill.PRAYER, 47, "47 Prayer"),
        requiredItemLine(player, Skill.CRAFTING, 42, "42 Crafting"),
        requiredItemLine(player, Skill.SLAYER, 42, "42 Slayer"),
        "To have completed <col=800000>Zogre Flesh Eaters</col>.",
        "To be able to defeat a level 150 monster.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I spoke to Pirate Pete and agreed to find his family sword.</str>",
        "<str>I helped Captain Braindeath brew a batch of 'rum' for the</str>",
        "<str>zombie pirates, banished the Evil Spirit from the brewing</str>",
        "<str>controls and got Captain Donnie drunk.</str>",
        "",
        "<str>Braindeath decided to stay on the island and keep the</str>",
        "<str>pirates drunk. I was rewarded with the Holy wrench.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_TOLD_DONNIE) {
      return [
        "I have spoken to <col=800000>Captain Donnie</col> and learned of",
        "<col=800000>Rabid Jack</col>. I should tell Captain Braindeath.",
      ];
    }
    if (stage >= STAGE_COLLECT_SWILL) {
      return [
        "I have added the Fever Spider body to the hopper and the",
        "vat is full of 'rum'. I should fill my bucket from the",
        "<col=800000>Output Tap</col> and take it to <col=800000>Captain Donnie</col>.",
      ];
    }
    if (stage >= STAGE_SPIDER_ADDED) {
      return ["I have added the Fever Spider body; I should speak to Captain Braindeath."];
    }
    if (stage >= STAGE_KILL_SPIDER) {
      return [
        "I must kill a <col=800000>Fever Spider</col> (wearing Slayer gloves)",
        "and cram its body into the <col=800000>Intake Hopper</col>.",
      ];
    }
    if (stage >= STAGE_SPIRIT_BANISHED) {
      return ["I banished the Evil Spirit; Captain Braindeath wants one more ingredient."];
    }
    if (stage >= STAGE_BLESS_WRENCH) {
      return held(player, HOLY_WRENCH)
        ? ["I have the <col=800000>Holy Wrench</col>; I should strike the Brewing Controls."]
        : ["I should get my <col=800000>Wrench</col> blessed by one of the brewers."];
    }
    if (stage >= STAGE_PRESSURISED) {
      return [
        "I have pressurised the sea creatures. The brewing equipment",
        "is possessed; Captain Braindeath gave me a wrench to sort it out.",
      ];
    }
    if (stage >= STAGE_CATCH_CREATURES) {
      return [
        "I must fish five sea creatures (Sluglings/Karamthulhu) with the",
        "fishbowl and big net, stuff them into the <col=800000>Pressure Barrel</col>",
        "in the attic and pressurise them.",
      ];
    }
    if (stage >= STAGE_WATER_ADDED) {
      return ["I poured the water into the hopper; Captain Braindeath wants more ingredients."];
    }
    if (stage >= STAGE_COLLECTED_WATER) {
      return ["I have the stagnant water; I should pour it into the Intake Hopper."];
    }
    if (stage >= STAGE_FETCH_WATER) {
      return [
        "I must get past <col=800000>50% Luke</col> and fetch a bucket of",
        "stagnant water from the lake on the volcano to the north.",
      ];
    }
    if (stage >= STAGE_BLINDWEED_ADDED) {
      return ["I added the Blindweed to the hopper; I should speak to Captain Braindeath."];
    }
    if (stage >= STAGE_SHOW_BLINDWEED) {
      return ["I should shove my <col=800000>Blindweed</col> into the <col=800000>Intake Hopper</col>."];
    }
    if (stage >= STAGE_GROWN_BLINDWEED) {
      return held(player, BLINDWEED)
        ? ["I have grown some Blindweed; I should show it to Captain Braindeath."]
        : ["I lost my Blindweed; Captain Braindeath may have some put aside."];
    }
    if (stage >= STAGE_GIVEN_SEEDS) {
      return [
        "I must grow some <col=800000>Blindweed</col> in the patch outside.",
        "Captain Braindeath said to intimidate the Zombie swabs guarding it.",
      ];
    }
    if (stage >= STAGE_MET_BRAINDEATH) {
      return ["Captain Braindeath tried to give me a Blindweed seed, but I had no room."];
    }
    if (stage >= STAGE_KNOCKED_OUT) {
      return ["Pirate Pete knocked me out and had me taken to Braindeath Island."];
    }
    return ["I agreed to help <col=800000>Pirate Pete</col> find his family sword."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 7000);
    player.getSkillManager().addExperiences(Skill.FISHING, 7000);
    player.getSkillManager().addExperiences(Skill.FARMING, 7000);
    player.setAttribute(PLANTED_ATTRIBUTE, 0);
    player.setAttribute(SLUGLINGS_ATTRIBUTE, 0);
    player.setAttribute(KARAMTHULHU_ATTRIBUTE, 0);
    player.setAttribute(SPIRIT_ATTRIBUTE, 0);
    clearSpirit(player);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (PETE_NPC_IDS.has(npcId)) {
      return stage >= STAGE_STARTED
        ? "setting-out-talking-to-pirate-pete-talking-to-pete-again"
        : "setting-out-talking-to-pirate-pete";
    }
    if (npcId === BRAINDEATH_NPC_ID) {
      if (stage < STAGE_KNOCKED_OUT) return null;
      if (stage === STAGE_KNOCKED_OUT) {
        return introPlayed(player)
          ? "setting-out-meeting-captain-braindeath"
          : "setting-out-cutscene-1";
      }
      if (stage <= STAGE_MET_BRAINDEATH) return "setting-out-meeting-captain-braindeath";
      if (stage === STAGE_GIVEN_SEEDS) {
        return "getting-your-beer-ings-talking-to-captain-braindeath-again";
      }
      if (stage === STAGE_GROWN_BLINDWEED) {
        return held(player, BLINDWEED)
          ? "brewing-rum-talking-to-captain-braindeath-after-getting-blindweed"
          : "brewing-rum-if-the-player-has-lost-the-blindweed";
      }
      if (stage === STAGE_SHOW_BLINDWEED) return "brewing-rum-before-putting-blindweed-in-the-hopper";
      if (stage === STAGE_BLINDWEED_ADDED) {
        return "stagnant-water-talking-to-captain-braindeath-after-using-blindweed-on-the-hopper";
      }
      if (stage === STAGE_FETCH_WATER) {
        return "stagnant-water-talking-to-captain-braindeath-again-before-getting-stagnant-water";
      }
      if (stage === STAGE_COLLECTED_WATER) {
        return "stagnant-water-talking-to-captain-braindeath-before-pouring-in-the-stagnant-in-the-hopper";
      }
      if (stage === STAGE_WATER_ADDED) {
        return "sluglings-talking-to-captain-braindeath-after-using-the-water-on-the-hopper";
      }
      if (stage === STAGE_CATCH_CREATURES) {
        return "sluglings-talking-to-captain-braindeath-again-before-catching-the-sluglings";
      }
      if (stage === STAGE_PRESSURISED) {
        return "evil-spirit-talking-to-captain-braindeath-after-filling-the-pressure-barrel";
      }
      if (stage === STAGE_BLESS_WRENCH) {
        return held(player, HOLY_WRENCH)
          ? "evil-spirit-talking-to-captain-braindeath-with-the-holy-wrench"
          : "evil-spirit-talking-to-captain-braindeath-again";
      }
      if (stage === STAGE_SPIRIT_BANISHED) {
        return "fever-spider-talking-to-captain-braindeath-after-killing-the-evil-spirit";
      }
      if (stage === STAGE_KILL_SPIDER) {
        return "fever-spider-talking-to-captain-braindeath-again-before-getting-the-spider-corpse";
      }
      if (stage === STAGE_SPIDER_ADDED) {
        return "dissolving-the-protest-talking-to-captain-braindeath-after-using-the-spider-carcass-on-the-hopper";
      }
      if (stage === STAGE_COLLECT_SWILL) {
        return "dissolving-the-protest-talking-to-captain-braindeath-before-talking-to-captain-donnie";
      }
      if (stage === STAGE_TOLD_DONNIE) {
        return "dissolving-the-protest-talking-to-captain-braindeath-after-talking-to-captain-donnie";
      }
      return null;
    }
    if (npcId === LUKE_NPC_ID) {
      if (stage >= STAGE_COLLECTED_WATER) return "stagnant-water-returning-through-the-gate";
      if (stage >= STAGE_FETCH_WATER) return "stagnant-water-sneaking-past-50-luke";
      return "getting-your-beer-ings-trying-to-sneak-past-50-luke-too-early";
    }
    if (npcId === DAVEY_NPC_ID) {
      if (stage >= STAGE_BLESS_WRENCH && held(player, HOLY_WRENCH)) {
        return "evil-spirit-talking-to-davey-after-getting-the-holy-wrench";
      }
      if (stage >= STAGE_BLESS_WRENCH) return "evil-spirit-talking-to-davey";
      return "getting-your-beer-ings-talking-to-davey";
    }
    if (npcId === DONNIE_NPC_ID) {
      if (stage >= STAGE_TOLD_DONNIE) {
        return "dissolving-the-protest-talking-to-captain-donnie-again-while-having-rum-with-you";
      }
      if (stage >= STAGE_COLLECT_SWILL && held(player, UNSANITARY_SWILL)) {
        return "dissolving-the-protest-talking-to-captain-donnie";
      }
      return "getting-your-beer-ings-talking-to-captain-donnie";
    }
    if (PROTESTER_NPC_IDS.has(npcId)) {
      return "getting-your-beer-ings-talking-to-zombie-protesters";
    }
    if (SWAB_NPC_IDS.has(npcId)) {
      return `blinding-the-weed-intimidating-the-zombie-swabs-zombie-swab-${(quest.getStage(player) % 6) + 1}`;
    }
    if (BREWER_NPC_IDS.has(npcId)) {
      return `getting-your-beer-ings-talking-to-brewers-around-the-facility-brewer-${((npcId - NpcIdentifiers.BREWER) % 8) + 1}`;
    }
    return null;
  }

  /**
   * Answer the page's prose conditions. Called for every condition on the page,
   * so every branch is handled and nothing throws on a missing inventory method.
   */
  function answerCondition({ player, text }) {
    const value = String(text ?? "").toLowerCase();
    const inventory = player.getInventory();
    const has = (itemId) => inventory.getAmount(itemId) > 0;
    if (value.includes("one or more levels less")) return !meetsRequirements(player);
    if (value.includes("second thoughts")) {
      return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
    }
    if (value.includes("lost the blindweed seed")) return !has(BLINDWEED_SEED);
    if (
      value.includes("free inventory space") ||
      value.includes("inventory space") ||
      value.includes("room in their inventory")
    ) {
      const negative =
        value.includes("no inventory") ||
        value.includes("no free") ||
        value.includes("does not have") ||
        value.includes("doesn't have") ||
        value.includes("don't have");
      return negative ? !hasFreeSlot(player) : hasFreeSlot(player);
    }
    if (value.includes("lost the blindweed") || value.includes("loses the blindweed")) {
      return !has(BLINDWEED);
    }
    if (value.includes("already has a rake")) return has(RAKE);
    if (value.includes("already has a seed dibber")) return has(SEED_DIBBER);
    if (value.includes("already has a watering can")) return has(WATERING_CAN);
    if (value.includes("already has all the tools")) {
      return has(RAKE) && has(SEED_DIBBER) && has(WATERING_CAN);
    }
    if (value.includes("not planted the seed")) return plantedAt(player) === 0;
    if (value.includes("already planted the seed")) return plantedAt(player) !== 0;
    if (value.includes("not have level 40 farming")) return level(player, Skill.FARMING) < 40;
    if (value.includes("has level 40 farming")) return level(player, Skill.FARMING) >= 40;
    if (value.includes("lost the bucket of water")) return !has(STAGNANT_WATER);
    if (value.includes("completed sea slug")) {
      return (Number(player.getAttribute("quest.sea_slug.stage")) || 0) >= 12;
    }
    if (value.includes("fishbowl and net")) return !has(FISHBOWL_AND_NET);
    if (value.includes("lost the wrench")) return !has(WRENCH) && !has(HOLY_WRENCH);
    if (value.includes("without the wrench")) return !has(WRENCH) && !has(HOLY_WRENCH);
    if (value.includes("47 prayer")) return level(player, Skill.PRAYER) < 47;
    if (value.includes("not wearing slayer gloves")) return !wearingSlayerGloves(player);
    if (value.includes("wearing slayer gloves")) return wearingSlayerGloves(player);
    if (value.includes("gotten 'rum'")) return !has(UNSANITARY_SWILL);
    if (value.includes("empty bucket")) {
      const negative = value.includes("doesn't have") || value.includes("does not have");
      return negative ? !has(BUCKET) : has(BUCKET);
    }
    return null;
  }

  /** The "Keep the money" choice on Pirate Pete's start menu accepts the quest. */
  function handleChoice({ player, npcId, option }) {
    if (!PETE_NPC_IDS.has(npcId) || quest.getStage(player) !== 0) return;
    if (String(option).toLowerCase().includes("keep the money")) {
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleHook({ player, npcId, hook }) {
    if (!PETE_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Dialogue action/message steps: stage transitions and message-step hand-outs. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId) return;
    // Message steps print themselves; do not set handled on those, or the
    // default sendMessage is suppressed.
    switch (stepId) {
      case "XU0tPW": // Pirate Pete knocks the player out
        if (quest.getStage(player) < STAGE_KNOCKED_OUT) quest.setStage(player, STAGE_KNOCKED_OUT);
        event.handled = true;
        return;
      case "3cIEz2": // cutscene 1 ends; the intro conversation comes next
        if (npcId === BRAINDEATH_NPC_ID) player.setAttribute(INTRO_ATTRIBUTE, 1);
        event.handled = true;
        return;
      case "c5zoBJ": // another blindweed seed
        giveIfMissing(player, BLINDWEED_SEED);
        event.handled = true;
        return;
      case "vALbPI": // another blindweed
        giveIfMissing(player, BLINDWEED);
        event.handled = true;
        return;
      case "tiEDJT": // empty bucket
        giveIfMissing(player, BUCKET);
        event.handled = true;
        return;
      case "NVQ0oi": // cupboard: take a rake
        giveIfMissing(player, RAKE);
        return;
      case "YTdGv2": // cupboard: take a seed dibber
        giveIfMissing(player, SEED_DIBBER);
        return;
      case "KPb5Bu": // cupboard: take a watering can
        giveIfMissing(player, WATERING_CAN);
        return;
      case "GtypMi": // cupboard: take whatever is missing
        giveIfMissing(player, RAKE);
        giveIfMissing(player, SEED_DIBBER);
        giveIfMissing(player, WATERING_CAN);
        return;
      case "JGzwnf": // Davey blesses the wrench
        if (held(player, WRENCH)) {
          player.getInventory().deleteNumber(WRENCH, 1);
          if (!held(player, HOLY_WRENCH)) player.getInventory().adds(HOLY_WRENCH, 1);
        }
        event.handled = true;
        return;
      case "jG2mdt": // output tap: receive unsanitary swill
        if (quest.getStage(player) === STAGE_COLLECT_SWILL && held(player, BUCKET)) {
          player.getInventory().deleteNumber(BUCKET, 1);
          if (!held(player, UNSANITARY_SWILL)) player.getInventory().adds(UNSANITARY_SWILL, 1);
        }
        event.handled = true;
        return;
      case "YrOgJF": // brewing control rumbles; the vat is ready
        if (quest.getStage(player) === STAGE_SPIDER_ADDED) {
          quest.setStage(player, STAGE_COLLECT_SWILL);
          giveIfMissing(player, BUCKET);
        }
        return;
      case "fVhhrc": // Captain Donnie drinks the 'rum'
        if (quest.getStage(player) === STAGE_COLLECT_SWILL) {
          quest.setStage(player, STAGE_TOLD_DONNIE);
        }
        return;
      case "8lDSvO": // Congratulations! Quest complete!
        if (!quest.isComplete(player)) {
          quest.complete(player);
          event.handled = true;
          event.end = true;
        }
        return;
      default:
        return;
    }
  }

  /** Condition branches that hand an item over (the transcript has no action id). */
  function handleCondition({ player, stepId }) {
    if (!player || !stepId) return;
    switch (stepId) {
      case "fpIHBF": // lost seed, has inventory space
        giveIfMissing(player, BLINDWEED_SEED);
        return;
      case "10SD9l": // lost blindweed, has inventory space
        giveIfMissing(player, BLINDWEED);
        return;
      case "NF2-Cx": // lost wrench, has inventory space
        giveIfMissing(player, WRENCH);
        return;
      case "3l4uRi": // fetch water, no bucket
        if (quest.getStage(player) === STAGE_FETCH_WATER) giveIfMissing(player, BUCKET);
        return;
      case "rI6fDF": // lost the bucket of water
        if (quest.getStage(player) === STAGE_COLLECTED_WATER) giveIfMissing(player, STAGNANT_WATER);
        return;
      case "WUSdZp": // catch creatures, no fishbowl and net
        if (quest.getStage(player) === STAGE_CATCH_CREATURES) giveIfMissing(player, FISHBOWL_AND_NET);
        return;
      case "at2XLU": // water added, no free space for the fishbowl
        if (quest.getStage(player) === STAGE_WATER_ADDED && !quest.isComplete(player)) {
          quest.setStage(player, STAGE_CATCH_CREATURES);
        }
        return;
      case "Sy3jOe": // water added, fishbowl and net handed over
        if (quest.getStage(player) === STAGE_WATER_ADDED && !quest.isComplete(player)) {
          quest.setStage(player, STAGE_CATCH_CREATURES);
          giveIfMissing(player, FISHBOWL_AND_NET);
        }
        return;
      default:
        return;
    }
  }

  /** Stage transitions keyed off the lines that carry them (no action id). */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!player || npcId !== BRAINDEATH_NPC_ID) return;
    const value = String(text ?? "").toLowerCase();
    if (value.includes("try hecklin'")) {
      if (hasFreeSlot(player)) {
        giveIfMissing(player, BLINDWEED_SEED);
        if (quest.getStage(player) < STAGE_GIVEN_SEEDS) quest.setStage(player, STAGE_GIVEN_SEEDS);
      } else if (quest.getStage(player) < STAGE_MET_BRAINDEATH) {
        quest.setStage(player, STAGE_MET_BRAINDEATH);
      }
      return;
    }
    if (value.includes("splendid") && quest.getStage(player) === STAGE_GROWN_BLINDWEED) {
      quest.setStage(player, STAGE_SHOW_BLINDWEED);
      return;
    }
    if (value.includes("savin' some fer an emergency")) {
      giveIfMissing(player, BLINDWEED);
      if (quest.getStage(player) === STAGE_GROWN_BLINDWEED) {
        quest.setStage(player, STAGE_SHOW_BLINDWEED);
      }
      return;
    }
    if (value.includes("shoved the blindweed into the mix") && quest.getStage(player) === STAGE_BLINDWEED_ADDED) {
      quest.setStage(player, STAGE_FETCH_WATER);
      return;
    }
    if (value.includes("give the controls a couple of belts") && quest.getStage(player) === STAGE_PRESSURISED) {
      quest.setStage(player, STAGE_BLESS_WRENCH);
      giveIfMissing(player, WRENCH);
      return;
    }
    if (value.includes("we need the body of a diseased fever spider") && quest.getStage(player) === STAGE_SPIRIT_BANISHED) {
      quest.setStage(player, STAGE_KILL_SPIDER);
    }
  }

  /** Blindweed / stagnant water / fever spider body into the Intake Hopper. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (objectId === INTAKE_HOPPER_OBJECT_ID) {
      const stage = quest.getStage(player);
      if (itemId === BLINDWEED && stage === STAGE_SHOW_BLINDWEED) {
        event.handled = true;
        player.getInventory().deleteNumber(BLINDWEED, 1);
        quest.setStage(player, STAGE_BLINDWEED_ADDED);
        player.sendMessage("You stuff the Blindweed into the Hopper.");
        return;
      }
      if (itemId === STAGNANT_WATER && stage === STAGE_COLLECTED_WATER) {
        event.handled = true;
        player.getInventory().deleteNumber(STAGNANT_WATER, 1);
        player.getInventory().adds(BUCKET, 1);
        quest.setStage(player, STAGE_WATER_ADDED);
        player.sendMessage("You dump the water into the hopper.");
        return;
      }
      if (itemId === FEVER_SPIDER_BODY && stage === STAGE_KILL_SPIDER) {
        event.handled = true;
        player.getInventory().deleteNumber(FEVER_SPIDER_BODY, 1);
        quest.setStage(player, STAGE_SPIDER_ADDED);
        player.sendMessage("You cram the diseased Fever Spider body into the hopper.");
        return;
      }
      if (stage >= STAGE_STARTED && !quest.isComplete(player)) {
        event.handled = true;
        player.sendMessage("Nothing interesting happens.");
      }
      return;
    }
    if (objectId === PRESSURE_BARREL_OBJECT_ID) {
      stuffSeaCreature(event);
      return;
    }
    if (objectId === STAGNANT_LAKE_OBJECT_ID) {
      if (itemId !== BUCKET) return;
      event.handled = true;
      if (quest.getStage(player) !== STAGE_FETCH_WATER) {
        player.sendMessage("Nothing interesting happens.");
        return;
      }
      player.getInventory().deleteNumber(BUCKET, 1);
      player.getInventory().adds(STAGNANT_WATER, 1);
      quest.setStage(player, STAGE_COLLECTED_WATER);
      player.sendMessage("You scoop up a bucket of stagnant water.");
      return;
    }
    if (objectId === OUTPUT_TAP_OBJECT_ID) {
      if (itemId !== BUCKET) return;
      fillSwill(player, event, "The vat is empty.");
      return;
    }
    if (BREWING_CONTROL_OBJECT_IDS.has(objectId)) {
      smiteControls(event);
      return;
    }
    if (BLINDWEED_PATCH_OBJECT_IDS.has(objectId) && itemId === BLINDWEED_SEED) {
      plantBlindweed(event);
    }
  }

  function stuffSeaCreature(event) {
    const { player, itemId } = event;
    if (itemId !== SLUGLINGS && itemId !== KARAMTHULHU) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_CATCH_CREATURES) {
      if (!quest.isComplete(player)) player.sendMessage("Nothing interesting happens.");
      return;
    }
    const slugs = Number(player.getAttribute(SLUGLINGS_ATTRIBUTE)) || 0;
    const karam = Number(player.getAttribute(KARAMTHULHU_ATTRIBUTE)) || 0;
    if (slugs + karam >= 5) {
      player.sendMessage("You don't think you can stuff any more Sluglings in there.");
      return;
    }
    const name = itemId === SLUGLINGS ? "Sluglings" : "Karamthultu";
    player.getInventory().deleteNumber(itemId, 1);
    if (itemId === SLUGLINGS) player.setAttribute(SLUGLINGS_ATTRIBUTE, slugs + 1);
    else player.setAttribute(KARAMTHULHU_ATTRIBUTE, karam + 1);
    player.sendMessage(`You stuff the squirming ${name} into the barrel.`);
  }

  function pullPressureLever(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_CATCH_CREATURES) return;
    const slugs = Number(player.getAttribute(SLUGLINGS_ATTRIBUTE)) || 0;
    const karam = Number(player.getAttribute(KARAMTHULHU_ATTRIBUTE)) || 0;
    if (slugs + karam < 5) {
      player.sendMessage("You do not yet have five sea creatures in the barrel!");
      return;
    }
    player.setAttribute(SLUGLINGS_ATTRIBUTE, 0);
    player.setAttribute(KARAMTHULHU_ATTRIBUTE, 0);
    quest.setStage(player, STAGE_PRESSURISED);
    player.sendMessage("You pressurise the assorted sea creatures.");
  }

  function fillSwill(player, event, emptyMessage) {
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_TOLD_DONNIE) {
      player.sendMessage("You thankfully have no need to do that any more.");
      return;
    }
    if (stage !== STAGE_COLLECT_SWILL) {
      player.sendMessage(emptyMessage);
      return;
    }
    if (!held(player, BUCKET)) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    player.getInventory().deleteNumber(BUCKET, 1);
    player.getInventory().adds(UNSANITARY_SWILL, 1);
    player.sendMessage("You carefully fill the bucket with the foul-smelling swill.");
  }

  function smiteControls(event) {
    const { player, itemId } = event;
    if (itemId !== WRENCH && itemId !== HOLY_WRENCH) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_BLESS_WRENCH) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (itemId === WRENCH) {
      player.sendMessage("Well, it seems that this wrench is just not holy enough to work. You should go and get it blessed.");
      return;
    }
    if (Number(player.getAttribute(SPIRIT_ATTRIBUTE)) === 1) {
      player.sendMessage("The Evil Spirit has already manifested!");
      return;
    }
    player.sendMessage("You raise your wrench on high and smite the controls mightily!");
    player.sendMessage("The Evil Spirit is forced from the controls!");
    player.setAttribute(SPIRIT_ATTRIBUTE, 1);
    const spirit = api.spawnNpc({
      id: EVIL_SPIRIT_NPC_ID,
      x: 2144,
      y: 5102,
      z: 1,
      wanderRadius: 3,
      owner: player,
      ownerOnly: true,
    });
    if (spirit) spirits.set(player, spirit);
  }

  function plantBlindweed(event) {
    const { player } = event;
    event.handled = true;
    if (level(player, Skill.FARMING) < 40) {
      player.sendMessage("You must be a Level 40 Farmer to plant those.");
      return;
    }
    if (plantedAt(player) !== 0) {
      player.sendMessage("This patch already has something growing in it.");
      return;
    }
    player.getInventory().deleteNumber(BLINDWEED_SEED, 1);
    player.setAttribute(PLANTED_ATTRIBUTE, Date.now());
    player.sendMessage("You plant a seed in the blindweed patch.");
  }

  function harvestPatch(event) {
    const { player } = event;
    event.handled = true;
    if (plantedAt(player) === 0) {
      player.sendMessage("This is a blindweed patch. The soil has not been treated. The patch needs weeding.");
      return;
    }
    if (!blindweedGrown(player)) {
      player.sendMessage("This is a blindweed patch. The soil has not been treated. The patch has something growing in it.");
      return;
    }
    if (!hasFreeSlot(player)) {
      player.sendMessage("You do not have any free space for the Blindweed.");
      return;
    }
    player.setAttribute(PLANTED_ATTRIBUTE, 0);
    player.getInventory().adds(BLINDWEED, 1);
    if (quest.getStage(player) === STAGE_GIVEN_SEEDS) quest.setStage(player, STAGE_GROWN_BLINDWEED);
    player.sendMessage("You pick the Blindweed.");
  }

  function clearSpirit(player) {
    const spirit = spirits.get(player);
    if (spirit) api.removeNpc(spirit);
    spirits.delete(player);
  }

  /** Evil Spirit death banishes it; a Fever Spider drops its body. */
  function handleNpcDeath({ player, npcId }) {
    if (!player) return;
    if (npcId === EVIL_SPIRIT_NPC_ID) {
      player.setAttribute(SPIRIT_ATTRIBUTE, 0);
      clearSpirit(player);
      if (quest.getStage(player) === STAGE_BLESS_WRENCH) {
        quest.setStage(player, STAGE_SPIRIT_BANISHED);
        player.sendMessage("You have banished the Evil Spirit!");
      }
      return;
    }
    if (npcId === FEVER_SPIDER_NPC_ID && quest.getStage(player) === STAGE_KILL_SPIDER) {
      if (!held(player, FEVER_SPIDER_BODY) && hasFreeSlot(player)) {
        player.getInventory().adds(FEVER_SPIDER_BODY, 1);
        player.sendMessage("You take the fever spider's body.");
      }
    }
  }

  /** The squid fishing spot shares NPC 635 with every other spot in the cache. */
  function handleNpcInteraction(event) {
    if (event.npcId !== FISHING_SPOT_NPC_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_CATCH_CREATURES) return;
    event.handled = true;
    if (!held(player, FISHBOWL_AND_NET)) {
      player.sendMessage("You do not have the correct equipment to fish here.");
      return;
    }
    if (level(player, Skill.FISHING) < 50) {
      player.sendMessage("You must be a Level 40 Fisherman to fish here.");
      return;
    }
    if (!hasFreeSlot(player)) {
      player.sendMessage("You do not have any free space for anything that you will catch!");
      return;
    }
    player.sendMessage("You dunk the bowl in the water...");
    if (Math.random() < 1 / 3) {
      player.getInventory().adds(KARAMTHULHU, 1);
      player.sendMessage("...and you catch a Karamthulhu!");
    } else {
      player.getInventory().adds(SLUGLINGS, 1);
      player.sendMessage("...and you catch some Sluglings!");
    }
  }

  function handleItemOnNpc(event) {
    const { player, itemId, target } = event;
    if (!player || target?.getId?.() !== BRAINDEATH_NPC_ID) return;
    event.handled = true;
    if (itemId === SLUGLINGS) {
      startTranscript(api, player, BRAINDEATH_NPC_ID, PAGE, "sluglings-using-sluglings-on-captain-braindeath");
      return;
    }
    if (itemId === KARAMTHULHU) {
      startTranscript(api, player, BRAINDEATH_NPC_ID, PAGE, "sluglings-using-karamthultu-on-captain-braindeath");
      return;
    }
    if (itemId === FEVER_SPIDER_BODY) {
      startTranscript(api, player, BRAINDEATH_NPC_ID, PAGE, "fever-spider-using-the-spider-corpse-on-captain-braindeath");
      return;
    }
    event.handled = false;
  }

  function handleItemOnItem({ player, itemId, targetItemId }) {
    const fb = itemId === FISHBOWL || targetItemId === FISHBOWL;
    const net = itemId === BIG_FISHING_NET || targetItemId === BIG_FISHING_NET;
    if (!fb || !net) return;
    if (!held(player, FISHBOWL) || !held(player, BIG_FISHING_NET)) return;
    player.getInventory().deleteNumber(FISHBOWL, 1);
    player.getInventory().deleteNumber(BIG_FISHING_NET, 1);
    player.getInventory().adds(FISHBOWL_AND_NET, 1);
    player.sendMessage("You wrap the net around the empty bowl.");
  }

  function unwrapFishbowl({ player }) {
    if (!held(player, FISHBOWL_AND_NET)) return;
    if (!hasFreeSlot(player)) {
      player.sendMessage("You do not have enough space to unwrap the net from the fishbowl.");
      return;
    }
    player.getInventory().deleteNumber(FISHBOWL_AND_NET, 1);
    player.getInventory().adds(FISHBOWL, 1);
    player.getInventory().adds(BIG_FISHING_NET, 1);
    player.sendMessage("You unwrap the net from the fishbowl.");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (PRESSURE_LEVER_OBJECT_IDS.has(objectId)) {
      pullPressureLever(event);
      return;
    }
    if (TOOL_CUPBOARD_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      startTranscript(api, player, BRAINDEATH_NPC_ID, PAGE, CUPBOARD_VARIANT);
      return;
    }
    if (BLINDWEED_PATCH_OBJECT_IDS.has(objectId)) {
      harvestPatch(event);
      return;
    }
    if (objectId === TRASHED_PATCH_OBJECT_ID) {
      event.handled = true;
      player.sendMessage("The soil here is too poor to farm on.");
      return;
    }
    if (objectId === OUTPUT_TAP_OBJECT_ID) {
      fillSwill(player, event, "Nothing interesting happens.");
      return;
    }
    if (GATE_OBJECT_IDS.has(objectId)) {
      useGate(event);
    }
  }

  /**
   * One-tile pass-through; the Luke conversation variants carry the words.
   * ponytail: no gate object swap, the core door stays as mapped.
   */
  function useGate(event) {
    const { player, location } = event;
    if (!location) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FETCH_WATER || quest.isComplete(player)) return;
    event.handled = true;
    const north = player.getLocation().getY() <= location.y;
    player.moveTo(new api.core.Location(location.x, location.y + (north ? 1 : -1), location.z));
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (player) clearSpirit(player);
  }

  api.persistAttribute(INTRO_ATTRIBUTE);
  api.persistAttribute(PLANTED_ATTRIBUTE);
  api.persistAttribute(SLUGLINGS_ATTRIBUTE);
  api.persistAttribute(KARAMTHULHU_ATTRIBUTE);
  api.persistAttribute(SPIRIT_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "rum_deal",
    name: "Rum Deal",
    varpId: VARP_RUM_DEAL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 7000, label: "Prayer" },
      { skillId: Skill.FISHING.getIndex(), amount: 7000, label: "Fishing" },
      { skillId: Skill.FARMING.getIndex(), amount: 7000, label: "Farming" },
    ],
    rewardItemId: ItemIdentifiers.HOLY_WRENCH,
    rewardItemLabel: "A holy wrench",
    otherRewards: ["Access to Braindeath Island"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Fishbowl and net", { Unwrap: unwrapFishbowl });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
