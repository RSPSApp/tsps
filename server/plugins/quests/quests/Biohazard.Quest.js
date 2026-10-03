/**
 * Biohazard (members).
 *
 * The words come from the "Biohazard" transcript page. Elena, Jerico, Omart,
 * Kilron, King Lathas, the Chemist, Julie, Guidor, the three couriers, Nurse
 * Sarah and the mourners are all indexed, so this plugin selects the variant by
 * stage, answers the prose conditions and completes the quest through the
 * transcript's own action on King Lathas.
 *
 * Stages (varp 68): 1 started, 2 spoken to Jerico, 3 used bird feed, 4 released
 * pigeons, 5 climbed the wall, 6 poisoned the stew, 7 found the distillator,
 * 10 given the distillator, 12 spoken to the chemist, 14 found Guidor's secret,
 * 15 reported to Elena, 16 complete.
 *
 * Gaps: the gas-mask/gown gates, the bird-feed throw, the pigeon release, the
 * rotten-apple stew, the distillator crate, the Varrock guard search and the
 * courier vials are not wired to objects/items here; the transcript still plays
 * by stage, so those world edits and the vial-smuggling inventory moves are
 * missing. The three-courier errand varp (69) and the training-dummy varp (70)
 * are unused.
 */
module.exports = function registerBiohazardQuest(api) {
  const { Skill, Equipment, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const ELENA_NPC_IDS = new Set([
    NpcIdentifiers.ELENA, // 1102
    NpcIdentifiers.ELENA_2, // 4257
    NpcIdentifiers.ELENA_3,
    NpcIdentifiers.ELENA_4,
    NpcIdentifiers.ELENA_5,
    NpcIdentifiers.ELENA_6,
    NpcIdentifiers.ELENA_7,
    NpcIdentifiers.ELENA_8,
    NpcIdentifiers.ELENA_9,
    NpcIdentifiers.ELENA_10,
    NpcIdentifiers.ELENA_11,
  ]);
  const JERICO_NPC_ID = NpcIdentifiers.JERICO; // 1145
  const OMART_NPC_IDS = new Set([
    NpcIdentifiers.OMART,
    NpcIdentifiers.OMART_2,
    NpcIdentifiers.OMART_3,
    NpcIdentifiers.OMART_4,
  ]);
  const KILRON_NPC_IDS = new Set([
    NpcIdentifiers.KILRON,
    NpcIdentifiers.KILRON_2,
    NpcIdentifiers.KILRON_4,
  ]);
  const KING_LATHAS_NPC_IDS = new Set([
    NpcIdentifiers.KING_LATHAS,
    NpcIdentifiers.KING_LATHAS_2,
    NpcIdentifiers.KING_LATHAS_3,
    NpcIdentifiers.KING_LATHAS_4,
  ]);
  const CHEMIST_NPC_ID = NpcIdentifiers.CHEMIST; // 1146
  const JULIE_NPC_ID = NpcIdentifiers.JULIE; // 1109
  const GUIDOR_NPC_ID = NpcIdentifiers.GUIDOR; // 1110
  const NURSE_SARAH_NPC_ID = NpcIdentifiers.NURSE_SARAH; // 1152
  const COURIER_NPC_IDS = new Set([
    NpcIdentifiers.DA_VINCI,
    NpcIdentifiers.DA_VINCI_2,
    NpcIdentifiers.CHANCY,
    NpcIdentifiers.CHANCY_2,
    NpcIdentifiers.HOPS,
    NpcIdentifiers.HOPS_2,
  ]);
  const MOURNER_NPC_IDS = new Set([
    NpcIdentifiers.MOURNER_9,
    NpcIdentifiers.MOURNER_10,
    NpcIdentifiers.MOURNER_11,
    NpcIdentifiers.MOURNER_12,
    NpcIdentifiers.MOURNER_13,
    NpcIdentifiers.MOURNER_15,
    NpcIdentifiers.MOURNER_16,
  ]);

  const VARP_BIOHAZARD = 68;

  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_TO_JERICO = 2;
  const STAGE_USED_BIRD_FEED = 3;
  const STAGE_RELEASED_PIGEONS = 4;
  const STAGE_CLIMBED_LADDER = 5;
  const STAGE_POISONED_STEW = 6;
  const STAGE_FOUND_DISTILLATOR = 7;
  const STAGE_GIVEN_DISTILLATOR = 10;
  const STAGE_SPOKEN_TO_CHEMIST = 12;
  const STAGE_FOUND_SECRET = 14;
  const STAGE_REPORTED_TO_ELENA = 15;
  const STAGE_COMPLETE = 16;

  const DISTILLATOR_ITEM_ID = ItemIdentifiers.DISTILLATOR;
  const BIRD_FEED_ITEM_ID = ItemIdentifiers.BIRD_FEED;
  const MOURNER_KEY_ITEM_ID = ItemIdentifiers.KEY_2;
  const MEDICAL_GOWN_ITEM_ID = ItemIdentifiers.MEDICAL_GOWN;
  const GAS_MASK_ITEM_ID = ItemIdentifiers.GAS_MASK;
  const PLAGUE_SAMPLE_ITEM_ID = ItemIdentifiers.PLAGUE_SAMPLE;
  const TOUCH_PAPER_ITEM_ID = ItemIdentifiers.TOUCH_PAPER;
  const ETHENEA_ITEM_ID = ItemIdentifiers.ETHENEA;
  const LIQUID_HONEY_ITEM_ID = ItemIdentifiers.LIQUID_HONEY;
  const SULPHURIC_BROLINE_ITEM_ID = ItemIdentifiers.SULPHURIC_BROLINE;

  const START_HOOK = "quest:biohazard:start";
  const COMPLETE_ACTION_ID = "vxKtyO";

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAllVials = (player) =>
    held(player, ETHENEA_ITEM_ID) &&
    held(player, LIQUID_HONEY_ITEM_ID) &&
    held(player, SULPHURIC_BROLINE_ITEM_ID);
  const hasAllItems = (player) =>
    hasAllVials(player) && held(player, TOUCH_PAPER_ITEM_ID) && held(player, PLAGUE_SAMPLE_ITEM_ID);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I uncovered the Ardougne plague hoax.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_REPORTED_TO_ELENA) {
      return ["Elena told me to report the conspiracy to <col=800000>King Lathas</col>."];
    }
    if (stage >= STAGE_FOUND_SECRET) {
      return ["Guidor proved there is no plague.", "I should tell <col=800000>Elena</col> immediately."];
    }
    if (stage >= STAGE_SPOKEN_TO_CHEMIST) {
      return [
        "The three couriers can smuggle Elena's reagents to Varrock.",
        "I must collect them at the <col=800000>Dancing Donkey Inn</col> and see Guidor.",
      ];
    }
    if (stage >= STAGE_GIVEN_DISTILLATOR) {
      return ["Take Elena's plague sample to the <col=800000>Chemist</col> in Rimmington."];
    }
    if (stage >= STAGE_FOUND_DISTILLATOR) {
      return ["I found Elena's distillator and should return it to her."];
    }
    if (stage >= STAGE_POISONED_STEW) {
      return [
        "The mourners are ill. I need a <col=800000>medical gown</col>",
        "and must search their upstairs crates for the distillator.",
      ];
    }
    if (stage >= STAGE_CLIMBED_LADDER) {
      return ["I crossed into West Ardougne.", "A rotten apple might spoil the mourners' stew."];
    }
    if (stage >= STAGE_RELEASED_PIGEONS) {
      return ["The watchtower guards are distracted. Speak to <col=800000>Omart</col> now."];
    }
    if (stage >= STAGE_USED_BIRD_FEED) {
      return ["Release Jerico's <col=800000>pigeons</col> beside the watchtower."];
    }
    if (stage >= STAGE_SPOKEN_TO_JERICO) {
      return ["Use <col=800000>bird feed</col> and pigeons to distract the watchtower."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Speak to <col=800000>Jerico</col> near the East Ardougne chapel."];
    }
    return ["Speak to <col=800000>Elena</col> after completing Plague City."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 1250);
  }

  function elenaVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) return "return-to-ardougne-talking-to-elena-after-finishing-the-quest";
    if (stage === STAGE_REPORTED_TO_ELENA) {
      return "return-to-ardougne-talking-to-elena-after-talking-to-guidor-talking-to-elena-again-before-talking-to-the-king";
    }
    if (stage === STAGE_FOUND_SECRET) {
      quest.setStage(player, STAGE_REPORTED_TO_ELENA);
      return "return-to-ardougne-talking-to-elena-after-talking-to-guidor";
    }
    if (stage >= STAGE_SPOKEN_TO_CHEMIST) {
      return "delivering-the-samples-talking-to-elena-again-before-visiting-the-chemist";
    }
    if (stage >= STAGE_FOUND_DISTILLATOR) {
      if (held(player, DISTILLATOR_ITEM_ID)) {
        player.getInventory().deleteNumber(DISTILLATOR_ITEM_ID, 1);
        quest.setStage(player, STAGE_GIVEN_DISTILLATOR);
        return "delivering-the-samples-talking-to-elena-with-the-distillator";
      }
      return "infiltrating-the-mourner-hq-talking-to-elena-without-the-distillator";
    }
    if (stage >= STAGE_STARTED) {
      return "infiltrating-the-mourner-hq-talking-to-elena-without-the-distillator";
    }
    return "getting-started-talking-to-elena";
  }

  function jericoVariant(stage) {
    if (stage >= STAGE_CLIMBED_LADDER) return "infiltrating-the-mourner-hq-talking-to-jerico-after-entering-west-ardougne";
    if (stage >= STAGE_RELEASED_PIGEONS) return "getting-started-talking-to-jerico-after-freeing-the-birds";
    if (stage >= STAGE_USED_BIRD_FEED) return "getting-started-talking-to-jerico-after-talking-to-omart";
    if (stage >= STAGE_SPOKEN_TO_JERICO) return "getting-started-talking-to-jerico-again";
    return "getting-started-talking-to-jerico";
  }

  function omartVariant(stage) {
    if (stage >= STAGE_GIVEN_DISTILLATOR) return "delivering-the-samples-talking-to-omart-after-returning-the-distillator";
    if (stage >= STAGE_CLIMBED_LADDER) return "getting-started-talking-to-omart-after-entering-west-ardougne";
    if (stage >= STAGE_RELEASED_PIGEONS) return "getting-started-talking-to-omart-after-freeing-the-birds";
    if (stage >= STAGE_USED_BIRD_FEED) return "getting-started-talking-to-omart-talking-to-omart-again";
    return "getting-started-talking-to-omart";
  }

  function kingLathasVariant(stage) {
    // Underground Pass and Regicide continue Lathas's storyline after Biohazard;
    // once Biohazard is finished, defer so their selectors can answer.
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_REPORTED_TO_ELENA) {
      return "return-to-ardougne-talking-to-king-lathas-after-talking-to-elena-about-the-plague";
    }
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (ELENA_NPC_IDS.has(npcId)) return elenaVariant(stage, player);
    if (npcId === JERICO_NPC_ID) {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_TO_JERICO);
      return jericoVariant(stage);
    }
    if (OMART_NPC_IDS.has(npcId)) {
      if (stage === STAGE_SPOKEN_TO_JERICO) quest.setStage(player, STAGE_USED_BIRD_FEED);
      if (stage === STAGE_RELEASED_PIGEONS) quest.setStage(player, STAGE_CLIMBED_LADDER);
      return omartVariant(stage);
    }
    if (KILRON_NPC_IDS.has(npcId)) {
      if (stage < STAGE_CLIMBED_LADDER) return null;
      return "infiltrating-the-mourner-hq-talking-to-kilron";
    }
    if (KING_LATHAS_NPC_IDS.has(npcId)) return kingLathasVariant(stage);
    if (npcId === CHEMIST_NPC_ID) {
      // Regicide reuses the Rimmington chemist for bomb-making; let it own him
      // once that quest has started.
      if ((Number(player.getAttribute("quest.regicide.stage")) || 0) >= 1) return null;
      if (stage === STAGE_GIVEN_DISTILLATOR) {
        quest.setStage(player, STAGE_SPOKEN_TO_CHEMIST);
        return "visiting-the-chemist-house-in-rimmington-talking-to-chemist";
      }
      return "visiting-the-chemist-house-in-rimmington-talking-to-the-chemist-again";
    }
    if (npcId === JULIE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "return-to-ardougne-talking-to-julie-after-finishing-the-quest";
      if (stage >= STAGE_FOUND_SECRET) return "visiting-south-east-varrock-talking-to-julie-after-talking-to-guido";
      if (stage >= STAGE_SPOKEN_TO_CHEMIST) return "visiting-south-east-varrock-talking-to-julie-after-talking-to-the-chemist";
      return "visiting-south-east-varrock-talking-to-julie-before-talking-to-the-chemist";
    }
    if (npcId === GUIDOR_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "return-to-ardougne-talking-to-guidor-after-finishing-the-quest";
      if (stage >= STAGE_FOUND_SECRET) return "visiting-south-east-varrock-talking-to-guidor-again";
      if (stage < STAGE_SPOKEN_TO_CHEMIST) return null;
      quest.setStage(player, STAGE_FOUND_SECRET);
      return "visiting-south-east-varrock-talking-to-guidor";
    }
    if (npcId === NURSE_SARAH_NPC_ID) return "infiltrating-the-mourner-hq-talking-to-nurse-sarah";
    if (COURIER_NPC_IDS.has(npcId)) {
      return stage >= STAGE_SPOKEN_TO_CHEMIST
        ? "visiting-the-chemist-house-in-rimmington-talking-to-chancy-in-rimmington-after-talking-to-the-chemist"
        : "visiting-the-chemist-house-in-rimmington-talking-to-chancy-in-rimmington-before-talking-to-the-chemist";
    }
    if (MOURNER_NPC_IDS.has(npcId)) {
      if (stage < STAGE_CLIMBED_LADDER) return null;
      if (stage === STAGE_POISONED_STEW) {
        return "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters-after-poisoning-the-stew";
      }
      return "infiltrating-the-mourner-hq-talking-to-mourner-outside-mourner-headquarters";
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    const wearingGasMask = player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === GAS_MASK_ITEM_ID;
    if (value.includes("no inventory space")) return inventory.isFull();
    if (value.includes("already has bird feed")) return held(player, BIRD_FEED_ITEM_ID);
    if (value.includes("is not wearing a gas mask")) return !wearingGasMask;
    if (value.includes("not yet poisoned the stew or already has a medical gown")) {
      return quest.getStage(player) !== STAGE_POISONED_STEW || held(player, MEDICAL_GOWN_ITEM_ID);
    }
    if (value.includes("has the key")) return held(player, MOURNER_KEY_ITEM_ID);
    if (value.includes("does not have the key")) return !held(player, MOURNER_KEY_ITEM_ID);
    if (value.includes("already has the distillator")) return held(player, DISTILLATOR_ITEM_ID);
    if (value.includes("has all the items")) return hasAllItems(player);
    if (value.includes("missing items")) return !hasAllItems(player);
    if (value.includes("still has the touch paper")) return held(player, TOUCH_PAPER_ITEM_ID);
    if (value.includes("does not have the touch paper")) return !held(player, TOUCH_PAPER_ITEM_ID);
    if (value.includes("does not have ethenea")) return !held(player, ETHENEA_ITEM_ID);
    if (value.includes("has ethenea")) return held(player, ETHENEA_ITEM_ID);
    if (value.includes("does not have liquid honey")) return !held(player, LIQUID_HONEY_ITEM_ID);
    if (value.includes("has liquid honey")) return held(player, LIQUID_HONEY_ITEM_ID);
    if (value.includes("does not have sulphuric broline")) return !held(player, SULPHURIC_BROLINE_ITEM_ID);
    if (value.includes("has sulphuric broline")) return held(player, SULPHURIC_BROLINE_ITEM_ID);
    if (value.includes("does not have all three vials")) return !hasAllVials(player);
    if (value.includes("does not have touch paper")) return !held(player, TOUCH_PAPER_ITEM_ID);
    if (value.includes("does not have the plague sample")) return !held(player, PLAGUE_SAMPLE_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!ELENA_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (!KING_LATHAS_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) >= STAGE_REPORTED_TO_ELENA && !quest.isComplete(player)) {
      quest.complete(player);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "biohazard",
    name: "Biohazard",
    varpId: VARP_BIOHAZARD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1250, label: "Thieving" }],
    otherRewards: [
      "Access to the Combat Training Camp",
      "Free passage through West Ardougne's gate",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
