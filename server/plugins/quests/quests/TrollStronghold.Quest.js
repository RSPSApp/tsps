/**
 * Troll Stronghold (members).
 *
 * The words come from the "Troll Stronghold" transcript page; this plugin
 * supplies the variant selector for Denulth, Tenzing, Dunstan, Eadgar, Godric,
 * Dad, Twig and Berry (all indexed), the start hook, the prose-condition
 * answers, the prison-key drops and the Godric release that completes the
 * quest.
 *
 * Stages (varp 317): 10 started, 20 Dad killed, 30 prison key looted, 40 both
 * cell keys, 45 Godric freed, 50 complete.
 *
 * Requires Death Plateau. Gaps (no dump/index support): the rock climb and
 * Dad's arena fight are not simulated (his death advances the stage), the
 * Troll Generals are not transcript-indexed (the prison key is granted on any
 * general kill), and Dunstan's law talisman action ends the quest instead of
 * returning to Denulth. Twig/Berry pockets are handled from their transcript
 * message ids.
 */
module.exports = function registerTrollStrongholdQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const DENULTH_NPC_IDS = new Set([NpcIdentifiers.DENULTH, NpcIdentifiers.DENULTH_2]);
  const TENZING_NPC_ID = NpcIdentifiers.TENZING;
  const DUNSTAN_NPC_ID = NpcIdentifiers.DUNSTAN;
  const EADGAR_NPC_ID = NpcIdentifiers.EADGAR;
  const GODRIC_NPC_ID = NpcIdentifiers.GODRIC;
  const DAD_NPC_ID = NpcIdentifiers.DAD;
  const TWIG_NPC_IDS = new Set([NpcIdentifiers.TWIG_2, NpcIdentifiers.TWIG_3]);
  const BERRY_NPC_IDS = new Set([NpcIdentifiers.BERRY, NpcIdentifiers.BERRY_2]);
  const TROLL_GENERAL_NPC_IDS = new Set([
    NpcIdentifiers.TROLL_GENERAL,
    NpcIdentifiers.TROLL_GENERAL_2,
    NpcIdentifiers.TROLL_GENERAL_3,
  ]);

  const VARP_TROLL_STRONGHOLD = 317;
  const STAGE_STARTED = 10;
  const STAGE_DAD_KILLED = 20;
  const STAGE_HAS_PRISON_KEY = 30;
  const STAGE_HAS_CELL_KEYS = 40;
  const STAGE_GODRIC_FREED = 45;
  const STAGE_COMPLETE = 50;

  const PRISON_KEY_ITEM_ID = ItemIdentifiers.PRISON_KEY;
  const CELL_KEY_1_ITEM_ID = ItemIdentifiers.CELL_KEY_1;
  const CELL_KEY_2_ITEM_ID = ItemIdentifiers.CELL_KEY_2;
  const CLIMBING_BOOTS_ITEM_ID = ItemIdentifiers.CLIMBING_BOOTS;
  const SPIKED_BOOTS_ITEM_ID = ItemIdentifiers.SPIKED_BOOTS;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;

  const START_HOOK = "quest:troll-stronghold:start";
  /** Twig / Berry pocket messages that yield the cell keys. */
  const GIVE_TWIG_KEY_MESSAGE_ID = "UsQIS6";
  const GIVE_BERRY_KEY_MESSAGE_ID = "kUE-LP";
  /** Dunstan's family heirloom ("a Law talisman") ends the quest. */
  const COMPLETE_ACTION_ID = "GT_EpY";

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const hasBothCellKeys = (player) =>
    held(player, CELL_KEY_1_ITEM_ID) && held(player, CELL_KEY_2_ITEM_ID);
  const agilityLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.AGILITY);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I entered the Troll Stronghold.</str>",
        "<str>I rescued Godric from the troll prison.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_GODRIC_FREED) {
      return [
        "I have both cell keys.",
        "I should release <col=800000>Godric</col> and return to Dunstan.",
      ];
    }
    if (stage >= STAGE_HAS_PRISON_KEY) {
      return [
        "I defeated a Troll General and found the prison key.",
        "I need the two cell keys carried by <col=800000>Twig and Berry</col>.",
      ];
    }
    if (stage >= STAGE_DAD_KILLED) {
      return [
        "I defeated Dad and may enter the stronghold.",
        "I should defeat a <col=800000>Troll General</col> for the prison key.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Dunstan's son Godric is held in the Troll Stronghold.",
        "I must climb the mountain and defeat <col=800000>Dad</col>.",
      ];
    }
    return [
      "I must complete <col=800000>Death Plateau</col> first.",
      "It also requires 15 Agility.",
      "Speak to <col=800000>Denulth</col> after meeting the requirements.",
    ];
  }

  function grantReward(_player) {
    // Reward item (Law talisman) is granted by registerQuest.
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (DENULTH_NPC_IDS.has(npcId)) {
      if (stage === 0) return "getting-started-talking-to-denulth";
      if (stage < STAGE_STARTED) return "getting-started-talking-to-denulth-after-starting-the-quest";
      if (stage < STAGE_GODRIC_FREED) {
        return "entering-the-prison-talking-to-denulth-again-before-freeing-the-prisoners";
      }
      return "after-freeing-the-prisoners-talking-to-denulth";
    }
    if (npcId === TENZING_NPC_ID) return "getting-started-talking-to-tenzig";
    if (npcId === DUNSTAN_NPC_ID) {
      if (stage >= STAGE_GODRIC_FREED) return "after-freeing-the-prisoners-talking-to-dunstan";
      return "getting-started-talking-to-dunstan";
    }
    if (npcId === DAD_NPC_ID) {
      if (stage >= STAGE_DAD_KILLED) return "getting-started-after-dad-has-been-defeated";
      return "getting-started-entering-dad-s-arena";
    }
    if (TWIG_NPC_IDS.has(npcId)) return "entering-the-prison-retrieving-the-keys-from-twig";
    if (BERRY_NPC_IDS.has(npcId)) return "entering-the-prison-retrieving-the-keys-from-berry";
    if (npcId === GODRIC_NPC_ID || npcId === EADGAR_NPC_ID) {
      if (stage >= STAGE_HAS_PRISON_KEY && stage < STAGE_GODRIC_FREED && hasBothCellKeys(player)) {
        player.getInventory().deleteNumber(PRISON_KEY_ITEM_ID, 1);
        player.getInventory().deleteNumber(CELL_KEY_1_ITEM_ID, 1);
        player.getInventory().deleteNumber(CELL_KEY_2_ITEM_ID, 1);
        player.sendMessage("You unlock the cells and free Godric and Eadgar.");
        quest.setStage(player, STAGE_GODRIC_FREED);
      }
      return "entering-the-prison-freeing-eadgar-and-godric";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    if (value.includes("combat level is lower than 50")) {
      return player.getSkillManager().getCurrentLevel(Skill.HITPOINTS) < 50;
    }
    if (value.includes("has 12 gp")) return has(COINS_ITEM_ID, 12);
    if (value.includes("does not have enough money")) return !has(COINS_ITEM_ID, 12);
    if (value.includes("does not have level 15 agility")) return agilityLevel(player) < 15;
    if (value.includes("does not have the climbing boots equipped")) {
      return agilityLevel(player) >= 15 && !has(CLIMBING_BOOTS_ITEM_ID) && !has(SPIKED_BOOTS_ITEM_ID);
    }
    if (value.includes("succeeds in climbing up the rocks")) return agilityLevel(player) >= 15;
    if (value.includes("slips whilst climbing up the rocks")) return agilityLevel(player) < 15;
    if (value.includes("attempts to attack dad again")) return true;
    if (value.includes("attempts to talk to dad")) return true;
    if (value.includes("chooses to pickpocket twig") || value.includes("chooses to pickpocket berry")) {
      return true;
    }
    if (value.includes("succeeds in pickpocketing twig")) return true;
    if (value.includes("succeeds in pickpocketing berry")) return true;
    if (value.includes("fails to pickpocket twig") || value.includes("fails to pickpocket berry")) {
      return false;
    }
    if (value.includes("pickpockets twig again") || value.includes("pickpockets berry again")) {
      return false;
    }
    if (value.includes("attempts to open the door without a key")) {
      return !has(PRISON_KEY_ITEM_ID) && !hasBothCellKeys(player);
    }
    if (value.includes("uses cell key 1 or 2 on either of the doors")) {
      return has(CELL_KEY_1_ITEM_ID) || has(CELL_KEY_2_ITEM_ID);
    }
    if (value.includes("opens eadgar's cell with cell key 2")) return has(CELL_KEY_2_ITEM_ID);
    if (value.includes("opens godric's cell with cell key 1")) return has(CELL_KEY_1_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!DENULTH_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Dad's death opens the stronghold; a Troll General drops the prison key. */
  function handleNpcDeath({ player, npcId }) {
    if (npcId === DAD_NPC_ID && quest.getStage(player) >= STAGE_STARTED) {
      if (quest.getStage(player) < STAGE_DAD_KILLED) quest.setStage(player, STAGE_DAD_KILLED);
      return;
    }
    if (TROLL_GENERAL_NPC_IDS.has(npcId) && quest.getStage(player) >= STAGE_DAD_KILLED) {
      if (quest.getStage(player) < STAGE_HAS_PRISON_KEY) {
        player.getInventory().adds(PRISON_KEY_ITEM_ID, 1);
        quest.setStage(player, STAGE_HAS_PRISON_KEY);
      }
    }
  }

  function handleAction({ player, npcId, stepId }) {
    if (npcId === DUNSTAN_NPC_ID && stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_GODRIC_FREED && !quest.isComplete(player)) {
        quest.complete(player);
      }
      return;
    }
    if (stepId === GIVE_TWIG_KEY_MESSAGE_ID) {
      if (!held(player, CELL_KEY_1_ITEM_ID)) player.getInventory().adds(CELL_KEY_1_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_HAS_PRISON_KEY) quest.setStage(player, STAGE_HAS_PRISON_KEY);
      return;
    }
    if (stepId === GIVE_BERRY_KEY_MESSAGE_ID) {
      if (!held(player, CELL_KEY_2_ITEM_ID)) player.getInventory().adds(CELL_KEY_2_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_HAS_PRISON_KEY) quest.setStage(player, STAGE_HAS_PRISON_KEY);
      if (
        quest.getStage(player) < STAGE_HAS_CELL_KEYS &&
        held(player, PRISON_KEY_ITEM_ID) &&
        hasBothCellKeys(player)
      ) {
        quest.setStage(player, STAGE_HAS_CELL_KEYS);
      }
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "troll_stronghold",
    name: "Troll Stronghold",
    varpId: VARP_TROLL_STRONGHOLD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    rewardItemId: ItemIdentifiers.LAW_TALISMAN,
    rewardItemLabel: "Law talisman",
    otherRewards: ["Access to the Troll Stronghold"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
