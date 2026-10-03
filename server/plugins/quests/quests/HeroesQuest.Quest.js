/**
 * Heroes' Quest (members).
 *
 * The words come from the "Heroes' Quest" transcript page. This plugin supplies
 * the variant selector for Achietties and the Phoenix / Black Arm contacts, the
 * start hook, the prose-condition answers, the three-proof hand-in, Gerrant's
 * slime, the blamish-oil / oily-rod crafting, the ice gloves / fire feather
 * drops, the Grip keyring and the two candlestick hand-ins.
 *
 * Stages (varp 188): 1 started, 2 Phoenix told by Straven, 3 Alfonse, 4 Charlie
 * 5 Grip (Phoenix), 6 Phoenix armband; 7 Black Arm told by Katrine, 8 Grubor,
 * 9 Trobert's papers, 10 mansion (Grip), 11 candlestick, 12 Katrine, 13 Black
 * Arm armband; 15 complete.
 *
 * Gaps (no dump/index support): Gerrant (2891) is not indexed, so he is replayed
 * from an interaction; the lava-fishing spot (2630) is not in ObjectIdentifiers,
 * so raw lava eels must be obtained elsewhere and only the cook step is wired.
 * Gang membership is inferred from which contact the player talks to (the
 * Shield of Arrav gang varp is not readable here).
 */
module.exports = function registerHeroesQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Heroes' Quest";

  const ACHIETTIES_IDS = new Set([
    NpcIdentifiers.ACHIETTIES,
    NpcIdentifiers.ACHIETTIES_2,
    NpcIdentifiers.ACHIETTIES_3,
    NpcIdentifiers.ACHIETTIES_4,
    NpcIdentifiers.ACHIETTIES_5,
  ]);
  const STRAVEN_NPC_ID = NpcIdentifiers.STRAVEN;
  const ALFONSE_NPC_ID = NpcIdentifiers.ALFONSE_THE_WAITER;
  const CHARLIE_NPC_ID = NpcIdentifiers.CHARLIE_THE_COOK;
  const GARV_NPC_ID = NpcIdentifiers.GARV;
  const GRUBOR_NPC_ID = NpcIdentifiers.GRUBOR;
  const TROBERT_NPC_ID = NpcIdentifiers.TROBERT;
  const GRIP_NPC_ID = NpcIdentifiers.GRIP;
  const KATRINE_NPC_ID = NpcIdentifiers.KATRINE;
  const GERRANT_NPC_ID = NpcIdentifiers.GERRANT;
  const ICE_QUEEN_NPC_ID = NpcIdentifiers.ICE_QUEEN;
  const FIREBIRD_NPC_ID = NpcIdentifiers.ENTRANA_FIREBIRD;

  const CANDLESTICK_CHEST_IDS = [ObjectIdentifiers.CHEST_18, ObjectIdentifiers.CHEST_19];

  const VARP_HEROES_QUEST = 188;
  const STAGE_STARTED = 1;
  const STAGE_PHOENIX_STRAVEN = 2;
  const STAGE_PHOENIX_ALFONSE = 3;
  const STAGE_PHOENIX_CHARLIE = 4;
  const STAGE_PHOENIX_GRIP = 5;
  const STAGE_PHOENIX_ARMBAND = 6;
  const STAGE_BLACK_KATRINE = 7;
  const STAGE_BLACK_HQ = 8;
  const STAGE_BLACK_PAPERS = 9;
  const STAGE_BLACK_MANSION = 10;
  const STAGE_BLACK_GRIP = 11;
  const STAGE_BLACK_CANDLESTICK = 12;
  const STAGE_BLACK_ARMBAND = 13;
  const STAGE_COMPLETE = 15;

  const FIRE_FEATHER = ItemIdentifiers.FIRE_FEATHER;
  const COOKED_LAVA_EEL = ItemIdentifiers.LAVA_EEL;
  const RAW_LAVA_EEL = ItemIdentifiers.RAW_LAVA_EEL;
  const ARMBAND = ItemIdentifiers.THIEVES_ARMBAND;
  const ICE_GLOVES = ItemIdentifiers.ICE_GLOVES;
  const BLAMISH_SLIME = ItemIdentifiers.BLAMISH_SNAIL_SLIME;
  const BLAMISH_OIL = ItemIdentifiers.BLAMISH_OIL;
  const HARRALANDER_UNF = ItemIdentifiers.HARRALANDER_POTION_UNF_;
  const FISHING_ROD = ItemIdentifiers.FISHING_ROD;
  const OILY_ROD = ItemIdentifiers.OILY_FISHING_ROD;
  const KEYRING = ItemIdentifiers.GRIPS_KEYRING;
  const CANDLESTICK = ItemIdentifiers.PETES_CANDLESTICK;
  const ID_PAPERS = ItemIdentifiers.ID_PAPERS;

  const START_HOOK = "quest:heroes-quest:start";
  /** "handing-in-the-items-speaking-to-achietties" completes with this action. */
  const COMPLETE_ACTION_ID = "AVQOM4";
  /** Gerrant's "Here is the slime" receive action. */
  const SLIME_ACTION_ID = "PTUCAO";

  let quest;

  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const hasAllProofs = (player) =>
    has(player, FIRE_FEATHER) && has(player, COOKED_LAVA_EEL) && has(player, ARMBAND);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I proved myself worthy of the Heroes' Guild.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "Speak to <col=800000>Achietties</col> outside the Heroes' Guild in Burthorpe.",
      ];
    }
    return [
      "Achietties requires three proofs:",
      `${has(player, FIRE_FEATHER) ? "<str>" : ""}An Entranan firebird feather${has(player, FIRE_FEATHER) ? "</str>" : ""}`,
      `${has(player, COOKED_LAVA_EEL) ? "<str>" : ""}A cooked lava eel${has(player, COOKED_LAVA_EEL) ? "</str>" : ""}`,
      `${stage === STAGE_PHOENIX_ARMBAND || stage >= STAGE_BLACK_ARMBAND || has(player, ARMBAND) ? "<str>" : ""}A master thief's armband${stage === STAGE_PHOENIX_ARMBAND || stage >= STAGE_BLACK_ARMBAND || has(player, ARMBAND) ? "</str>" : ""}`,
      "Work with your Shield of Arrav gang contacts in Brimhaven.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.ATTACK, 3075);
    skills.addExperiences(Skill.DEFENCE, 3075);
    skills.addExperiences(Skill.STRENGTH, 3075);
    skills.addExperiences(Skill.HITPOINTS, 3075);
    skills.addExperiences(Skill.RANGED, 2075);
    skills.addExperiences(Skill.FISHING, 2725);
    skills.addExperiences(Skill.COOKING, 2825);
    skills.addExperiences(Skill.WOODCUTTING, 1575);
    skills.addExperiences(Skill.FIREMAKING, 1575);
    skills.addExperiences(Skill.SMITHING, 2275);
    skills.addExperiences(Skill.MINING, 2575);
    skills.addExperiences(Skill.HERBLORE, 1325);
  }

  function achiettiesVariant(player) {
    if (hasAllProofs(player)) return "handing-in-the-items-speaking-to-achietties";
    if (has(player, RAW_LAVA_EEL) && !has(player, COOKED_LAVA_EEL)) {
      return "handing-in-the-items-trying-to-hand-in-an-uncooked-lava-eel";
    }
    return "the-greatest-heroes-of-the-land-talking-to-achietties-or-trying-to-enter-the-guild-again-without-the-three-items";
  }

  function stravenVariant(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_STARTED) return "master-thieves-armband-phoenix-gang-talking-to-straven";
    if (stage === STAGE_PHOENIX_GRIP && has(player, CANDLESTICK)) {
      take(player, CANDLESTICK);
      if (!has(player, ARMBAND)) give(player, ARMBAND);
      quest.setStage(player, STAGE_PHOENIX_ARMBAND);
      return "master-thieves-armband-phoenix-gang-handing-in-pete-s-candlestick";
    }
    if (stage === STAGE_PHOENIX_GRIP) {
      return "master-thieves-armband-phoenix-gang-attempting-to-hand-in-pete-s-candlestick-if-you-ve-obtained-it-too-early";
    }
    if (stage >= STAGE_PHOENIX_ARMBAND && !has(player, ARMBAND)) {
      return "master-thieves-armband-phoenix-gang-talking-to-straven-after-the-quest-without-having-a-master-thief-armband";
    }
    return "master-thieves-armband-phoenix-gang-talking-to-straven-again";
  }

  function katrineVariant(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_BLACK_CANDLESTICK && has(player, CANDLESTICK)) {
      take(player, CANDLESTICK);
      if (!has(player, ARMBAND)) give(player, ARMBAND);
      quest.setStage(player, STAGE_BLACK_ARMBAND);
      return "master-thieves-armband-black-arm-gang-handing-in-pete-s-candlestick";
    }
    if (stage === STAGE_BLACK_CANDLESTICK) {
      return "master-thieves-armband-black-arm-gang-attempting-to-hand-in-pete-s-candlestick-if-you-ve-obtained-it-too-early";
    }
    return "master-thieves-armband-black-arm-gang-katrine-s-request";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (ACHIETTIES_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return null; // no post-quest transcript (GAP)
      if (stage >= STAGE_STARTED) return achiettiesVariant(player);
      return "the-greatest-heroes-of-the-land-talking-to-achietties-or-trying-to-enter-the-guild";
    }
    if (npcId === STRAVEN_NPC_ID) return stravenVariant(player);
    if (npcId === KATRINE_NPC_ID) return katrineVariant(player);
    if (npcId === ALFONSE_NPC_ID) {
      return stage === STAGE_PHOENIX_STRAVEN
        ? "master-thieves-armband-phoenix-gang-talking-to-alfonse"
        : "master-thieves-armband-phoenix-gang-trying-to-go-into-the-kitchen-early";
    }
    if (npcId === CHARLIE_NPC_ID) {
      return stage === STAGE_PHOENIX_ALFONSE
        ? "master-thieves-armband-phoenix-gang-talking-to-charlie"
        : null;
    }
    if (npcId === GARV_NPC_ID) {
      return stage === STAGE_BLACK_PAPERS
        ? "master-thieves-armband-black-arm-gang-infiltration"
        : "master-thieves-armband-phoenix-gang-talking-to-garv";
    }
    if (npcId === GRUBOR_NPC_ID) {
      if (stage === STAGE_BLACK_KATRINE) return "master-thieves-armband-black-arm-gang-talking-to-grubor";
      if (stage >= STAGE_BLACK_HQ && stage < STAGE_COMPLETE) {
        return "master-thieves-armband-black-arm-gang-talking-to-grubor-again";
      }
      return "master-thieves-armband-phoenix-gang-trying-to-enter-grubor-s-house";
    }
    if (npcId === TROBERT_NPC_ID) {
      if (stage === STAGE_BLACK_HQ || (stage === STAGE_BLACK_PAPERS && !has(player, ID_PAPERS))) {
        return "master-thieves-armband-black-arm-gang-trobert-s-plan";
      }
      if (stage === STAGE_BLACK_PAPERS) {
        return "master-thieves-armband-black-arm-gang-talking-to-trobert-again";
      }
      return null;
    }
    if (npcId === GRIP_NPC_ID) {
      if (stage === STAGE_BLACK_MANSION) return "master-thieves-armband-black-arm-gang-reporting-in";
      if (stage >= STAGE_BLACK_GRIP && stage < STAGE_COMPLETE) {
        return "master-thieves-armband-black-arm-gang-when-searching-through-his-drinks-cabinet";
      }
      return null;
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("skill levels are lower than the quest requirements")) return false;
    if (value.includes("full inventory")) return false;
    void player;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!ACHIETTIES_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (stepId === SLIME_ACTION_ID && npcId === GERRANT_NPC_ID) {
      if (!has(player, BLAMISH_SLIME)) {
        give(player, BLAMISH_SLIME);
        player.sendMessage("Gerrant gives you a jar of blamish snail slime.");
      }
      return;
    }
    if (!ACHIETTIES_IDS.has(npcId) || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player)) return;
    if (!hasAllProofs(player)) return;
    take(player, FIRE_FEATHER);
    take(player, COOKED_LAVA_EEL);
    take(player, ARMBAND);
    quest.complete(player);
  }

  /** Gerrant is not indexed for this page; replay the lava-eel conversation. */
  function handleGerrant(event) {
    const { player, npcId } = event;
    if (npcId !== GERRANT_NPC_ID) return;
    if (quest.getStage(player) < STAGE_STARTED) return;
    event.handled = true;
    const variant =
      has(player, BLAMISH_SLIME) || has(player, BLAMISH_OIL) || has(player, OILY_ROD)
        ? "cooked-lava-eel-talking-to-gerrant-again-with-blamish-snail-slime-blamish-oil-or-an-oily-fishing-rod"
        : "cooked-lava-eel-talking-to-gerrant";
    startTranscript(api, player, npcId, PAGE, variant);
  }

  /** Blamish slime + unfinished harralander potion -> blamish oil. */
  function handleSlimeOnPotion(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(BLAMISH_SLIME) || !ids.includes(HARRALANDER_UNF)) return;
    const { player } = event;
    take(player, BLAMISH_SLIME);
    take(player, HARRALANDER_UNF);
    give(player, BLAMISH_OIL);
    player.sendMessage("You mix the slime into your potion.");
    event.handled = true;
  }

  /** Blamish oil + fishing rod -> oily fishing rod. */
  function handleOilOnRod(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(BLAMISH_OIL) || !ids.includes(FISHING_ROD)) return;
    const { player } = event;
    take(player, BLAMISH_OIL);
    take(player, FISHING_ROD);
    give(player, OILY_ROD);
    player.sendMessage("You rub the oil into the fishing rod.");
    event.handled = true;
  }

  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    const { npcId } = event;
    if (!player) return;
    if (npcId === ICE_QUEEN_NPC_ID) {
      if (quest.getStage(player) >= STAGE_STARTED && !has(player, ICE_GLOVES)) {
        give(player, ICE_GLOVES);
        player.sendMessage("You take the Queen of Ice's gloves.");
      }
      return;
    }
    if (npcId === FIREBIRD_NPC_ID) {
      if (quest.getStage(player) >= STAGE_STARTED && !has(player, FIRE_FEATHER)) {
        give(player, FIRE_FEATHER);
        player.sendMessage("The firebird's feather is cool enough to take.");
      }
      return;
    }
    if (npcId === GRIP_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage !== STAGE_PHOENIX_CHARLIE && stage !== STAGE_BLACK_GRIP) return;
      if (!has(player, KEYRING)) give(player, KEYRING);
      if (stage === STAGE_PHOENIX_CHARLIE) quest.setStage(player, STAGE_PHOENIX_GRIP);
    }
  }

  /** The candlestick chest opens with Grip's keyring. */
  function handleChestItem(event) {
    if (!CANDLESTICK_CHEST_IDS.includes(event.objectId) || event.itemId !== KEYRING) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage !== STAGE_PHOENIX_GRIP && stage !== STAGE_BLACK_GRIP) return;
    if (!has(player, CANDLESTICK)) give(player, CANDLESTICK);
    player.sendMessage("You unlock the chest and take Scarface Pete's candlestick.");
    if (stage === STAGE_BLACK_GRIP) quest.setStage(player, STAGE_BLACK_CANDLESTICK);
    event.handled = true;
  }

  /** Cook a raw lava eel (the eel itself is obtained elsewhere). */
  function handleItemAction(event) {
    if (event.itemId !== RAW_LAVA_EEL) return;
    if (!/cook/i.test(String(event.option ?? ""))) return;
    const { player } = event;
    if (player.getSkillManager().getCurrentLevel(Skill.COOKING) < 53) return;
    take(player, RAW_LAVA_EEL);
    give(player, COOKED_LAVA_EEL);
    player.getSkillManager().addExperiences(Skill.COOKING, 140);
    player.sendMessage("You cook the lava eel.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "heroes_quest",
    name: "Heroes' Quest",
    varpId: VARP_HEROES_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.ATTACK.getIndex(), amount: 3075, label: "Attack" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 3075, label: "Defence" },
      { skillId: Skill.STRENGTH.getIndex(), amount: 3075, label: "Strength" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 3075, label: "Hitpoints" },
      { skillId: Skill.RANGED.getIndex(), amount: 2075, label: "Ranged" },
      { skillId: Skill.FISHING.getIndex(), amount: 2725, label: "Fishing" },
      { skillId: Skill.COOKING.getIndex(), amount: 2825, label: "Cooking" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 1575, label: "Woodcutting" },
      { skillId: Skill.FIREMAKING.getIndex(), amount: 1575, label: "Firemaking" },
      { skillId: Skill.SMITHING.getIndex(), amount: 2275, label: "Smithing" },
      { skillId: Skill.MINING.getIndex(), amount: 2575, label: "Mining" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 1325, label: "Herblore" },
    ],
    rewardItemId: ARMBAND,
    rewardItemLabel: "A master thief's armband",
    otherRewards: ["Access to the Heroes' Guild", "Access to the Fountain of Heroes"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handleGerrant);
  api.onItemOnItem(handleSlimeOnPotion);
  api.onItemOnItem(handleOilOnRod);
  api.onNpcDeath(handleNpcDeath);
  api.onItemOnObject(handleChestItem, { noted: false });
  api.onItemAction(handleItemAction);
  api.onPlayerLogin(handleLogin);
};
