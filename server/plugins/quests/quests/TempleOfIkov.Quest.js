/**
 * Temple of Ikov (members).
 *
 * The words come from the "Temple of Ikov" transcript page; this plugin supplies
 * the variant selector for Lucien, Winelda and the Guardians of Armadyl (all
 * indexed), the start hook, the prose-condition answers, the limpwurt-root
 * teleport, the Fire Warrior kill and the staff hand-in that completes the
 * quest.
 *
 * Stages (varp 26): 10 started, 50 crossed the lava, 60 killed the Fire Warrior,
 * 70 carrying the Staff of Armadyl, 80 complete.
 *
 * The map's spawn ids for Lucien (3443/3444) differ from NpcIdentifiers.LUCIEN
 * (13525), so both are matched. Gaps (no dump/index support): the ice-arrow
 * chest, trap lever, gate locks and boots-of-lightness weight check are not
 * simulated; the pendant and staff are granted by the plugin. The two endings
 * share the Lucien transcript completion action.
 */
module.exports = function registerTempleOfIkovQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const LUCIEN_NPC_IDS = new Set([
    NpcIdentifiers.LUCIEN,
    NpcIdentifiers.LUCIEN_2,
    NpcIdentifiers.LUCIEN_3,
    NpcIdentifiers.LUCIEN_4,
    NpcIdentifiers.LUCIEN_5,
    NpcIdentifiers.LUCIEN_6,
    3443,
    3444,
  ]);
  const WINELDA_NPC_ID = NpcIdentifiers.WINELDA;
  const GUARDIAN_NPC_IDS = new Set([
    NpcIdentifiers.GUARDIAN_OF_ARMADYL,
    NpcIdentifiers.GUARDIAN_OF_ARMADYL_2,
  ]);
  const FIRE_WARRIOR_NPC_ID = NpcIdentifiers.FIRE_WARRIOR_OF_LESARKUS;

  const VARP_TEMPLE_OF_IKOV = 26;
  const STAGE_STARTED = 10;
  const STAGE_CROSSED_LAVA = 50;
  const STAGE_FIRE_WARRIOR_KILLED = 60;
  const STAGE_HAS_STAFF = 70;
  const STAGE_COMPLETE = 80;

  const PENDANT_OF_LUCIEN_ITEM_ID = ItemIdentifiers.PENDANT_OF_LUCIEN;
  const ARMADYL_PENDANT_ITEM_ID = ItemIdentifiers.ARMADYL_PENDANT;
  const STAFF_OF_ARMADYL_ITEM_ID = ItemIdentifiers.STAFF_OF_ARMADYL;
  const LIMPWURT_ROOT_ITEM_ID = ItemIdentifiers.LIMPWURT_ROOT;
  const LIMPWURT_REQUIRED = 20;

  const START_HOOK = "quest:temple-of-ikov:start";
  /** Winelda teleports the player across the lava (with or without the roots). */
  const WINELDA_TELEPORT_ACTION_IDS = new Set(["UB9hSI", "7xhwuW"]);
  /** The guardian attacks when Lucien's follower takes the staff. */
  const TAKE_STAFF_ACTION_ID = "zJVI_k";
  /** Lucien's two quest-complete endings. */
  const COMPLETE_ACTION_IDS = new Set(["f8loKo", "rgR_39"]);

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const limpwurtCount = (player) => player.getInventory().getAmount(LIMPWURT_ROOT_ITEM_ID);
  const thievingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.THIEVING);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I recovered the Staff of Armadyl.</str>",
        "<str>I decided the fate of Lucien and the guardians.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HAS_STAFF) {
      return [
        "I found the Guardians of Armadyl.",
        "I must decide who receives the <col=800000>Staff of Armadyl</col>.",
      ];
    }
    if (stage >= STAGE_FIRE_WARRIOR_KILLED) {
      return [
        "I defeated the Fire Warrior of Lesarkus.",
        "I should search the Temple of Ikov for the guardians.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Lucien gave me his pendant.",
        "I need <col=800000>20 limpwurt roots</col> and must find Winelda.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Lucien</col>",
      "at the Flying Horse Inn in East Ardougne.",
      "It requires 42 Thieving.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.RANGED, 10500);
    player.getSkillManager().addExperiences(Skill.FLETCHING, 8000);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (LUCIEN_NPC_IDS.has(npcId)) {
      if (stage === 0) return "starting-out-talking-to-lucien";
      if (stage < STAGE_COMPLETE) return "starting-out-talking-to-lucien-again";
      return "finishing-up-talking-to-lucien-near-varrock";
    }
    if (npcId === WINELDA_NPC_ID) {
      if (stage < STAGE_STARTED) return "inside-the-dungeon-talking-to-winelda-again";
      if (stage < STAGE_CROSSED_LAVA) return "inside-the-dungeon-talking-to-winelda";
      return "inside-the-dungeon-talking-to-winelda-after-giving-the-limpwurts";
    }
    if (GUARDIAN_NPC_IDS.has(npcId)) {
      if (stage < STAGE_FIRE_WARRIOR_KILLED) {
        return "inside-the-dungeon-talking-to-a-guardian-of-armadyl-while-not-wearing-the-pendant-of-lucien";
      }
      if (stage < STAGE_HAS_STAFF) {
        return "inside-the-dungeon-taking-the-staff-of-armadyl-while-helping-lucien";
      }
      return "inside-the-dungeon-talking-to-a-guardian-of-armadyl-while-carrying-the-staff-of-armadyl";
    }
    if (npcId === FIRE_WARRIOR_NPC_ID) {
      return "inside-the-dungeon-talking-to-the-fire-warrior-of-lesarkus";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("inventory is full")) return false;
    if (value.includes("lost the pendant")) return !held(player, PENDANT_OF_LUCIEN_ITEM_ID);
    if (value.includes("still has the pendant")) return held(player, PENDANT_OF_LUCIEN_ITEM_ID);
    if (value.includes("with 42 thieving")) return thievingLevel(player) >= 42;
    if (value.includes("without 42 thieving")) return thievingLevel(player) < 42;
    if (value.includes("chest has arrows")) return false;
    if (value.includes("chest is empty")) return true;
    if (value.includes("no limpwurt roots")) return limpwurtCount(player) === 0;
    if (value.includes("1-19 limpwurt roots")) {
      const count = limpwurtCount(player);
      return count >= 1 && count <= 19;
    }
    if (value.includes("20 limpwurt roots")) return limpwurtCount(player) >= LIMPWURT_REQUIRED;
    if (value.includes("lost the armadyl pendant")) return !held(player, ARMADYL_PENDANT_ITEM_ID);
    if (value.includes("still has the armadyl pendant")) return held(player, ARMADYL_PENDANT_ITEM_ID);
    if (value.includes("does not have the staff")) return !held(player, STAFF_OF_ARMADYL_ITEM_ID);
    if (value.includes("has the staff")) return held(player, STAFF_OF_ARMADYL_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!LUCIEN_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      quest.setStage(player, STAGE_STARTED);
      if (!held(player, PENDANT_OF_LUCIEN_ITEM_ID)) {
        player.getInventory().adds(PENDANT_OF_LUCIEN_ITEM_ID, 1);
      }
    }
  }

  function takeLimpwurts(player) {
    let remaining = LIMPWURT_REQUIRED;
    while (remaining > 0 && player.getInventory().getAmount(LIMPWURT_ROOT_ITEM_ID) > 0) {
      player.getInventory().deleteNumber(LIMPWURT_ROOT_ITEM_ID, 1);
      remaining--;
    }
  }

  function handleAction({ player, npcId, stepId }) {
    if (npcId === WINELDA_NPC_ID && WINELDA_TELEPORT_ACTION_IDS.has(stepId)) {
      if (quest.getStage(player) < STAGE_CROSSED_LAVA) {
        takeLimpwurts(player);
        quest.setStage(player, STAGE_CROSSED_LAVA);
      }
      return;
    }
    if (GUARDIAN_NPC_IDS.has(npcId) && stepId === TAKE_STAFF_ACTION_ID) {
      if (quest.getStage(player) < STAGE_HAS_STAFF) {
        if (!held(player, ARMADYL_PENDANT_ITEM_ID)) {
          player.getInventory().adds(ARMADYL_PENDANT_ITEM_ID, 1);
        }
        player.getInventory().adds(STAFF_OF_ARMADYL_ITEM_ID, 1);
        player.sendMessage("You take the Staff of Armadyl.");
        quest.setStage(player, STAGE_HAS_STAFF);
      }
      return;
    }
    if (LUCIEN_NPC_IDS.has(npcId) && COMPLETE_ACTION_IDS.has(stepId)) {
      if (!quest.isComplete(player)) {
        if (held(player, STAFF_OF_ARMADYL_ITEM_ID)) {
          player.getInventory().deleteNumber(STAFF_OF_ARMADYL_ITEM_ID, 1);
        }
        quest.complete(player);
      }
    }
  }

  /** Killing the Fire Warrior advances the quest. */
  function handleFireWarriorDeath({ player, npcId }) {
    if (npcId !== FIRE_WARRIOR_NPC_ID) return;
    if (quest.getStage(player) >= STAGE_FIRE_WARRIOR_KILLED) return;
    if (quest.getStage(player) >= STAGE_CROSSED_LAVA) {
      quest.setStage(player, STAGE_FIRE_WARRIOR_KILLED);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "temple_of_ikov",
    name: "Temple of Ikov",
    varpId: VARP_TEMPLE_OF_IKOV,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.RANGED.getIndex(), amount: 10500, label: "Ranged" },
      { skillId: Skill.FLETCHING.getIndex(), amount: 8000, label: "Fletching" },
    ],
    rewardItemId: ItemIdentifiers.BOOTS_OF_LIGHTNESS,
    rewardItemLabel: "Boots of lightness",
    otherRewards: ["Armies of Gielinor side unlocked"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcDeath(handleFireWarriorDeath);
  api.onPlayerLogin(handleLogin);
};
