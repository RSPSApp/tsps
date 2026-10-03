/**
 * Waterfall Quest (members).
 *
 * Almera (4181), Hudon (4182), Hadley (4179) and Golrie (892/4183) are indexed on
 * the "Waterfall Quest" transcript page, so the talk and hand-overs are
 * transcript-driven; this plugin picks the variant by stage, answers the page's
 * prose conditions, runs the start hook and gives the Book on Baxtorian when
 * Hadley is asked about the elven king. The gathering steps are wired here:
 * Glarial's pebble on her tombstone, her amulet and urn onto the statue, then the
 * rune puzzle at the Chalice of Eternity completes the quest.
 *
 * Stages (varp 65): 1 started, 2 spoken to Hudon, 3 read the book, 4 got the
 * pebble, 5 got the amulet and urn, 8 relics placed, 10 complete.
 *
 * Gaps (no dump support): the raft/barrel/swimming travel, the waterfall dungeon
 * doors and the rune-on-pillar placements are not modelled; the Chalice just
 * checks the six air, water and earth runes. Hadley hands over the book on the
 * elven-king option rather than a bookcase search, as in the reference.
 */
module.exports = function registerWaterfallQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Equipment } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const PAGE = "Waterfall Quest";

  const ALMERA_NPC_ID = NpcIdentifiers.ALMERA;
  const HUDON_NPC_ID = NpcIdentifiers.HUDON;
  const HADLEY_NPC_ID = NpcIdentifiers.HADLEY;
  const GOLRIE_NPC_IDS = new Set([NpcIdentifiers.GOLRIE, NpcIdentifiers.GOLRIE_2]);

  const VARP_WATERFALL_QUEST = 65;
  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_HUDON = 2;
  const STAGE_READ_BOOK = 3;
  const STAGE_GOT_PEBBLE = 4;
  const STAGE_GOT_RELICS = 5;
  const STAGE_PLACED_RELICS = 8;
  const STAGE_COMPLETE = 10;

  const BOOK_ON_BAXTORIAN_ITEM_ID = ItemIdentifiers.BOOK_ON_BAXTORIAN;
  const GLARIALS_PEBBLE_ITEM_ID = ItemIdentifiers.GLARIALS_PEBBLE;
  const GLARIALS_AMULET_ITEM_ID = ItemIdentifiers.GLARIALS_AMULET;
  const GLARIALS_URN_ITEM_ID = ItemIdentifiers.GLARIALS_URN;
  const AIR_RUNE_ITEM_ID = ItemIdentifiers.AIR_RUNE;
  const WATER_RUNE_ITEM_ID = ItemIdentifiers.WATER_RUNE;
  const EARTH_RUNE_ITEM_ID = ItemIdentifiers.EARTH_RUNE;
  const DIAMOND_ITEM_ID = ItemIdentifiers.DIAMOND;
  const GOLD_BAR_ITEM_ID = ItemIdentifiers.GOLD_BAR;
  const MITHRIL_SEEDS_ITEM_ID = ItemIdentifiers.MITHRIL_SEEDS;

  const GLARIALS_TOMBSTONE_LOC_ID = ObjectIdentifiers.GLARIALS_TOMBSTONE;
  const STATUE_OF_GLARIAL_LOC_ID = ObjectIdentifiers.STATUE_OF_GLARIAL;
  const CHALICE_LOC_ID = ObjectIdentifiers.CHALICE_OF_ETERNITY;

  const RUNES_REQUIRED = 6;
  const START_HOOK = "quest:waterfall-quest:start";

  let quest;

  const hasItem = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const hasBook = (player) => hasItem(player, BOOK_ON_BAXTORIAN_ITEM_ID);
  const hasAllRunes = (player) =>
    hasItem(player, AIR_RUNE_ITEM_ID, RUNES_REQUIRED) &&
    hasItem(player, WATER_RUNE_ITEM_ID, RUNES_REQUIRED) &&
    hasItem(player, EARTH_RUNE_ITEM_ID, RUNES_REQUIRED);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I discovered the treasure of Baxtorian.</str>",
        "<str>I survived the waterfall dungeon.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_PLACED_RELICS) {
      return [
        "I placed Glarial's amulet and urn at the statue.",
        "I should take the treasure from <col=800000>Baxtorian's chalice</col>.",
      ];
    }
    if (stage >= STAGE_GOT_RELICS) {
      return [
        "I recovered Glarial's amulet and urn.",
        "The dungeon requires <col=800000>6 air, water and earth runes</col>.",
      ];
    }
    if (stage >= STAGE_READ_BOOK) {
      return [
        "I read the Book on Baxtorian.",
        "I should ask <col=800000>Golrie</col> about Glarial's tomb.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Almera fears for her son Hudon.",
        "I should investigate the waterfall and speak to <col=800000>Hadley</col>.",
      ];
    }
    return ["I can start this quest by speaking to", "<col=800000>Almera</col> beside Baxtorian Falls."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, 13750);
    player.getSkillManager().addExperiences(Skill.STRENGTH, 13750);
    player.getInventory().adds(DIAMOND_ITEM_ID, 2);
    player.getInventory().adds(GOLD_BAR_ITEM_ID, 2);
    player.getInventory().adds(MITHRIL_SEEDS_ITEM_ID, 40);
  }

  function almeraVariant(stage) {
    if (stage >= STAGE_GOT_RELICS) return "obtaining-the-pebble-talking-to-almera-after-visiting-glarial-s-tomb";
    if (stage >= STAGE_READ_BOOK) return "starting-out-talking-to-almera-after-reading-the-book";
    if (stage >= STAGE_SPOKEN_HUDON) return "starting-out-talking-to-almera-after-talking-to-hudon";
    if (stage >= STAGE_STARTED) return "starting-out-talking-to-almera-talking-to-almera-again";
    return "starting-out-talking-to-almera";
  }

  function hudonVariant(stage, player) {
    if (stage >= STAGE_PLACED_RELICS) return "accessing-the-waterfall-dungeon-talking-to-hudon-after-discovering-the-chalice";
    if (stage >= STAGE_GOT_RELICS) return "obtaining-the-pebble-talking-to-hudon-after-visiting-glarial-s-tomb";
    if (stage >= STAGE_READ_BOOK) return "starting-out-talking-to-hudon-after-reading-the-book";
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_SPOKEN_HUDON);
      return "starting-out-using-the-raft";
    }
    return "starting-out-using-the-raft";
  }

  function golrieVariant(stage) {
    if (stage >= STAGE_GOT_PEBBLE) return "obtaining-the-pebble-talking-to-golrie-talking-to-golrie-again-without-the-pebble";
    if (stage >= STAGE_READ_BOOK) return "obtaining-the-pebble-talking-to-golrie";
    return "obtaining-the-pebble-opening-door-to-golrie-from-the-outside";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === ALMERA_NPC_ID) return almeraVariant(stage);
    if (npcId === HUDON_NPC_ID) return hudonVariant(stage, player);
    if (npcId === HADLEY_NPC_ID) return "starting-out-talking-to-hadley";
    if (GOLRIE_NPC_IDS.has(npcId)) return golrieVariant(stage);
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const equipment = player.getEquipment();
    const wearingAmulet = equipment.get(Equipment.AMULET_SLOT)?.getId?.() === GLARIALS_AMULET_ITEM_ID;
    if (value.includes("combat level lower than 25")) {
      const skills = player.getSkillManager();
      const combat = typeof skills.getCombatLevel === "function" ? skills.getCombatLevel() : 999;
      return combat < 25;
    }
    if (value.includes("doesn't have the book") || value.includes("does not have the book")) return !hasBook(player);
    if (value.includes("has the book") || value.includes("already has the book")) return hasBook(player);
    if (value.includes("no inventory space")) return player.getInventory().isFull();
    if (value.includes("does not have glarial's amulet")) return !hasItem(player, GLARIALS_AMULET_ITEM_ID);
    if (value.includes("already has glarial's amulet")) return hasItem(player, GLARIALS_AMULET_ITEM_ID);
    if (value.includes("does not have glarial's urn")) return !hasItem(player, GLARIALS_URN_ITEM_ID);
    if (value.includes("already has glarial's urn")) return hasItem(player, GLARIALS_URN_ITEM_ID);
    if (value.includes("wearing glarial's amulet")) return wearingAmulet;
    if (value.includes("not wearing glarial's amulet")) return !wearingAmulet;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== ALMERA_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Asking Hadley about the elven king produces the Book on Baxtorian. */
  function handleChoice({ player, npcId, option }) {
    if (npcId !== HADLEY_NPC_ID) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_HUDON || stage >= STAGE_READ_BOOK) return;
    if (!String(option ?? "").toLowerCase().includes("elven king")) return;
    if (!hasBook(player) && !player.getInventory().isFull()) {
      player.getInventory().adds(BOOK_ON_BAXTORIAN_ITEM_ID, 1);
      player.sendMessage("You take the Book on Baxtorian from the bookcase.");
    }
    quest.setStage(player, STAGE_READ_BOOK);
  }

  /** Golrie's junk pile yields Glarial's pebble. */
  function handleAction(event) {
    if (event.stepId === "2-d8NO") {
      const { player } = event;
      if (quest.getStage(player) >= STAGE_READ_BOOK && !hasItem(player, GLARIALS_PEBBLE_ITEM_ID)) {
        if (!player.getInventory().isFull()) {
          player.getInventory().adds(GLARIALS_PEBBLE_ITEM_ID, 1);
          quest.setStage(player, STAGE_GOT_PEBBLE);
        }
      }
      event.handled = true;
    }
  }

  /** Pebble into the tombstone's indent releases the amulet and urn. */
  function handlePebbleOnTombstone(event) {
    if (event.objectId !== GLARIALS_TOMBSTONE_LOC_ID || event.itemId !== GLARIALS_PEBBLE_ITEM_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_GOT_PEBBLE) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(GLARIALS_PEBBLE_ITEM_ID, 1);
    player.getInventory().adds(GLARIALS_AMULET_ITEM_ID, 1);
    player.getInventory().adds(GLARIALS_URN_ITEM_ID, 1);
    quest.setStage(player, STAGE_GOT_RELICS);
    player.sendMessage("The pebble unlocks Glarial's tomb; you recover her amulet and urn.");
    event.handled = true;
  }

  /** Placing both relics on Glarial's statue opens the way to the chalice. */
  function handlePlaceRelics(event) {
    if (event.objectId !== STATUE_OF_GLARIAL_LOC_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_GOT_RELICS) return;
    if (!hasItem(player, GLARIALS_AMULET_ITEM_ID) || !hasItem(player, GLARIALS_URN_ITEM_ID)) {
      player.sendMessage("You need Glarial's amulet and urn.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(GLARIALS_AMULET_ITEM_ID, 1);
    player.getInventory().deleteNumber(GLARIALS_URN_ITEM_ID, 1);
    quest.setStage(player, STAGE_PLACED_RELICS);
    player.sendMessage("You place Glarial's relics before Baxtorian's statue.");
    event.handled = true;
  }

  /** The chalice needs six of each elemental rune. */
  function handleChalice(event) {
    if (event.objectId !== CHALICE_LOC_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_PLACED_RELICS) return;
    if (!hasAllRunes(player)) {
      player.sendMessage("The spell requires 6 air, 6 water, and 6 earth runes.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(AIR_RUNE_ITEM_ID, RUNES_REQUIRED);
    player.getInventory().deleteNumber(WATER_RUNE_ITEM_ID, RUNES_REQUIRED);
    player.getInventory().deleteNumber(EARTH_RUNE_ITEM_ID, RUNES_REQUIRED);
    quest.complete(player);
    event.handled = true;
  }

  quest = registerQuest(api, {
    key: "waterfall_quest",
    name: "Waterfall Quest",
    varpId: VARP_WATERFALL_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.ATTACK.getIndex(), amount: 13750, label: "Attack" },
      { skillId: Skill.STRENGTH.getIndex(), amount: 13750, label: "Strength" },
    ],
    rewardItemId: ItemIdentifiers.GLARIALS_URN_EMPTY_,
    rewardItemLabel: "Glarial's urn",
    otherRewards: ["2 Diamonds", "2 Gold bars", "40 Mithril seeds", "Access to the Waterfall Dungeon"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnObject(handlePebbleOnTombstone);
  api.onObjectInteraction(handlePlaceRelics);
  api.onObjectInteraction(handleChalice);
};
