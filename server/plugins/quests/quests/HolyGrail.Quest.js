/**
 * Holy Grail (members).
 *
 * Every speaking NPC is indexed on the "Holy Grail" transcript page, so the ask
 * King Arthur -> Merlin -> High Priest chain, Galahad's napkin, the Fisher King
 * and Sir Percival's whistle hand-over are all transcript-driven. This plugin
 * selects the variant by stage, answers the page's prose conditions, gives the
 * quest items on the dump's receive actions and completes on King Arthur's
 * "Congratulations! Quest complete!" action.
 *
 * Stages (varp 5): 2 started, 3 spoken to Merlin, 4 spoken to the High Priest,
 * 7 failed the Black Knight Titan, 8 finding Percival, 9 gave Percival the
 * whistle, 10 complete. (There is no "quest:holy-grail:start" hook in the dump;
 * the quest starts on King Arthur's "Yes." choice.)
 *
 * Gaps (no dump support): the Fisher Realm travel, the magic-whistle spawning in
 * Draynor Manor and the golden-boots/feather direction puzzle are not modelled.
 * Galahad's napkin receive also hands over a magic whistle (the reference gets
 * them from the manor), the Black Knight Titan regeneration is not wired to the
 * excalibur check, and reaching stage 9 grants the Holy Grail so King Arthur can
 * finish. The Grail bell and grail-maiden cutscene are not replayed.
 */
module.exports = function registerHolyGrailQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, Equipment, Location } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const KING_ARTHUR_NPC_IDS = new Set([
    NpcIdentifiers.KING_ARTHUR,
    NpcIdentifiers.ARTHUR,
    NpcIdentifiers.KING_ARTHUR_2,
    NpcIdentifiers.KING_ARTHUR_3,
  ]);
  const MERLIN_NPC_IDS = new Set([NpcIdentifiers.MERLIN, NpcIdentifiers.MERLIN_2]);
  const HIGH_PRIEST_NPC_IDS = new Set([
    NpcIdentifiers.HIGH_PRIEST,
    NpcIdentifiers.CRONE,
    NpcIdentifiers.HIGH_PRIEST_3,
  ]);
  const SIR_PERCIVAL_NPC_IDS = new Set([NpcIdentifiers.SIR_PERCIVAL, NpcIdentifiers.KING_PERCIVAL]);
  const GALAHAD_NPC_ID = NpcIdentifiers.GALAHAD;
  const FISHERMAN_NPC_ID = NpcIdentifiers.FISHERMAN_2;
  const FISHER_KING_NPC_ID = NpcIdentifiers.THE_FISHER_KING;
  const GRAIL_MAIDEN_NPC_ID = NpcIdentifiers.GRAIL_MAIDEN;

  const KNIGHT_VARIANTS = new Map([
    [NpcIdentifiers.SIR_LANCELOT, "asking-the-other-knights-talking-to-sir-lancelot"],
    [NpcIdentifiers.SIR_GAWAIN, "asking-the-other-knights-talking-to-sir-gawain"],
    [NpcIdentifiers.SIR_KAY, "asking-the-other-knights-talking-to-sir-kay"],
    [NpcIdentifiers.SIR_BEDIVERE, "asking-the-other-knights-talking-to-sir-bedivere"],
    [NpcIdentifiers.SIR_PELLEAS, "asking-the-other-knights-talking-to-sir-pellas"],
    [NpcIdentifiers.SIR_LUCAN, "asking-the-other-knights-talking-to-sir-lucan"],
    [NpcIdentifiers.SIR_PELLEAS_3, "asking-the-other-knights-talking-to-sir-pellas"],
    [NpcIdentifiers.SIR_GAWAIN_3, "asking-the-other-knights-talking-to-sir-gawain"],
    [NpcIdentifiers.SIR_KAY_3, "asking-the-other-knights-talking-to-sir-kay"],
  ]);
  const PEASANT_NPC_IDS = new Set([NpcIdentifiers.PEASANT, NpcIdentifiers.PEASANT_2]);

  const VARP_HOLY_GRAIL = 5;
  const STAGE_STARTED = 2;
  const STAGE_SPOKEN_MERLIN = 3;
  const STAGE_SPOKEN_CRONE = 4;
  const STAGE_FAILED_TITAN = 7;
  const STAGE_FINDING_PERCIVAL = 8;
  const STAGE_GIVEN_WHISTLE = 9;
  const STAGE_COMPLETE = 10;

  const NAPKIN_ITEM_ID = ItemIdentifiers.HOLY_TABLE_NAPKIN;
  const MAGIC_WHISTLE_ITEM_ID = ItemIdentifiers.MAGIC_WHISTLE;
  const GRAIL_BELL_ITEM_ID = ItemIdentifiers.GRAIL_BELL;
  const MAGIC_FEATHER_ITEM_ID = ItemIdentifiers.MAGIC_GOLD_FEATHER;
  const HOLY_GRAIL_ITEM_ID = ItemIdentifiers.HOLY_GRAIL;
  const EXCALIBUR_ITEM_ID = ItemIdentifiers.EXCALIBUR;

  const BRIMHAVEN_TILE = { x: 2741, y: 3235, z: 0 };

  const NAPKIN_ACTION_ID = "IWEKeT";
  const FEATHER_ACTION_ID = "QFSQAR";
  const WHISTLE_ACTION_IDS = new Set(["xUC5cW", "RwrmfE"]);
  const COMPLETE_ACTION_ID = "MtgzHp";
  const TELEPORT_ACTION_ID = "jbdCvp";

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const ownsGrail = (player) => hasItem(player, HOLY_GRAIL_ITEM_ID);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I returned the Holy Grail to Camelot.</str>",
        "<str>Percival took his father's place in the Fisher Realm.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_GIVEN_WHISTLE) {
      return ["Percival has returned. I can revisit the restored realm", "and claim the Holy Grail."];
    }
    if (stage >= STAGE_FINDING_PERCIVAL) {
      return ["King Arthur's feather points to sacks in Goblin Village,", "where Percival is trapped."];
    }
    if (stage >= STAGE_SPOKEN_CRONE) {
      return ["Galahad can provide a Fisher Realm keepsake.", "Then I need to find Sir Percival."];
    }
    if (stage >= STAGE_SPOKEN_MERLIN) {
      return ["<str>King Arthur sent me to recover the Holy Grail.</str>", "I should speak to the High Priest on <col=800000>Entrana</col>."];
    }
    if (stage >= STAGE_STARTED) {
      return ["<str>King Arthur sent me to recover the Holy Grail.</str>", "I should speak to <col=800000>Merlin</col> in his Camelot workshop."];
    }
    return ["After Merlin's Crystal, I can ask <col=800000>King Arthur</col> for another quest."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 11000);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 15300);
  }

  function arthurVariant(stage, player) {
    if (stage >= STAGE_GIVEN_WHISTLE && ownsGrail(player)) return "talking-to-king-arthur-2";
    if (stage >= STAGE_FINDING_PERCIVAL) return "talking-to-king-arthur";
    if (stage >= STAGE_SPOKEN_MERLIN && stage < STAGE_SPOKEN_CRONE) {
      return "talking-to-merlin-updating-king-arthur";
    }
    if (stage >= STAGE_STARTED) return "starting-off-subsequent-dialogue-with-king-arthur";
    return "starting-off";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (KING_ARTHUR_NPC_IDS.has(npcId)) return arthurVariant(stage, player);
    if (MERLIN_NPC_IDS.has(npcId)) {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_MERLIN);
      return "talking-to-merlin";
    }
    if (HIGH_PRIEST_NPC_IDS.has(npcId)) {
      if (stage === STAGE_SPOKEN_MERLIN) quest.setStage(player, STAGE_SPOKEN_CRONE);
      return "talking-to-the-high-priest-of-entrana";
    }
    if (npcId === GALAHAD_NPC_ID) return "talking-to-sir-galahad";
    if (npcId === FISHERMAN_NPC_ID) return "talking-to-the-fisherman";
    if (npcId === FISHER_KING_NPC_ID) {
      if (stage === STAGE_SPOKEN_CRONE || stage === STAGE_FAILED_TITAN) {
        quest.setStage(player, STAGE_FINDING_PERCIVAL);
      }
      return "talking-to-the-fisher-king";
    }
    if (npcId === GRAIL_MAIDEN_NPC_ID) return "ringing-the-grail-bell-talking-to-a-grail-maiden";
    if (SIR_PERCIVAL_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "talking-to-sir-percival-talking-to-sir-percival-at-the-fisher-realm";
      if (stage >= STAGE_GIVEN_WHISTLE) return "talking-to-sir-percival-subsequent-dialogue-with-sir-percival";
      if (stage >= STAGE_FINDING_PERCIVAL) return "talking-to-sir-percival";
      return null;
    }
    if (KNIGHT_VARIANTS.has(npcId)) return KNIGHT_VARIANTS.get(npcId);
    if (PEASANT_NPC_IDS.has(npcId)) return "talking-to-the-fisherman-peasant";
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const skills = player.getSkillManager();
    const combat = typeof skills.getCombatLevel === "function" ? skills.getCombatLevel() : 999;
    const equipment = player.getEquipment();
    const wielded = equipment.get(Equipment.WEAPON_SLOT)?.getId?.();
    if (value.includes("combat level is less than 50")) return combat < 50;
    if (value.includes("combat level is more than 50")) return combat > 50;
    if (value.includes("talked to the high priest of entrana first")) return quest.getStage(player) >= STAGE_SPOKEN_CRONE;
    if (value.includes("without the excalibur")) return wielded !== EXCALIBUR_ITEM_ID;
    if (value.includes("uses the excalibur")) return wielded === EXCALIBUR_ITEM_ID;
    if (value.includes("does not have the whistle")) return !hasItem(player, MAGIC_WHISTLE_ITEM_ID);
    if (value.includes("has the magic whistle")) return hasItem(player, MAGIC_WHISTLE_ITEM_ID);
    if (value.includes("loses the feather")) return !hasItem(player, MAGIC_FEATHER_ITEM_ID);
    if (value.includes("does not have enough inventory space")) return player.getInventory().isFull();
    if (value.includes("has one free inventory space")) return !player.getInventory().isFull();
    if (value.includes("talks to him again")) return false;
    return null;
  }

  /** King Arthur's "Yes." starts the quest (the dump carries no start hook). */
  function handleChoice({ player, npcId, option }) {
    if (!KING_ARTHUR_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0) return;
    if (String(option ?? "").replace(/[^a-z]/gi, "").toLowerCase() !== "yes") return;
    quest.setStage(player, STAGE_STARTED);
  }

  function giveOnce(player, itemId, label) {
    if (hasItem(player, itemId) || player.getInventory().isFull()) return;
    player.getInventory().adds(itemId, 1);
    if (label) player.sendMessage(label);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    const stage = quest.getStage(player);
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player) && stage >= STAGE_GIVEN_WHISTLE) quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === NAPKIN_ACTION_ID) {
      giveOnce(player, NAPKIN_ITEM_ID);
      // The reference gets the whistles from Draynor Manor with the napkin.
      giveOnce(player, MAGIC_WHISTLE_ITEM_ID);
      event.handled = true;
      return;
    }
    if (stepId === FEATHER_ACTION_ID) {
      giveOnce(player, MAGIC_FEATHER_ITEM_ID);
      event.handled = true;
      return;
    }
    if (WHISTLE_ACTION_IDS.has(stepId)) {
      if (hasItem(player, MAGIC_WHISTLE_ITEM_ID)) {
        player.getInventory().deleteNumber(MAGIC_WHISTLE_ITEM_ID, 1);
      }
      if (!ownsGrail(player) && !player.getInventory().isFull()) {
        player.getInventory().adds(HOLY_GRAIL_ITEM_ID, 1);
      }
      if (stage < STAGE_GIVEN_WHISTLE) quest.setStage(player, STAGE_GIVEN_WHISTLE);
      event.handled = true;
      return;
    }
    if (stepId === TELEPORT_ACTION_ID) {
      player.moveTo(new Location(BRIMHAVEN_TILE.x, BRIMHAVEN_TILE.y, BRIMHAVEN_TILE.z));
      event.handled = true;
    }
  }

  quest = registerQuest(api, {
    key: "holy_grail",
    name: "Holy Grail",
    varpId: VARP_HOLY_GRAIL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 11000, label: "Prayer" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 15300, label: "Defence" },
    ],
    rewardItemId: HOLY_GRAIL_ITEM_ID,
    rewardItemLabel: "The Holy Grail",
    otherRewards: ["Access to the Fisher Realm"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
};
