/**
 * Shades of Mort'ton (members).
 *
 * The words come from the "Shades of Mort'ton" transcript page; this plugin
 * selects the variants for Ulsquire Shauncy (1287 afflicted / 1288 cured) and
 * Razmire Keelgan (1289/1290), answers the two olive-oil prose conditions and
 * wires the diary start hook, the shade kills, the remains hand-ins, the temple
 * repair, sacred oil, pyre logs and the cremation Ulsquire completes.
 *
 * Stages (varp 339, LostCity "morttonquest"): 5 read the diary, 10 made serum
 * 207, 15 accepted Razmire's shade hunt, 20/25/30/35/40 one..five shades
 * killed, 45 gave remains to Razmire, 47 showed them to Ulsquire, 50 temple
 * discussed, 55 temple repair begun, 60 altar can be lit, 65 sacred oil made,
 * 70 pyre logs made, 75 logs on the pyre, 80 shade cremated, 100 complete.
 *
 * Source: LostCityRS/Content scripts/quests/quest_mortton and
 * scripts/minigames/game_mortton (pinned in issue #196).
 *
 * Gaps: the afflicted/cured and no-fire/lit altar object transformations are
 * modelled with per-player flags rather than NPC/object changes; the diary book
 * interface, the Flamtaer resource-pool percentages, the shade lair/chests and
 * the full cremation reward table are not reproduced; pyre-log sacred-oil dose
 * counts and the cremation coin reward are approximates.
 */
module.exports = function registerShadesOfMorttonQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const ULSQUIRE_NPC_IDS = new Set([
    NpcIdentifiers.AFFLICTED_ULSQUIRE_,
    NpcIdentifiers.ULSQUIRE_SHAUNCY,
  ]);
  const RAZMIRE_NPC_IDS = new Set([
    NpcIdentifiers.AFFLICTED_RAZMIRE_,
    NpcIdentifiers.RAZMIRE_KEELGAN,
  ]);

  const SHADE_NPC_IDS = new Set([
    NpcIdentifiers.LOAR_SHADOW,
    NpcIdentifiers.LOAR_SHADE,
    NpcIdentifiers.PHRIN_SHADOW,
    NpcIdentifiers.PHRIN_SHADE,
    NpcIdentifiers.RIYL_SHADOW,
    NpcIdentifiers.RIYL_SHADE,
    NpcIdentifiers.ASYN_SHADOW,
    NpcIdentifiers.ASYN_SHADE,
    NpcIdentifiers.FIYR_SHADOW,
    NpcIdentifiers.FIYR_SHADE,
  ]);

  const PAGE = "Shades of Mort'ton";
  const START_HOOK = "quest:shades-of-mort-ton:start";

  const VARP_SHADES_OF_MORTTON = 339;

  const STAGE_NOT_STARTED = 0;
  const STAGE_READ_DIARY = 5;
  const STAGE_MADE_SERUM = 10;
  const STAGE_KILL_SHADES = 15;
  const STAGE_KILLED_1 = 20;
  const STAGE_KILLED_5 = 40;
  const STAGE_SHADES_TO_RAZMIRE = 45;
  const STAGE_SHADES_TO_ULSQUIRE = 47;
  const STAGE_ULSQUIRE_TEMPLE = 50;
  const STAGE_REBUILD_TEMPLE = 55;
  const STAGE_CAN_LIGHT_ALTAR = 60;
  const STAGE_CREATED_SACRED_OIL = 65;
  const STAGE_CREATED_PYRE_LOGS = 70;
  const STAGE_LOGS_ON_PYRE = 75;
  const STAGE_LIT_PYRE = 80;
  const STAGE_COMPLETE = 100;

  const DIARY_ITEM_ID = ItemIdentifiers.DIARY_2;
  const REMAINS_ITEM_IDS = [
    ItemIdentifiers.LOAR_REMAINS,
    ItemIdentifiers.PHRIN_REMAINS,
    ItemIdentifiers.RIYL_REMAINS,
    ItemIdentifiers.ASYN_REMAINS,
    ItemIdentifiers.FIYR_REMAINS,
  ];
  const SERUM_207_ITEM_IDS = [
    ItemIdentifiers.SERUM_207_4_,
    ItemIdentifiers.SERUM_207_3_,
    ItemIdentifiers.SERUM_207_2_,
    ItemIdentifiers.SERUM_207_1_,
  ];
  const SERUM_208_ITEM_IDS = [
    ItemIdentifiers.SERUM_208_4_,
    ItemIdentifiers.SERUM_208_3_,
    ItemIdentifiers.SERUM_208_2_,
    ItemIdentifiers.SERUM_208_1_,
  ];
  const OLIVE_OIL_ITEM_IDS = [
    ItemIdentifiers.OLIVE_OIL_4_,
    ItemIdentifiers.OLIVE_OIL_3_,
    ItemIdentifiers.OLIVE_OIL_2_,
    ItemIdentifiers.OLIVE_OIL_1_,
  ];
  const SACRED_OIL_ITEM_IDS = [
    ItemIdentifiers.SACRED_OIL_4_,
    ItemIdentifiers.SACRED_OIL_3_,
    ItemIdentifiers.SACRED_OIL_2_,
    ItemIdentifiers.SACRED_OIL_1_,
  ];

  const SHELF_OBJECT_ID = ObjectIdentifiers.SHELF_9;
  const SMASHED_TABLE_OBJECT_ID = ObjectIdentifiers.SMASHED_TABLE_2;
  const FUNERAL_PYRE_OBJECT_ID = ObjectIdentifiers.FUNERAL_PYRE;
  const ALTAR_OBJECT_IDS = new Set([
    ObjectIdentifiers.FLAMING_FIRE_ALTAR,
    ObjectIdentifiers.FIRE_ALTAR,
    ObjectIdentifiers.BROKEN_FIRE_ALTAR,
  ]);
  const TEMPLE_WALL_OBJECT_IDS = new Set([
    ObjectIdentifiers.BROKEN_WALL,
    ObjectIdentifiers.TEMPLE_WALL,
    ObjectIdentifiers.TEMPLE_WALL_2,
    ObjectIdentifiers.TEMPLE_WALL_3,
    ObjectIdentifiers.TEMPLE_WALL_4,
    ObjectIdentifiers.TEMPLE_WALL_5,
    ObjectIdentifiers.TEMPLE_WALL_6,
    ObjectIdentifiers.TEMPLE_WALL_7,
    ObjectIdentifiers.TEMPLE_WALL_8,
    ObjectIdentifiers.TEMPLE_WALL_9,
    ObjectIdentifiers.TEMPLE_WALL_10,
    ObjectIdentifiers.BROKEN_WALL_2,
    ObjectIdentifiers.TEMPLE_WALL_11,
    ObjectIdentifiers.TEMPLE_WALL_12,
    ObjectIdentifiers.TEMPLE_WALL_13,
    ObjectIdentifiers.TEMPLE_WALL_14,
    ObjectIdentifiers.TEMPLE_WALL_15,
    ObjectIdentifiers.TEMPLE_WALL_16,
    ObjectIdentifiers.TEMPLE_WALL_17,
    ObjectIdentifiers.TEMPLE_WALL_18,
    ObjectIdentifiers.TEMPLE_WALL_19,
    ObjectIdentifiers.TEMPLE_WALL_20,
  ]);

  /** Sacred/oil dose -> the item left after one dose is used. */
  const DOSE_STAGE = new Map([
    [ItemIdentifiers.SERUM_207_4_, ItemIdentifiers.SERUM_207_3_],
    [ItemIdentifiers.SERUM_207_3_, ItemIdentifiers.SERUM_207_2_],
    [ItemIdentifiers.SERUM_207_2_, ItemIdentifiers.SERUM_207_1_],
    [ItemIdentifiers.SERUM_207_1_, ItemIdentifiers.VIAL],
    [ItemIdentifiers.SERUM_208_4_, ItemIdentifiers.SERUM_208_3_],
    [ItemIdentifiers.SERUM_208_3_, ItemIdentifiers.SERUM_208_2_],
    [ItemIdentifiers.SERUM_208_2_, ItemIdentifiers.SERUM_208_1_],
    [ItemIdentifiers.SERUM_208_1_, ItemIdentifiers.VIAL],
    [ItemIdentifiers.OLIVE_OIL_4_, ItemIdentifiers.OLIVE_OIL_3_],
    [ItemIdentifiers.OLIVE_OIL_3_, ItemIdentifiers.OLIVE_OIL_2_],
    [ItemIdentifiers.OLIVE_OIL_2_, ItemIdentifiers.OLIVE_OIL_1_],
    [ItemIdentifiers.OLIVE_OIL_1_, ItemIdentifiers.VIAL],
    [ItemIdentifiers.SACRED_OIL_4_, ItemIdentifiers.SACRED_OIL_3_],
    [ItemIdentifiers.SACRED_OIL_3_, ItemIdentifiers.SACRED_OIL_2_],
    [ItemIdentifiers.SACRED_OIL_2_, ItemIdentifiers.SACRED_OIL_1_],
    [ItemIdentifiers.SACRED_OIL_1_, ItemIdentifiers.VIAL],
  ]);

  /** One dose of olive oil sanctifies into the same-dose sacred oil. */
  const OLIVE_TO_SACRED = new Map([
    [ItemIdentifiers.OLIVE_OIL_4_, ItemIdentifiers.SACRED_OIL_4_],
    [ItemIdentifiers.OLIVE_OIL_3_, ItemIdentifiers.SACRED_OIL_3_],
    [ItemIdentifiers.OLIVE_OIL_2_, ItemIdentifiers.SACRED_OIL_2_],
    [ItemIdentifiers.OLIVE_OIL_1_, ItemIdentifiers.SACRED_OIL_1_],
  ]);

  /** Logs -> pyre logs and the sacred-oil doses OSRS charges (approximate). */
  const PYRE_LOG_RECIPES = new Map([
    [ItemIdentifiers.LOGS, { product: ItemIdentifiers.PYRE_LOGS, doses: 2 }],
    [ItemIdentifiers.OAK_LOGS, { product: ItemIdentifiers.OAK_PYRE_LOGS, doses: 2 }],
    [ItemIdentifiers.WILLOW_LOGS, { product: ItemIdentifiers.WILLOW_PYRE_LOGS, doses: 3 }],
    [ItemIdentifiers.MAPLE_LOGS, { product: ItemIdentifiers.MAPLE_PYRE_LOGS, doses: 3 }],
    [ItemIdentifiers.YEW_LOGS, { product: ItemIdentifiers.YEW_PYRE_LOGS, doses: 4 }],
    [ItemIdentifiers.MAGIC_LOGS, { product: ItemIdentifiers.MAGIC_PYRE_LOGS, doses: 5 }],
  ]);

  const KILLS_ATTRIBUTE = "quest.shades_of_mortton.shade_kills";
  const MET_ULSQUIRE_ATTRIBUTE = "quest.shades_of_mortton.met_ulsquire";
  const MET_RAZMIRE_ATTRIBUTE = "quest.shades_of_mortton.met_razmire";
  const OLIVE_OIL_ATTRIBUTE = "quest.shades_of_mortton.olive_oil";
  const TABLE_SEARCHED_ATTRIBUTE = "quest.shades_of_mortton.table_searched";
  const TEMPLE_BUILD_ATTRIBUTE = "quest.shades_of_mortton.temple_build";
  const TEMPLE_BUILD_REQUIRED = 5;
  const ALTAR_LIT_ATTRIBUTE = "quest.shades_of_mortton.altar_lit";
  const PYRE_LOGS_ATTRIBUTE = "quest.shades_of_mortton.pyre_logs";
  const PYRE_REMAINS_ATTRIBUTE = "quest.shades_of_mortton.pyre_remains";
  const PERM_SERUM_ATTRIBUTE = "quest.shades_of_mortton.perm_serum";

  const REPAIR_MATERIALS_MESSAGE =
    "~ Repairing the temple ~To repair the temple you need to increase your material resource pool by bringing limestone bricks, timber beams (or wooden planks) and swamp paste, either in your inventory or in a Flamtaer bag.";

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function remainingCount(player) {
    return REMAINS_ITEM_IDS.reduce(
      (total, itemId) => total + player.getInventory().getAmount(itemId),
      0
    );
  }

  function removeRemains(player, count) {
    let left = count;
    for (const itemId of REMAINS_ITEM_IDS) {
      if (left <= 0) break;
      const have = player.getInventory().getAmount(itemId);
      const take = Math.min(have, left);
      if (take > 0) {
        player.getInventory().deleteNumber(itemId, take);
        left -= take;
      }
    }
    return left === 0;
  }

  /** Use up to `count` doses from the given dose chain, highest dose first. */
  function drainDoses(player, itemIds, count) {
    let left = count;
    for (const itemId of itemIds) {
      while (left > 0 && player.getInventory().getAmount(itemId) > 0) {
        player.getInventory().deleteNumber(itemId, 1);
        player.getInventory().adds(DOSE_STAGE.get(itemId), 1);
        left--;
      }
      if (left === 0) break;
    }
    return left === 0;
  }

  function sacredOilDoses(player) {
    return (
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[0]) * 4 +
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[1]) * 3 +
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[2]) * 2 +
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[3])
    );
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I travelled to Mort'ton and found Herbi Flax's diary.</str>",
        "<str>I made serum 207 and used it to cure the afflicted.</str>",
        "<str>I killed five shades for Razmire and helped rebuild</str>",
        "<str>the temple of Flamtaer. I cremated a shade's remains,</str>",
        "<str>putting its spirit to rest.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_LIT_PYRE) {
      return ["The shade's spirit was released.", "I should tell Ulsquire."];
    }
    if (stage >= STAGE_LOGS_ON_PYRE) {
      return [
        "I need to put the shade remains on the funeral",
        "pyre and light it to put the shade to rest.",
      ];
    }
    if (stage >= STAGE_CREATED_PYRE_LOGS) {
      return [
        "Ulsquire says the pyre logs are connected to the",
        "shade remains. I can try to put a spirit to rest.",
      ];
    }
    if (stage >= STAGE_CREATED_SACRED_OIL) {
      return [
        "When all of the temple walls were rebuilt an altar",
        "appeared. I sanctified olive oil in the sacred flame.",
      ];
    }
    if (stage >= STAGE_CAN_LIGHT_ALTAR) {
      return [
        "I helped rebuild the temple of Flamtaer.",
        "The holy fire altar can now be lit.",
      ];
    }
    if (stage >= STAGE_REBUILD_TEMPLE) {
      return [
        "I'm rebuilding the temple using limestone bricks,",
        "wooden planks and swamp paste.",
      ];
    }
    if (stage >= STAGE_ULSQUIRE_TEMPLE) {
      return [
        "Ulsquire is interested in 'Flaemtaer temple'.",
        "I should help him rebuild it.",
      ];
    }
    if (stage >= STAGE_SHADES_TO_ULSQUIRE) {
      return [
        "I showed Ulsquire the shade remains.",
        "A holy cremation with pyre logs should put the",
        "shades' spirits to rest.",
      ];
    }
    if (stage >= STAGE_SHADES_TO_RAZMIRE) {
      return ["I gave Razmire the shade remains.", "He said to show some to Ulsquire."];
    }
    if (stage >= STAGE_KILLED_1) {
      const kills = Math.min(
        5,
        Number(player.getAttribute(KILLS_ATTRIBUTE)) || 0
      );
      const lines = [`I have killed ${kills} of the five shades.`];
      if (remainingCount(player) < 5) {
        lines.push("I must collect the remains and bring them to Razmire.");
      } else {
        lines.push("I have five shade remains to bring to Razmire.");
      }
      return lines;
    }
    if (stage >= STAGE_KILL_SHADES) {
      return [
        "Razmire asked me to kill five shades and bring",
        "him their remains.",
      ];
    }
    if (stage >= STAGE_MADE_SERUM) {
      return [
        "I made serum 207 from tarromin, water and ashes",
        "using Herbi Flax's diary.",
        "I should use it on an afflicted local.",
      ];
    }
    if (stage >= STAGE_READ_DIARY) {
      return [
        "I found Herbi Flax's diary in Mort'ton.",
        "Tarromin, a vial of water and ashes make serum 207.",
      ];
    }
    return [
      "I can start this quest by exploring the town of",
      "<col=800000>Mort'ton</col>, accessible from the",
      "southern edge of <col=800000>Mort Myre</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 20000);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 20000);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    if (!ULSQUIRE_NPC_IDS.has(npcId) && !RAZMIRE_NPC_IDS.has(npcId)) return null;
    const stage = quest.getStage(player);

    if (ULSQUIRE_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Ulsquire Shauncy", variant: "after-shades-of-mort-ton" };
      }
      if (stage >= STAGE_LIT_PYRE) return "talking-to-ulsquire-after-burning-shade-remains";
      if (stage >= STAGE_LOGS_ON_PYRE) {
        return "burning-the-remains-putting-the-logs-on-the-funeral-pyre-talking-to-ulsquire";
      }
      if (stage >= STAGE_CREATED_PYRE_LOGS) {
        return "making-pyre-logs-returning-to-ulsquire-after-making-pyre-logs";
      }
      if (stage >= STAGE_CREATED_SACRED_OIL) return "making-sacred-oil-talking-to-ulsquire";
      if (stage >= STAGE_REBUILD_TEMPLE) {
        return "talking-with-ulsquire-again-returning-to-ulsquire-before-making-sacred-oil";
      }
      if (stage >= STAGE_SHADES_TO_ULSQUIRE) return "talking-with-ulsquire-again";
      if (stage >= STAGE_SHADES_TO_RAZMIRE) {
        return remainingCount(player) > 0
          ? "giving-ulsquire-the-remains"
          : "giving-razmire-his-shades-going-to-ulsquire-without-remains";
      }
      if (stage >= STAGE_KILL_SHADES) {
        return "curing-razmire-talking-to-ulsquire-before-giving-razmire-5-shade-remains";
      }
      if (stage >= STAGE_MADE_SERUM) {
        if (!player.getAttribute(MET_ULSQUIRE_ATTRIBUTE)) return null;
        return player.getAttribute(MET_ULSQUIRE_ATTRIBUTE) === "talked"
          ? "reading-the-book-curing-ulsquire-talking-to-him-again"
          : "reading-the-book-curing-ulsquire";
      }
      return null;
    }

    if (stage >= STAGE_COMPLETE) {
      return { page: "Razmire Keelgan", variant: "after-shades-of-mort-ton" };
    }
    if (stage >= STAGE_LIT_PYRE) {
      return "burning-the-remains-returning-to-razmire-after-burning-shade-remains";
    }
    if (stage >= STAGE_CREATED_SACRED_OIL) return "making-pyre-logs-talking-to-razmire";
    if (stage >= STAGE_REBUILD_TEMPLE) {
      return "talking-with-ulsquire-again-returning-to-razmire-before-making-sacred-oil";
    }
    if (stage >= STAGE_SHADES_TO_RAZMIRE) {
      return "giving-razmire-his-shades-talking-to-razmire-again";
    }
    if (stage >= STAGE_KILLED_5) {
      return remainingCount(player) >= 5
        ? "giving-razmire-his-shades"
        : "killing-shades-returning-without-the-five-shade-remains";
    }
    if (stage >= STAGE_KILLED_1) return "killing-shades-talking-to-razmire";
    if (stage >= STAGE_KILL_SHADES) {
      return "curing-razmire-returning-before-killing-5-shade-remains";
    }
    if (stage >= STAGE_MADE_SERUM) {
      if (!player.getAttribute(MET_RAZMIRE_ATTRIBUTE)) return null;
      return player.getAttribute(MET_RAZMIRE_ATTRIBUTE) === "talked"
        ? "curing-razmire-talking-to-him-again-before-accepting-to-kill-shades"
        : "curing-razmire";
    }
    return null;
  }

  /** Answer the transcript's two prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const gotOil = Boolean(player.getAttribute(OLIVE_OIL_ATTRIBUTE));
    if (value.includes("has not already received olive oil")) return !gotOil;
    if (value.includes("has received olive oil already")) return gotOil;
    return null;
  }

  /** The diary's "Yes." starts the quest; the cured greetings mark first contact. */
  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_READ_DIARY) {
      quest.setStage(player, STAGE_READ_DIARY);
    }
  }

  function handleDialogueLine(event) {
    if (!String(event.text ?? "").includes("you've made your own serum")) return;
    const key = ULSQUIRE_NPC_IDS.has(event.npcId)
      ? MET_ULSQUIRE_ATTRIBUTE
      : RAZMIRE_NPC_IDS.has(event.npcId)
        ? MET_RAZMIRE_ATTRIBUTE
        : null;
    if (key) event.player.setAttribute(key, "talked");
  }

  /** Razmire's shade-hunt acceptance and Ulsquire's temple question. */
  function handleChoice({ player, npcId, option }) {
    const text = String(option ?? "");
    if (RAZMIRE_NPC_IDS.has(npcId) && text.startsWith("Yes, I'll dispatch")) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_MADE_SERUM && stage < STAGE_KILL_SHADES) {
        quest.setStage(player, STAGE_KILL_SHADES);
      }
      return;
    }
    if (ULSQUIRE_NPC_IDS.has(npcId) && text.includes("What can you tell me about that temple?")) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_SHADES_TO_ULSQUIRE && stage < STAGE_ULSQUIRE_TEMPLE) {
        quest.setStage(player, STAGE_ULSQUIRE_TEMPLE);
      }
    }
  }

  /** Quest actions and item hand-outs in the transcript branches. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === "LyXCwi") {
      if (quest.getStage(player) >= STAGE_LIT_PYRE && !quest.isComplete(player)) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === "BYUtF3") {
      if (!player.getAttribute(OLIVE_OIL_ATTRIBUTE)) {
        player.getInventory().adds(ItemIdentifiers.OLIVE_OIL_3_, 1);
        player.setAttribute(OLIVE_OIL_ATTRIBUTE, true);
      }
      event.handled = true;
      return;
    }
    if (stepId === "yUgA1J" && RAZMIRE_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) === STAGE_KILLED_5 && remainingCount(player) >= 5) {
        removeRemains(player, 2);
        quest.setStage(player, STAGE_SHADES_TO_RAZMIRE);
      }
      return;
    }
    if (stepId === "tSotiE" && ULSQUIRE_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) === STAGE_SHADES_TO_RAZMIRE && remainingCount(player) > 0) {
        removeRemains(player, 1);
        quest.setStage(player, STAGE_SHADES_TO_ULSQUIRE);
      }
    }
  }

  /** Count the shades killed for Razmire and narrate each kill. */
  function handleNpcDeath({ player, npcId }) {
    if (!player || !SHADE_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_KILL_SHADES || stage >= STAGE_SHADES_TO_RAZMIRE) return;
    const kills = Math.min(5, (Number(player.getAttribute(KILLS_ATTRIBUTE)) || 0) + 1);
    player.setAttribute(KILLS_ATTRIBUTE, kills);
    const message = [
      "",
      "That's one Shade!",
      "That's two Shades!",
      "That's three Shades!",
      "That's four Shades!",
    ][kills];
    if (message) player.sendMessage(message);
    if (kills === 5) player.sendMessage("That's all five Shades!");
    quest.setStage(player, STAGE_KILLED_1 + (kills - 1) * 5);
  }

  /** Reading the diary: first read offers the quest-start branch. */
  function handleItemAction(event) {
    if (event.itemId !== DIARY_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) === STAGE_NOT_STARTED) {
      startTranscript(api, player, NpcIdentifiers.ULSQUIRE_SHAUNCY, PAGE, "reading-the-book");
      return;
    }
    player.sendMessage("You flick through Herbi Flax's diary.");
  }

  /** Ashes finish serum 207; sacred oil turns logs into pyre logs. */
  function handleItemOnItem(event) {
    const { player } = event;
    const used = event.usedItemId;
    const withId = event.usedWithItemId;
    const pair = [used, withId];

    if (
      pair.includes(ItemIdentifiers.ASHES) &&
      pair.includes(ItemIdentifiers.TARROMIN_POTION_UNF_)
    ) {
      if (quest.getStage(player) < STAGE_READ_DIARY) return;
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.ASHES, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.TARROMIN_POTION_UNF_, 1);
      player.getInventory().adds(ItemIdentifiers.SERUM_207_4_, 1);
      player.sendMessage("You make serum 207.");
      if (quest.getStage(player) === STAGE_READ_DIARY) {
        quest.setStage(player, STAGE_MADE_SERUM);
      }
      return;
    }

    if (!SACRED_OIL_ITEM_IDS.some((itemId) => pair.includes(itemId))) return;
    const logId = pair.find((itemId) => PYRE_LOG_RECIPES.has(itemId));
    if (logId === undefined) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_CREATED_SACRED_OIL) {
      player.sendMessage("This sacred oil doesn't seem fresh. You should make your own.");
      return;
    }
    const recipe = PYRE_LOG_RECIPES.get(logId);
    if (sacredOilDoses(player) < recipe.doses) {
      player.sendMessage(`This needs ${recipe.doses} doses of sacred oil.`);
      return;
    }
    drainDoses(player, SACRED_OIL_ITEM_IDS, recipe.doses);
    player.getInventory().deleteNumber(logId, 1);
    player.getInventory().adds(recipe.product, 1);
    player.sendMessage("You use the sacred oil on the logs and get pyre logs.");
    if (quest.getStage(player) < STAGE_CREATED_PYRE_LOGS) {
      quest.setStage(player, STAGE_CREATED_PYRE_LOGS);
    }
  }

  /** Serum cures Ulsquire and Razmire so their quest dialogue opens up. */
  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!ULSQUIRE_NPC_IDS.has(npcId) && !RAZMIRE_NPC_IDS.has(npcId)) return;
    const is207 = SERUM_207_ITEM_IDS.includes(event.itemId);
    const is208 = SERUM_208_ITEM_IDS.includes(event.itemId);
    if (!is207 && !is208) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) < STAGE_READ_DIARY) return;
    if (!drainDoses(player, is207 ? SERUM_207_ITEM_IDS : SERUM_208_ITEM_IDS, 1)) return;
    const key = ULSQUIRE_NPC_IDS.has(npcId)
      ? MET_ULSQUIRE_ATTRIBUTE
      : MET_RAZMIRE_ATTRIBUTE;
    player.setAttribute(key, player.getAttribute(key) || "cured");
    if (quest.getStage(player) < STAGE_MADE_SERUM) {
      player.sendMessage(
        "The serum it works...but it's not too fresh, make some yourself and then it might work for longer."
      );
      return;
    }
    if (is208 && !player.getAttribute(PERM_SERUM_ATTRIBUTE)) {
      player.setAttribute(PERM_SERUM_ATTRIBUTE, true);
      const coins = 180 + Math.floor(Math.random() * 41);
      player.getInventory().adds(ItemIdentifiers.COINS, coins);
      player.sendMessage(`You've been given ${coins} coins.`);
    }
  }

  /** Materials repair the temple; sacred flame oil; logs and remains on the pyre. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (TEMPLE_WALL_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      repairTemple(player);
      return;
    }
    if (ALTAR_OBJECT_IDS.has(objectId) && OLIVE_TO_SACRED.has(itemId)) {
      event.handled = true;
      sanctifyOil(player);
      return;
    }
    if (objectId === FUNERAL_PYRE_OBJECT_ID) {
      if (PYRE_LOG_RECIPES.has(itemId)) {
        event.handled = true;
        placePyreLogs(player, itemId);
        return;
      }
      if (REMAINS_ITEM_IDS.includes(itemId)) {
        event.handled = true;
        placePyreRemains(player, itemId);
        return;
      }
      if (itemId === ItemIdentifiers.TINDERBOX) {
        event.handled = true;
        lightPyre(player);
        return;
      }
      return;
    }
    if (ALTAR_OBJECT_IDS.has(objectId) && itemId === ItemIdentifiers.TINDERBOX) {
      event.handled = true;
      lightAltar(player);
    }
  }

  function repairTemple(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ULSQUIRE_TEMPLE) {
      player.sendMessage("You're not sure how you would go about fixing this.");
      return;
    }
    if (
      !held(player, ItemIdentifiers.HAMMER) &&
      !held(player, ItemIdentifiers.FLAMTAER_HAMMER)
    ) {
      player.sendMessage("You need a hammer to repair this temple.");
      return;
    }
    const hasTimber =
      held(player, ItemIdentifiers.TIMBER_BEAM) || held(player, ItemIdentifiers.PLANK);
    if (
      !held(player, ItemIdentifiers.LIMESTONE_BRICK) ||
      !hasTimber ||
      !held(player, ItemIdentifiers.SWAMP_PASTE, 5)
    ) {
      player.sendMessage(REPAIR_MATERIALS_MESSAGE);
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.LIMESTONE_BRICK, 1);
    player.getInventory().deleteNumber(
      held(player, ItemIdentifiers.TIMBER_BEAM)
        ? ItemIdentifiers.TIMBER_BEAM
        : ItemIdentifiers.PLANK,
      1
    );
    player.getInventory().deleteNumber(ItemIdentifiers.SWAMP_PASTE, 5);
    const built = (Number(player.getAttribute(TEMPLE_BUILD_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(TEMPLE_BUILD_ATTRIBUTE, built);
    player.sendMessage("You repair the temple wall.");
    if (stage < STAGE_REBUILD_TEMPLE) quest.setStage(player, STAGE_REBUILD_TEMPLE);
    if (built >= TEMPLE_BUILD_REQUIRED && quest.getStage(player) < STAGE_CAN_LIGHT_ALTAR) {
      quest.setStage(player, STAGE_CAN_LIGHT_ALTAR);
      player.sendMessage("You are now allowed to light the holy fire altar.");
    }
  }

  function sanctifyOil(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CAN_LIGHT_ALTAR) {
      player.sendMessage(
        "You need to have repaired or reinforced the walls of the temple before you can use the sacred flame."
      );
      return;
    }
    if (!player.getAttribute(ALTAR_LIT_ATTRIBUTE)) {
      player.sendMessage("The fire altar needs to be lit before you can sanctify oil.");
      return;
    }
    for (const [oilId, sacredId] of OLIVE_TO_SACRED) {
      if (player.getInventory().getAmount(oilId) <= 0) continue;
      player.getInventory().deleteNumber(oilId, 1);
      player.getInventory().adds(sacredId, 1);
      player.sendMessage("You carefully sanctify the oil in the sacred flame.");
      if (quest.getStage(player) < STAGE_CREATED_SACRED_OIL) {
        quest.setStage(player, STAGE_CREATED_SACRED_OIL);
      }
      return;
    }
  }

  function lightAltar(player) {
    if (quest.getStage(player) < STAGE_CAN_LIGHT_ALTAR) {
      player.sendMessage(
        "You need to have repaired or reinforced the walls of the temple before you can light the sacred flame."
      );
      return;
    }
    if (player.getAttribute(ALTAR_LIT_ATTRIBUTE)) {
      player.sendMessage("The fire altar is already lit.");
      return;
    }
    player.setAttribute(ALTAR_LIT_ATTRIBUTE, true);
    player.sendMessage("You light the temple fire.");
  }

  function placePyreLogs(player, itemId) {
    if (quest.getStage(player) < STAGE_CREATED_PYRE_LOGS) {
      player.sendMessage("You can't do that until you have made your own funeral pyre logs.");
      return;
    }
    if (player.getAttribute(PYRE_LOGS_ATTRIBUTE)) {
      player.sendMessage("You have already started a funeral.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    player.setAttribute(PYRE_LOGS_ATTRIBUTE, true);
    player.sendMessage("You put some logs on the pyre.");
    if (quest.getStage(player) < STAGE_LOGS_ON_PYRE) {
      quest.setStage(player, STAGE_LOGS_ON_PYRE);
    }
  }

  function placePyreRemains(player, itemId) {
    if (!player.getAttribute(PYRE_LOGS_ATTRIBUTE)) {
      player.sendMessage("You need to put wood on the pyre before adding the remains.");
      return;
    }
    if (player.getAttribute(PYRE_REMAINS_ATTRIBUTE)) {
      player.sendMessage("You've already placed a shade's remains on the pyre.");
      return;
    }
    if (player.getInventory().getAmount(itemId) <= 0) return;
    player.getInventory().deleteNumber(itemId, 1);
    player.setAttribute(PYRE_REMAINS_ATTRIBUTE, true);
    player.sendMessage("You place the shade's remains on the logs.");
  }

  function lightPyre(player) {
    if (!player.getAttribute(PYRE_REMAINS_ATTRIBUTE)) {
      player.sendMessage("You should add some pyre logs and some suitable remains before you light the pyre.");
      return;
    }
    player.setAttribute(PYRE_LOGS_ATTRIBUTE, false);
    player.setAttribute(PYRE_REMAINS_ATTRIBUTE, false);
    player.sendMessage("A reward appears on the stand.");
    player.getInventory().adds(
      ItemIdentifiers.COINS,
      100 + Math.floor(Math.random() * 1901)
    );
    if (quest.getStage(player) < STAGE_LIT_PYRE) {
      quest.setStage(player, STAGE_LIT_PYRE);
    }
  }

  /** The diary shelf and the smashed table of Herbi Flax's house. */
  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === SHELF_OBJECT_ID) {
      event.handled = true;
      if (held(player, DIARY_ITEM_ID)) {
        player.sendMessage("You find nothing useful here.");
        return;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage("There's a book on the shelf but you don't have room to take it.");
        return;
      }
      player.getInventory().adds(DIARY_ITEM_ID, 1);
      player.sendMessage("You find an interesting looking book on the shelf.");
      return;
    }
    if (objectId === SMASHED_TABLE_OBJECT_ID) {
      event.handled = true;
      if (player.getAttribute(TABLE_SEARCHED_ATTRIBUTE)) {
        player.sendMessage("You search the table but find nothing.");
        return;
      }
      if (freeSlots(player) < 3) {
        player.sendMessage(
          "You see three herbs inside, but you don't have enough inventory space to take them."
        );
        return;
      }
      player.setAttribute(TABLE_SEARCHED_ATTRIBUTE, true);
      player.getInventory().adds(ItemIdentifiers.GRIMY_TARROMIN, 2);
      player.sendMessage("You find a selection of herbs.");
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(KILLS_ATTRIBUTE);
  api.persistAttribute(MET_ULSQUIRE_ATTRIBUTE);
  api.persistAttribute(MET_RAZMIRE_ATTRIBUTE);
  api.persistAttribute(OLIVE_OIL_ATTRIBUTE);
  api.persistAttribute(TABLE_SEARCHED_ATTRIBUTE);
  api.persistAttribute(TEMPLE_BUILD_ATTRIBUTE);
  api.persistAttribute(ALTAR_LIT_ATTRIBUTE);
  api.persistAttribute(PYRE_LOGS_ATTRIBUTE);
  api.persistAttribute(PYRE_REMAINS_ATTRIBUTE);
  api.persistAttribute(PERM_SERUM_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "shades_of_mortton",
    name: "Shades of Mort'ton",
    varpId: VARP_SHADES_OF_MORTTON,
    startedValue: STAGE_READ_DIARY,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 20000, label: "Crafting" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 20000, label: "Herblore" },
    ],
    rewardItemId: ItemIdentifiers.SILVER_KEY_PURPLE,
    rewardItemLabel: "A silver key (purple)",
    otherRewards: ["Access to the Shade Lair", "Access to Razmire's stores"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onItemAction(handleItemAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
