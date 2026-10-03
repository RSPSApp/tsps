/**
 * Desert Treasure I (members).
 *
 * The words come from the "Desert Treasure I" transcript page. This plugin
 * supplies the variant selector for Asgarnia Smith, Terry Balando, the Bedabin
 * bartender, Eblis, Rasolo, Malak, Ruantun, the High Priest, the Troll child and
 * Azzanadra; the start hook; the prose-condition answers; the etchings /
 * translation hand-ins; the Eblis mirror materials; the garlic powder; the
 * shadow-diamond gilded cross trade; the bandit chest; the boss-diamond drops;
 * and the Azzanadra completion action.
 *
 * Stages (varp 440): 1 started, 2 translation received, 3 translation delivered,
 * 4 agreed to hunt, 6 learned of the bandits, 8 Eblis found, 9 materials needed,
 * 10/11 mirrors set up, 13 diamonds placed, 15 complete.
 *
 * Gaps (no dump/index support): the four bosses (Damis/Dessous/Kamil/Fareed) are
 * not spawned, so the diamond drops only fire if those NPCs already exist in the
 * world; the pyramid obelisks (6482/6485/6488/6491) and smoke torches
 * (6405-6411) have no ObjectIdentifiers, so the diamond pillars and the warm-key
 * torch puzzle are not wired; the smoke-dungeon chest/gate and the ice gate are
 * only partially covered. The six prerequisite quests and the 50 Magic gate are
 * only checked for Magic (other quest varps are not readable here).
 */
module.exports = function registerDesertTreasureIQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const ASGARNIA_IDS = new Set([
    NpcIdentifiers.ASGARNIA_SMITH,
    NpcIdentifiers.ASGARNIA_SMITH_2,
    NpcIdentifiers.ASGARNIA_SMITH_3,
  ]);
  const TERRY_NPC_ID = NpcIdentifiers.TERRY_BALANDO;
  const BARTENDER_NPC_ID = NpcIdentifiers.BARTENDER;
  const EBLIS_IDS = new Set([NpcIdentifiers.EBLIS, NpcIdentifiers.EBLIS_2]);
  const RASOLO_NPC_ID = NpcIdentifiers.RASOLO;
  const MALAK_NPC_ID = NpcIdentifiers.MALAK;
  const RUANTUN_NPC_ID = NpcIdentifiers.RUANTUN;
  const HIGH_PRIEST_IDS = new Set([NpcIdentifiers.HIGH_PRIEST, NpcIdentifiers.HIGH_PRIEST_3]);
  const TROLL_CHILD_IDS = new Set([NpcIdentifiers.TROLL_CHILD, NpcIdentifiers.TROLL_CHILD_2]);
  const AZZANADRA_IDS = new Set([
    NpcIdentifiers.AZZANADRA,
    NpcIdentifiers.AZZANADRA_2,
    NpcIdentifiers.AZZANADRA_3,
    NpcIdentifiers.AZZANADRA_4,
    NpcIdentifiers.AZZANADRA_5,
  ]);

  const DAMIS_SECOND_NPC_ID = NpcIdentifiers.DAMIS_2;
  const DESSOUS_NPC_ID = NpcIdentifiers.DESSOUS;
  const KAMIL_NPC_ID = NpcIdentifiers.KAMIL;
  const FAREED_NPC_ID = NpcIdentifiers.FAREED;

  const BANDIT_CHEST_ID = ObjectIdentifiers.SECURE_CHEST;

  const VARP_DESERT_TREASURE = 440;
  const STAGE_STARTED = 1;
  const STAGE_TRANSLATION_RECEIVED = 2;
  const STAGE_TRANSLATION_DELIVERED = 3;
  const STAGE_AGREED = 4;
  const STAGE_BANDITS = 6;
  const STAGE_EBLIS_FOUND = 8;
  const STAGE_MATERIALS = 9;
  const STAGE_MIRRORS = 10;
  const STAGE_HUNT = 11;
  const STAGE_PLACED = 13;
  const STAGE_COMPLETE = 15;

  const ETCHINGS = ItemIdentifiers.ETCHINGS;
  const TRANSLATION = ItemIdentifiers.TRANSLATION;
  const RING_OF_VISIBILITY = ItemIdentifiers.RING_OF_VISIBILITY;
  const SILVER_POT = ItemIdentifiers.SILVER_POT_3;
  const BLESSED_POT = ItemIdentifiers.BLESSED_POT_5;
  const GARLIC = ItemIdentifiers.GARLIC;
  const GARLIC_POWDER = ItemIdentifiers.GARLIC_POWDER;
  const PESTLE_AND_MORTAR = ItemIdentifiers.PESTLE_AND_MORTAR;
  const BLOOD_DIAMOND = ItemIdentifiers.BLOOD_DIAMOND;
  const ICE_DIAMOND = ItemIdentifiers.ICE_DIAMOND;
  const SMOKE_DIAMOND = ItemIdentifiers.SMOKE_DIAMOND;
  const SHADOW_DIAMOND = ItemIdentifiers.SHADOW_DIAMOND;
  const GILDED_CROSS = ItemIdentifiers.GILDED_CROSS;
  const ANCIENT_STAFF = ItemIdentifiers.ANCIENT_STAFF;
  const BANDITS_BREW = ItemIdentifiers.BANDITS_BREW;
  const SILVER_BAR = ItemIdentifiers.SILVER_BAR;
  const COINS = ItemIdentifiers.COINS;
  const LOCKPICK = ItemIdentifiers.LOCKPICK;

  const DIAMOND_IDS = [BLOOD_DIAMOND, ICE_DIAMOND, SMOKE_DIAMOND, SHADOW_DIAMOND];
  const EBLIS_SUPPLIES = [
    { itemId: ItemIdentifiers.MAGIC_LOGS, quantity: 12, label: "12 magic logs" },
    { itemId: ItemIdentifiers.STEEL_BAR, quantity: 6, label: "6 steel bars" },
    { itemId: ItemIdentifiers.MOLTEN_GLASS, quantity: 6, label: "6 molten glass" },
    { itemId: ItemIdentifiers.ASHES, quantity: 1, label: "Ashes" },
    { itemId: ItemIdentifiers.CHARCOAL, quantity: 1, label: "Charcoal" },
    { itemId: ItemIdentifiers.BLOOD_RUNE, quantity: 1, label: "A blood rune" },
    { itemId: ItemIdentifiers.BONES, quantity: 1, label: "Bones" },
  ];

  const START_HOOK = "quest:desert-treasure-i:start";
  const COMPLETE_ACTION_ID = "y8-TJV";

  let quest;

  const has = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const hasAllSupplies = (player) => EBLIS_SUPPLIES.every((entry) => has(player, entry.itemId, entry.quantity));
  const hasAllDiamonds = (player) => DIAMOND_IDS.every((itemId) => has(player, itemId));
  const magicLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.MAGIC);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I freed Azzanadra from the desert pyramid.</str>",
        "<str>I can now use the Ancient Magicks spellbook.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_PLACED) {
      return [
        "I placed the four diamonds in their obelisks.",
        "I must reach <col=800000>Azzanadra</col> at the heart of the pyramid.",
      ];
    }
    if (stage >= STAGE_HUNT) {
      return [
        "I must recover the four Diamonds of Azzanadra:",
        `${has(player, BLOOD_DIAMOND) ? "<str>" : ""}Blood diamond${has(player, BLOOD_DIAMOND) ? "</str>" : ""}`,
        `${has(player, ICE_DIAMOND) ? "<str>" : ""}Ice diamond${has(player, ICE_DIAMOND) ? "</str>" : ""}`,
        `${has(player, SMOKE_DIAMOND) ? "<str>" : ""}Smoke diamond${has(player, SMOKE_DIAMOND) ? "</str>" : ""}`,
        `${has(player, SHADOW_DIAMOND) ? "<str>" : ""}Shadow diamond${has(player, SHADOW_DIAMOND) ? "</str>" : ""}`,
      ];
    }
    if (stage >= STAGE_MATERIALS) {
      return [
        "Eblis needs materials to make scrying mirrors:",
        ...EBLIS_SUPPLIES.map((entry) => (has(player, entry.itemId, entry.quantity) ? `<str>${entry.label}</str>` : entry.label)),
      ];
    }
    if (stage >= STAGE_EBLIS_FOUND) {
      return ["I found Eblis in the Bandit Camp.", "I should ask him how to locate Azzanadra's diamonds."];
    }
    if (stage >= STAGE_BANDITS) {
      return ["The translation points to the Bandit Camp.", "I should buy a <col=800000>Bandit's brew</col> and question the bartender."];
    }
    if (stage >= STAGE_AGREED) {
      return ["Terry Balando translated the desert etchings.", "I should show the translation to the <col=800000>Asgarnia Smith</col>."];
    }
    if (stage >= STAGE_STARTED) {
      return ["The Asgarnia Smith found ancient etchings in the desert.", "I should take them to <col=800000>Terry Balando</col> at the Dig Site."];
    }
    return [
      "Speak to the <col=800000>Asgarnia Smith</col> at the Bedabin Camp.",
      "I need 50 <col=800000>Magic</col> and six prerequisite quests.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.MAGIC, 20000);
  }

  function asgarniaVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_PLACED) return "the-ancient-pyramid-after-replacing-the-diamonds-before-going-inside-asgarnia-smith";
    if (stage >= STAGE_EBLIS_FOUND) {
      return hasAllDiamonds(player)
        ? "the-ancient-pyramid-talking-to-asgarnia-with-all-the-diamonds"
        : "enchanting-the-mirrors-talking-to-asgarnia-after-learning-about-the-diamonds-of-azzanadra";
    }
    if (stage >= STAGE_AGREED) return "enchanting-the-mirrors-talking-to-asgarnia-after-agreeing-to-hunt-for-treasure";
    if (stage === STAGE_TRANSLATION_DELIVERED) return "enchanting-the-mirrors-talking-to-asgarnia-after-delivering-the-translation";
    if (stage === STAGE_TRANSLATION_RECEIVED) return "enchanting-the-mirrors-talking-to-asgarnia-after-receiving-the-translation";
    if (stage >= STAGE_STARTED) return "enchanting-the-mirrors-talking-to-asgarnia-after-starting-the-quest";
    return magicLevel(player) >= 50
      ? "enchanting-the-mirrors-talking-to-asgarnia-with-the-required-quests"
      : "enchanting-the-mirrors-talking-to-asgarnia-without-the-required-quests";
  }

  function terryVariant(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_STARTED) {
      if (has(player, ETCHINGS)) {
        take(player, ETCHINGS);
        return "enchanting-the-mirrors-talking-to-terry";
      }
      return "enchanting-the-mirrors-talking-to-terry-after-delivering-the-etchings";
    }
    if (stage === STAGE_TRANSLATION_RECEIVED) {
      return has(player, TRANSLATION)
        ? "enchanting-the-mirrors-talking-to-terry-after-receiving-the-translation"
        : "enchanting-the-mirrors-talking-to-terry-after-losing-the-translation";
    }
    return "enchanting-the-mirrors-talking-to-terry-after-delivering-his-translation";
  }

  function bartenderVariant(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_AGREED || stage === STAGE_BANDITS) {
      if (has(player, BANDITS_BREW)) {
        if (stage < STAGE_EBLIS_FOUND) quest.setStage(player, STAGE_EBLIS_FOUND);
        return "enchanting-the-mirrors-talking-to-the-bartender-after-buying-a-drink";
      }
      return "enchanting-the-mirrors-talking-to-the-bartender";
    }
    if (stage === STAGE_EBLIS_FOUND) {
      return "enchanting-the-mirrors-talking-to-the-bartender-after-asking-about-the-diamonds-and-before-talking-to-eblis";
    }
    return "enchanting-the-mirrors-talking-to-the-bartender-after-buying-a-drink";
  }

  function eblisVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-eblis";
    if (stage >= STAGE_PLACED) return "the-ancient-pyramid-after-replacing-the-diamonds-before-going-inside-eblis";
    if (stage >= STAGE_HUNT) {
      return hasAllDiamonds(player)
        ? "the-ancient-pyramid-talking-to-eblis-with-four-diamonds"
        : "enchanting-the-mirrors-talking-to-eblis-again-after-giving-all-ingredients";
    }
    if (stage === STAGE_MIRRORS) {
      quest.setStage(player, STAGE_HUNT);
      return "enchanting-the-mirrors-talking-to-eblis-at-the-mirrors";
    }
    if (stage === STAGE_MATERIALS) {
      if (hasAllSupplies(player)) {
        for (const entry of EBLIS_SUPPLIES) take(player, entry.itemId, entry.quantity);
        quest.setStage(player, STAGE_MIRRORS);
        return "enchanting-the-mirrors-talking-to-eblis-after-giving-all-ingredients";
      }
      return "enchanting-the-mirrors-talking-to-eblis-after-asking-the-bartender-about-the-diamonds";
    }
    if (stage === STAGE_EBLIS_FOUND) {
      quest.setStage(player, STAGE_MATERIALS);
      return "enchanting-the-mirrors-talking-to-eblis-before-asking-the-bartender-about-the-diamonds";
    }
    return "enchanting-the-mirrors-talking-to-eblis-before-asking-the-bartender-about-the-diamonds";
  }

  function rasoloVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_HUNT) return "shadow-diamond-talking-to-rasolo";
    if (has(player, SHADOW_DIAMOND)) return "shadow-diamond-talking-to-rasolo-again";
    if (stage < STAGE_PLACED && has(player, GILDED_CROSS)) {
      take(player, GILDED_CROSS);
      if (!has(player, RING_OF_VISIBILITY)) give(player, RING_OF_VISIBILITY);
      player.sendMessage("Rasolo trades you the Ring of Visibility.");
      return "shadow-diamond-returning-to-rasolo";
    }
    return "shadow-diamond-talking-to-rasolo-again";
  }

  function selectVariant({ npcId, player }) {
    if (ASGARNIA_IDS.has(npcId)) return asgarniaVariant(player);
    if (npcId === TERRY_NPC_ID) return terryVariant(player);
    if (npcId === BARTENDER_NPC_ID) return bartenderVariant(player);
    if (EBLIS_IDS.has(npcId)) return eblisVariant(player);
    if (npcId === RASOLO_NPC_ID) return rasoloVariant(player);
    const stage = quest.getStage(player);
    if (npcId === MALAK_NPC_ID) {
      if (stage < STAGE_HUNT) return "blood-diamond-talking-to-malak";
      return has(player, BLOOD_DIAMOND)
        ? "blood-diamond-talking-to-malak-after-obtaining-the-blood-diamond"
        : "blood-diamond-talking-to-malak-after-agreeing-to-kill-dessous";
    }
    if (npcId === RUANTUN_NPC_ID) {
      if (stage >= STAGE_HUNT && !has(player, SILVER_POT) && !has(player, BLESSED_POT) && has(player, SILVER_BAR)) {
        take(player, SILVER_BAR);
        give(player, SILVER_POT);
        player.sendMessage("Ruantun crafts you a silver pot.");
      }
      return "blood-diamond-talking-to-ruantun";
    }
    if (HIGH_PRIEST_IDS.has(npcId)) {
      if (stage >= STAGE_HUNT && has(player, SILVER_POT)) {
        take(player, SILVER_POT);
        if (!has(player, BLESSED_POT)) give(player, BLESSED_POT);
        player.sendMessage("The High Priest blesses your silver pot.");
        return "blood-diamond-talking-to-the-high-priest-with-a-silver-pot-of-your-own-blood";
      }
      return "blood-diamond-talking-to-the-high-priest";
    }
    if (TROLL_CHILD_IDS.has(npcId)) {
      if (stage >= STAGE_HUNT && has(player, ICE_DIAMOND)) {
        return "ice-diamond-talking-to-the-troll-child-after-receiving-the-ice-diamond";
      }
      return "ice-diamond-talking-to-the-troll-child";
    }
    if (AZZANADRA_IDS.has(npcId)) {
      return stage >= STAGE_PLACED ? "the-ancient-pyramid-talking-to-azzanadra" : null;
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("without the required skill levels")) return magicLevel(player) < 50;
    if (value.includes("doesn't have the etchings") || value.includes("lost the etchings")) {
      return !has(player, ETCHINGS);
    }
    if (value.includes("etchings")) return has(player, ETCHINGS);
    if (value.includes("doesn't have the translation") || value.includes("lost the translation")) {
      return !has(player, TRANSLATION);
    }
    if (value.includes("translation")) return has(player, TRANSLATION);
    if (value.includes("warm key")) return has(player, ItemIdentifiers.WARM_KEY);
    if (value.includes("lost the cross")) return !has(player, GILDED_CROSS);
    if (value.includes("still has the cross")) return has(player, GILDED_CROSS);
    if (value.includes("full inventory")) return player.getInventory().isFull?.() === true;
    return null;
  }

  /** Asgarnia's "Help him" decision has no hook; advance the hunt stage. */
  function handleChoice({ player, npcId, option }) {
    if (!ASGARNIA_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_TRANSLATION_DELIVERED) return;
    if (/help him/i.test(String(option ?? ""))) quest.setStage(player, STAGE_AGREED);
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!ASGARNIA_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (stepId === "n513zs" || stepId === "PoD0Nh") {
      if (!has(player, ETCHINGS)) give(player, ETCHINGS);
      return;
    }
    if (stepId === "4k_Mh4" || stepId === "sAesSI") {
      if (!has(player, TRANSLATION)) give(player, TRANSLATION);
      if (quest.getStage(player) < STAGE_TRANSLATION_RECEIVED) {
        quest.setStage(player, STAGE_TRANSLATION_RECEIVED);
      }
      return;
    }
    if (stepId === "SV5eWc") {
      if (has(player, TRANSLATION)) take(player, TRANSLATION);
      if (quest.getStage(player) < STAGE_TRANSLATION_DELIVERED) {
        quest.setStage(player, STAGE_TRANSLATION_DELIVERED);
      }
      return;
    }
    if (stepId === "sRlaoo") {
      if (!has(player, BANDITS_BREW)) give(player, BANDITS_BREW);
      return;
    }
    if (stepId === "vIMkMd") {
      take(player, COINS, 650);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID && AZZANADRA_IDS.has(npcId)) {
      if (!quest.isComplete(player)) quest.complete(player);
    }
  }

  /** The four diamond drops, in case the bosses are present in the world. */
  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    const { npcId } = event;
    if (!player || quest.getStage(player) < STAGE_HUNT) return;
    const drop = npcId === DAMIS_SECOND_NPC_ID ? SHADOW_DIAMOND
      : npcId === DESSOUS_NPC_ID ? BLOOD_DIAMOND
      : npcId === KAMIL_NPC_ID ? ICE_DIAMOND
      : npcId === FAREED_NPC_ID ? SMOKE_DIAMOND
      : undefined;
    if (drop === undefined) return;
    if (!has(player, drop) && !player.getInventory().isFull()) give(player, drop);
  }

  /** Grinding garlic with a pestle and mortar makes garlic powder. */
  function handleGarlic(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(GARLIC) || !ids.includes(PESTLE_AND_MORTAR)) return;
    const { player } = event;
    take(player, GARLIC);
    give(player, GARLIC_POWDER);
    player.sendMessage("You grind the garlic into a fine powder.");
    event.handled = true;
  }

  /** The Bandit Camp secure chest holds Rasolo's gilded cross. */
  function handleBanditChest(event) {
    if (event.objectId !== BANDIT_CHEST_ID) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_HUNT || has(player, GILDED_CROSS)) return;
    if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < 53 || !has(player, LOCKPICK)) {
      player.sendMessage("You need 53 Thieving and a lockpick to open this secure chest.");
      event.handled = true;
      return;
    }
    give(player, GILDED_CROSS);
    player.sendMessage("You pick the lock and find a gilded cross.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "desert_treasure_i",
    name: "Desert Treasure I",
    varpId: VARP_DESERT_TREASURE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.MAGIC.getIndex(), amount: 20000, label: "Magic" }],
    rewardItemId: ANCIENT_STAFF,
    rewardItemLabel: "An Ancient staff",
    otherRewards: [
      "Access to the Ancient Magicks spellbook",
      "The ability to purchase an Ancient staff",
      "Access to the Smoke Dungeon",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcDeath(handleNpcDeath);
  api.onItemOnItem(handleGarlic);
  api.onObjectInteraction(handleBanditChest);
  api.onPlayerLogin(handleLogin);
};
