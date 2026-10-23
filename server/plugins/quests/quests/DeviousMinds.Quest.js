/**
 * Devious Minds (members).
 *
 * The words come from the "Devious Minds" transcript page and the
 * "Monk (Devious Minds)" requirements page; this plugin supplies the variant
 * selectors for the Paterdomus monk, the Entrana High Priest and Sir Tiffy
 * Cashien, the prose-condition answers, the mithril-2h -> slender-blade ->
 * bow-sword crafting chain, the orb/pouch smuggling, the Entrana cutscene and
 * the completion hand-in.
 *
 * Durable stages (player attribute `quest.devious_minds.stage`):
 *   0 not started, 1 started, 2 slender blade ground, 3 bow-sword strung,
 *   4 orb received, 5 orb in pouch, 6 pouch placed (cutscene),
 *   7 High Priest heard the surprise, 8 dead monk searched,
 *   9 High Priest told to report to Sir Tiffy, 10 complete.
 *
 * The client wire is varbit 1465 "devious_main" (varp 622 "devious_base"
 * bits 0-7). Its values are not 1:1 with the durable stages: Quest Helper's
 * loadSteps keys are 0/10/20/30/40/50/60/70 and cache quest DB row 28
 * (table 0, column 19) completes at 80. stageWire() maps the durable stage
 * onto those values, keeping existing save values untouched.
 *
 * The same varp carries "devious_altar" varbit 1466 (Entrana altar multi-loc
 * 10638 -> 409 normal / 10639 pouch / 10640 scorched) and "devious_monk"
 * varbit 1467 (Paterdomus spawn 6222 -> 4563 alive; the dead-monk spawn
 * 6223 -> 4564).
 *
 * Requirements per the OSRS Wiki: Wanted!, Troll Stronghold and Doric's Quest,
 * plus 50 Runecraft and 50 Fletching to start. 65 Smithing (boostable) may be
 * missing when starting - the transcript only warns - and 50 Fletching
 * (boostable) is needed to string the blade.
 *
 * Source: OSRS Wiki "Devious Minds", "Devious Minds/Quick guide",
 * "Monk (Devious Minds)" and "Colossal pouch (Devious Minds)". Rewards: 1 Quest
 * point, 5,000 Fletching, 5,000 Runecraft and 6,500 Smithing experience.
 *
 * Gaps: the colossal-pouch insertion is a transcript gap, so the large-pouch
 * wording is reused and the wiki's "The colossal pouch was so strong..."
 * survival line is sent after the cutscene; the cutscene plays as its
 * transcript lines in the chatbox (no camera pan) and the altar's orb state
 * (varbit 1466) becomes the cache's scorched transform (2) as the last
 * cutscene line ends; Sir Tiffy's
 * "Something else." choice falls through to the transcript's unavailable
 * marker; a degraded large pouch (5513) does not hold the orb but has no
 * transcript line; the missing-level messages used when the player lacks 65
 * Smithing at the whetstone or 50 Fletching at the stringing are standard
 * server wording, as the transcript has no branch for them; the dead monk
 * keeps its single search variant after the quest.
 */
module.exports = function registerDeviousMindsQuest(api) {
  const { ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Devious Minds";
  const MONK_PAGE = "Monk (Devious Minds)"; // requirements gate page (flat steps)

  const MONK_NPC_ID = NpcIdentifiers.MONK_14; // 4563, resolved spawn 6222
  const HIGH_PRIEST_NPC_ID = NpcIdentifiers.HIGH_PRIEST; // 4062
  const MONK_NPC_IDS = new Set([MONK_NPC_ID]);
  const HIGH_PRIEST_NPC_IDS = new Set([
    HIGH_PRIEST_NPC_ID,
    NpcIdentifiers.HIGH_PRIEST_3, // 4565
  ]);
  const DEAD_MONK_NPC_ID = NpcIdentifiers.COL_00FFFF_DEAD_MONK_COL; // 4564, resolved spawn 6223
  const SIR_TIFFY_NPC_IDS = new Set([
    NpcIdentifiers.SIR_TIFFY_CASHIEN, // 4687
    NpcIdentifiers.SIR_TIFFY_CASHIEN_2, // 8045
    NpcIdentifiers.SIR_TIFFY_CASHIEN_3, // 8157
    NpcIdentifiers.SIR_TIFFY_CASHIEN_4, // 8165
    NpcIdentifiers.SIR_TIFFY_CASHIEN_5, // 8173
    NpcIdentifiers.SIR_TIFFY_CASHIEN_6, // 11021
  ]);

  const DORICS_WHETSTONE_OBJECT_ID = ObjectIdentifiers.DORICS_WHETSTONE; // 10641
  // Entrana's altar is a multi-loc with no cache name (varbit 1466 picks
  // 409/10639/10640), so it has no generated identifier (as FairyTale II notes
  // for FT1's grove wall).
  const ENTRANA_ALTAR_OBJECT_ID = 10638;

  const VARP_DEVIOUS_BASE = 622; // "devious_base"
  const VARBIT_DEVIOUS_MAIN = 1465; // "devious_main", varp 622 bits 0-7
  const ALTAR_VARBIT = 1466; // "devious_altar", varp 622 bits 22-23
  const MONK_VARBIT = 1467; // "devious_monk", varp 622 bits 27-28

  const MITHRIL_2H_SWORD_ITEM_IDS = new Set([
    ItemIdentifiers.MITHRIL_2H_SWORD, // 1315
    ItemIdentifiers.MITHRIL_2H_SWORD_2, // 1316
    ItemIdentifiers.MITHRIL_2H_SWORD_3, // 14749
  ]);
  // The bow string spool stores bow strings; using a spool itself on the blade
  // is not the transcript's "normal bow string" step, so it is left alone.
  const BOW_STRING_ITEM_IDS = new Set([
    ItemIdentifiers.BOW_STRING, // 1777
    ItemIdentifiers.BOW_STRING_2, // 1778
  ]);
  const SLENDER_BLADE_ITEM_ID = ItemIdentifiers.SLENDER_BLADE; // 6817
  const BOW_SWORD_ITEM_ID = ItemIdentifiers.BOW_SWORD; // 6818
  const ORB_ITEM_ID = ItemIdentifiers.ORB; // 6821
  const LARGE_POUCH_ITEM_ID = ItemIdentifiers.LARGE_POUCH; // 5512 (5513 is degraded)
  const ORB_POUCH_ITEM_ID = ItemIdentifiers.LARGE_POUCH_3; // 6819 (large pouch, Devious Minds)
  const COLOSSAL_POUCH_ITEM_IDS = new Set([
    ItemIdentifiers.COLOSSAL_POUCH, // 26784
    ItemIdentifiers.COLOSSAL_POUCH_3, // 26786
  ]);
  const COLOSSAL_ORB_POUCH_ITEM_ID = ItemIdentifiers.COLOSSAL_POUCH_5; // 26906
  const COLOSSAL_ORB_BASE_POUCH_ATTRIBUTE = "devious-minds:colossal-orb-base-pouch";
  const SMALL_POUCH_ITEM_ID = ItemIdentifiers.SMALL_POUCH; // 5509
  const MEDIUM_POUCH_ITEM_IDS = new Set([
    ItemIdentifiers.MEDIUM_POUCH, // 5510
    ItemIdentifiers.MEDIUM_POUCH_2, // 5511
  ]);
  const GIANT_POUCH_ITEM_IDS = new Set([
    ItemIdentifiers.GIANT_POUCH, // 5514
    ItemIdentifiers.GIANT_POUCH_2, // 5515
  ]);

  const STAGE_STARTED = 1;
  const STAGE_SLENDER_BLADE = 2;
  const STAGE_BOW_SWORD = 3;
  const STAGE_ORB_GIVEN = 4;
  const STAGE_ORB_IN_POUCH = 5;
  const STAGE_ALTAR = 6;
  const STAGE_PRIEST_TOLD = 7;
  const STAGE_DEAD_MONK = 8;
  const STAGE_RETURNED = 9;
  const STAGE_COMPLETE = 10;

  // Wire values for varbit 1465 (see the header). Quest Helper's keys are the
  // stage values below; 20 is the transient "bow-sword handed in" step, and
  // the cache's completion threshold is 80.
  const WIRE_STARTED = 10;
  const WIRE_BOW_SWORD_GIVEN = 20;
  const WIRE_ORB_GIVEN = 30;
  const WIRE_CUTSCENE = 40;
  const WIRE_PRIEST_TOLD = 50;
  const WIRE_DEAD_MONK = 60;
  const WIRE_RETURNED = 70;
  const WIRE_COMPLETE = 80;

  const ALTAR_POUCH = 1;
  const ALTAR_SCORCHED = 2;

  const SMITHING_LEVEL = 65;
  const RUNECRAFT_LEVEL = 50;
  const FLETCHING_LEVEL = 50;

  const START_HOOK = "quest:devious-minds:start";
  const MET_MONK_ATTRIBUTE = "devious-minds:met-monk";
  const BOW_SWORD_GIVEN_ATTRIBUTE = "devious-minds:bow-sword-given";

  // Variants on the "Devious Minds" page.
  const V_START = "starting-off-talking-to-the-monk";
  const V_MONK_AGAIN = "starting-off-talking-the-monk-again";
  const V_GRIND = "starting-off-using-the-whetstone";
  const V_STRING = "starting-off-stringing-the-slender-blade";
  const V_BRING_BOW_SWORD = "starting-off-bringing-the-monk-the-bow-sword";
  const V_AFTER_ORB = "starting-off-talking-the-monk-after-receiving-the-orb";
  const V_ORB_SMALL = "starting-off-putting-the-orb-in-a-pouch-small-pouch";
  const V_ORB_MEDIUM = "starting-off-putting-the-orb-in-a-pouch-medium-pouch";
  const V_ORB_LARGE = "starting-off-putting-the-orb-in-a-pouch-large-pouch";
  const V_ORB_GIANT = "starting-off-putting-the-orb-in-a-pouch-giant-pouch";
  const V_ORB_CHECK = "starting-off-putting-the-orb-in-a-pouch-checking-the-orb-filled-large-pouch";
  const V_ORB_EMPTY = "starting-off-putting-the-orb-in-a-pouch-emptying-the-orb-filled-large-pouch";
  const V_ORB_ON_ALTAR = "going-to-entrana-trying-to-place-the-orb-on-the-altar";
  const V_PLACE_POUCH = "going-to-entrana-placing-the-pouch-on-the-altar";
  const V_SURPRISE = "going-to-entrana-the-surprise";
  const V_PRIEST_AGAIN = "going-to-entrana-talking-to-the-high-priest-again";
  const V_FIND_DEAD_MONK = "investigating-the-surprise-finding-the-dead-monk";
  const V_RETURN_TO_PRIEST = "investigating-the-surprise-returning-to-the-high-priest-in-entrana";
  const V_TIFFY_REPORT = "wrapping-up-reporting-to-sir-tiffy";

  // Condition step ids (answers in answerCondition).
  const NOT_SPOKEN_CONDITION_ID = "5p0Y1-"; // has not spoken to the monk
  const SPOKEN_CONDITION_ID = "a9tUp0"; // has previously spoken to the monk
  const MISSING_SKILLS_CONDITION_ID = "GK16o9"; // lacks a quest skill requirement
  const HAS_ORB_CONDITION_ID = "6ambXW"; // still has the orb
  const LOST_ORB_CONDITION_ID = "rtLNjv"; // lost the orb
  const MEETS_REQUIREMENTS_CONDITION_ID = "qA2Npa"; // may start Devious Minds
  const MISSING_REQUIREMENTS_CONDITION_ID = "gtGd_w"; // may not start Devious Minds

  // Action/message step ids (effects in handleAction).
  const GRIND_DONE_ACTION_ID = "wcQlqp";
  const STRING_DONE_ACTION_ID = "Yfo5KF";
  const GIVE_BOW_SWORD_ACTION_ID = "5ln-VH";
  const RECEIVE_ORB_ACTION_ID = "Iv_XNp";
  const RECEIVE_ORB_AGAIN_ACTION_ID = "Kb5na-";
  const FIND_DEAD_MONK_ACTION_ID = "En9UIu";
  const COMPLETE_ACTION_ID = "WqZYOq";
  const CUTSCENE_ACTION_IDS = new Set([
    "gQKdJg",
    "tmHDxu",
    "hArNnO",
    "g4Sc4m",
    "GQqLKi",
    "169WUP", // last line: the cutscene ends
  ]);
  const CUTSCENE_END_ACTION_ID = "169WUP";

  let quest;

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function heldAny(player, itemIds) {
    for (const itemId of itemIds) if (held(player, itemId)) return true;
    return false;
  }

  function findHeld(player, itemIds) {
    for (const itemId of itemIds) if (held(player, itemId)) return itemId;
    return undefined;
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  /** Durable stage -> varbit 1465 value; existing 1..10 saves are preserved. */
  function stageWire(stage, player) {
    if (stage >= STAGE_COMPLETE) return WIRE_COMPLETE;
    if (stage >= STAGE_RETURNED) return WIRE_RETURNED;
    if (stage >= STAGE_DEAD_MONK) return WIRE_DEAD_MONK;
    if (stage >= STAGE_PRIEST_TOLD) return WIRE_PRIEST_TOLD;
    if (stage >= STAGE_ALTAR) return WIRE_CUTSCENE;
    if (stage >= STAGE_ORB_GIVEN) return WIRE_ORB_GIVEN;
    if (stage === STAGE_BOW_SWORD && Number(player?.getAttribute(BOW_SWORD_GIVEN_ATTRIBUTE)) > 0) {
      return WIRE_BOW_SWORD_GIVEN;
    }
    if (stage >= STAGE_STARTED) return WIRE_STARTED;
    return 0;
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsSkillRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.RUNECRAFTING) >= RUNECRAFT_LEVEL &&
      skills.getCurrentLevel(Skill.FLETCHING) >= FLETCHING_LEVEL
    );
  }

  /** The Monk (Devious Minds) page's "meets the requirements to start" check. */
  function meetsStartRequirements(player) {
    return (
      meetsSkillRequirements(player) &&
      isQuestComplete(player, "wanted") &&
      isQuestComplete(player, "troll_stronghold") &&
      isQuestComplete(player, "dorics_quest")
    );
  }

  /** The start variant's warning condition: any of the three quest skills missing. */
  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getCurrentLevel(Skill.SMITHING) < SMITHING_LEVEL ||
      skills.getMaxLevel(Skill.RUNECRAFTING) < RUNECRAFT_LEVEL ||
      skills.getCurrentLevel(Skill.FLETCHING) < FLETCHING_LEVEL
    );
  }

  function hasOrb(player) {
    return (
      held(player, ORB_ITEM_ID) ||
      held(player, ORB_POUCH_ITEM_ID) ||
      held(player, COLOSSAL_ORB_POUCH_ITEM_ID)
    );
  }

  function metMonk(player) {
    return Number(player.getAttribute(MET_MONK_ATTRIBUTE)) > 0;
  }

  function giveOrb(player) {
    if (held(player, ORB_ITEM_ID)) return true;
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need a free inventory slot to take the orb.");
      return false;
    }
    player.getInventory().adds(ORB_ITEM_ID, 1);
    return true;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped a monk outside the Paterdomus Temple by turning a</str>",
        "<str>mithril 2h sword into a bow-sword for him.</str>",
        "",
        "<str>I smuggled his orb onto Entrana in a pouch, but it was a</str>",
        "<str>teleport beacon for an assassin who stole the temple's relic.</str>",
        "",
        "<str>I reported the theft to Sir Tiffy Cashien in Falador Park.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURNED) {
      return [
        "<str>I placed the orb on the altar in Entrana's church and saw an</str>",
        "<str>assassin steal the temple's relic.</str>",
        "",
        "I should report the theft to <col=800000>Sir Tiffy Cashien</col>",
        "in <col=800000>Falador Park</col>.",
      ];
    }
    if (stage >= STAGE_DEAD_MONK) {
      return [
        "<str>I placed the orb on the altar in Entrana's church and saw an</str>",
        "<str>assassin steal the temple's relic.</str>",
        "",
        "I found the monk dead at <col=800000>Paterdomus</col>.",
        "I should tell the <col=800000>High Priest</col> on Entrana.",
      ];
    }
    if (stage >= STAGE_PRIEST_TOLD) {
      return [
        "<str>I placed the orb on the altar in Entrana's church and saw an</str>",
        "<str>assassin steal the temple's relic.</str>",
        "",
        "The <col=800000>High Priest</col> wants me to return to",
        "<col=800000>Paterdomus</col> and look for the 'monk'.",
      ];
    }
    if (stage >= STAGE_ALTAR) {
      return [
        "<str>I smuggled the monk's orb onto Entrana and placed it on the</str>",
        "<str>altar in the church.</str>",
        "",
        "I should speak to the <col=800000>High Priest</col>.",
      ];
    }
    if (stage >= STAGE_ORB_IN_POUCH) {
      return [
        "<str>The monk gave me a delicate orb to smuggle onto Entrana.</str>",
        "",
        "I have hidden the orb in my pouch. I should place it on the",
        "altar in <col=800000>Entrana's church</col>.",
      ];
    }
    if (stage >= STAGE_ORB_GIVEN) {
      return [
        "<str>I made the bow-sword and gave it to the monk outside the</str>",
        "<str>Paterdomus Temple.</str>",
        "",
        "He gave me a delicate <col=800000>orb</col> to smuggle onto",
        "<col=800000>Entrana</col>. I should hide the orb in a large",
        "<col=800000>pouch</col> before placing it on the altar.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "<str>I spoke to a monk outside the Paterdomus Temple and agreed to</str>",
        "<str>help him build a strange weapon.</str>",
        "",
      ];
      if (held(player, BOW_SWORD_ITEM_ID)) {
        lines.push("I have made the <col=800000>bow-sword</col>. I should take", "it to the monk.");
      } else if (held(player, SLENDER_BLADE_ITEM_ID)) {
        lines.push("I need to use a <col=800000>bow string</col> on the slender", "blade.");
      } else if (heldAny(player, MITHRIL_2H_SWORD_ITEM_IDS)) {
        lines.push(
          "I need to grind the <col=800000>mithril 2h sword</col> on",
          "Doric's <col=800000>whetstone</col>."
        );
      } else {
        lines.push(
          "I need a <col=800000>mithril 2h sword</col> and a",
          "<col=800000>bow string</col>, and to use Doric's whetstone."
        );
      }
      return lines;
    }
    return [
      "I can start this quest by talking to a <col=800000>monk</col> outside",
      "the <col=800000>Paterdomus Temple</col>, east of Varrock.",
      "",
      "I need 50 <col=800000>Runecraft</col> and 50 <col=800000>Fletching</col>",
      "and to have completed <col=800000>Wanted!</col>,",
      "<col=800000>Troll Stronghold</col> and <col=800000>Doric's Quest</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.FLETCHING, 5000);
    skills.addExperiences(Skill.RUNECRAFTING, 5000);
    skills.addExperiences(Skill.SMITHING, 6500);
  }

  /** Which transcript variant each quest NPC plays, by stage. */
  function selectVariant({ npcId, player }) {
    if (!player) return null;
    const stage = quest.getStage(player);
    if (MONK_NPC_IDS.has(npcId)) {
      if (stage === 0) {
        // The requirements gate lives in the Monk page's own conditions.
        return meetsStartRequirements(player) ? V_START : { page: MONK_PAGE };
      }
      if (stage < STAGE_ORB_GIVEN) {
        return held(player, BOW_SWORD_ITEM_ID) || Number(player.getAttribute(BOW_SWORD_GIVEN_ATTRIBUTE)) > 0
          ? V_BRING_BOW_SWORD
          : V_MONK_AGAIN;
      }
      return V_AFTER_ORB;
    }
    if (HIGH_PRIEST_NPC_IDS.has(npcId)) {
      if (stage === STAGE_ALTAR) {
        quest.setStage(player, STAGE_PRIEST_TOLD);
        return V_SURPRISE;
      }
      if (stage === STAGE_PRIEST_TOLD) return V_PRIEST_AGAIN;
      if (stage === STAGE_DEAD_MONK) {
        quest.setStage(player, STAGE_RETURNED);
        return V_RETURN_TO_PRIEST;
      }
      return null;
    }
    if (SIR_TIFFY_NPC_IDS.has(npcId) && stage === STAGE_RETURNED) {
      return V_TIFFY_REPORT;
    }
    return null;
  }

  /** Answers the page's prose conditions; also records that the monk was met. */
  function answerCondition({ npcId, player, stepId }) {
    if (!player || !MONK_NPC_IDS.has(npcId)) return null;
    if (stepId === NOT_SPOKEN_CONDITION_ID) {
      const met = metMonk(player);
      player.setAttribute(MET_MONK_ATTRIBUTE, 1);
      return !met;
    }
    if (stepId === SPOKEN_CONDITION_ID) {
      const met = metMonk(player);
      player.setAttribute(MET_MONK_ATTRIBUTE, 1);
      return met;
    }
    if (stepId === MISSING_SKILLS_CONDITION_ID) return missingSkillRequirements(player);
    if (stepId === HAS_ORB_CONDITION_ID) return hasOrb(player);
    if (stepId === LOST_ORB_CONDITION_ID) return !hasOrb(player);
    if (stepId === MEETS_REQUIREMENTS_CONDITION_ID) return meetsStartRequirements(player);
    if (stepId === MISSING_REQUIREMENTS_CONDITION_ID) {
      player.setAttribute(MET_MONK_ATTRIBUTE, 1);
      return !meetsStartRequirements(player);
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !MONK_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0 || !meetsStartRequirements(player)) return;
    player.setAttribute(MET_MONK_ATTRIBUTE, 1);
    quest.setStage(player, STAGE_STARTED);
  }

  /** The transcript's item hand-outs and stage directions, keyed by step id. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === GRIND_DONE_ACTION_ID) {
      if (!questActive(player)) return;
      const mithrilId = findHeld(player, MITHRIL_2H_SWORD_ITEM_IDS);
      if (mithrilId === undefined) return;
      player.getInventory().deleteNumber(mithrilId, 1);
      player.getInventory().adds(SLENDER_BLADE_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_SLENDER_BLADE) quest.setStage(player, STAGE_SLENDER_BLADE);
      return;
    }
    if (stepId === STRING_DONE_ACTION_ID) {
      if (!questActive(player)) return;
      const stringId = findHeld(player, BOW_STRING_ITEM_IDS);
      if (stringId === undefined || !held(player, SLENDER_BLADE_ITEM_ID)) return;
      player.getInventory().deleteNumber(stringId, 1);
      player.getInventory().deleteNumber(SLENDER_BLADE_ITEM_ID, 1);
      player.getInventory().adds(BOW_SWORD_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_BOW_SWORD) quest.setStage(player, STAGE_BOW_SWORD);
      return;
    }
    if (stepId === GIVE_BOW_SWORD_ACTION_ID) {
      if (!questActive(player) || !held(player, BOW_SWORD_ITEM_ID)) return;
      player.getInventory().deleteNumber(BOW_SWORD_ITEM_ID, 1);
      player.setAttribute(BOW_SWORD_GIVEN_ATTRIBUTE, 1);
      // Quest Helper key 20: the hand-in step, before the orb is received.
      player.getPacketSender().sendVarbit(VARBIT_DEVIOUS_MAIN, WIRE_BOW_SWORD_GIVEN);
      return;
    }
    if (stepId === RECEIVE_ORB_ACTION_ID) {
      if (!questActive(player) || quest.getStage(player) >= STAGE_ORB_GIVEN) return;
      if (!giveOrb(player)) return;
      quest.setStage(player, STAGE_ORB_GIVEN);
      return;
    }
    if (stepId === RECEIVE_ORB_AGAIN_ACTION_ID) {
      if (!questActive(player)) return;
      if (!giveOrb(player)) return;
      // A lost pouch reopens the orb-in-pouch leg; without this reset the
      // item-on-item handler refuses the replacement orb and the quest locks.
      if (quest.getStage(player) === STAGE_ORB_IN_POUCH) quest.setStage(player, STAGE_ORB_GIVEN);
      return;
    }
    if (stepId === FIND_DEAD_MONK_ACTION_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_ALTAR && stage < STAGE_DEAD_MONK) quest.setStage(player, STAGE_DEAD_MONK);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (questActive(player) && quest.getStage(player) >= STAGE_RETURNED) quest.complete(player);
      return;
    }
    if (CUTSCENE_ACTION_IDS.has(stepId)) {
      event.handled = true;
      if (event.text) player.sendMessage(event.text);
      if (stepId === CUTSCENE_END_ACTION_ID) {
        player.getPacketSender().sendVarbit(ALTAR_VARBIT, ALTAR_SCORCHED);
      }
    }
  }

  /** Mithril 2h onto Doric's whetstone; the orb and pouches onto the altar. */
  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (objectId === DORICS_WHETSTONE_OBJECT_ID) {
      if (!MITHRIL_2H_SWORD_ITEM_IDS.has(itemId)) return;
      const stage = quest.getStage(player);
      if (stage < STAGE_STARTED || stage >= STAGE_ORB_GIVEN) return;
      event.handled = true;
      if (player.getSkillManager().getCurrentLevel(Skill.SMITHING) < SMITHING_LEVEL) {
        player.sendMessage("You need a Smithing level of 65 to grind this blade.");
        return;
      }
      startTranscript(api, player, MONK_NPC_ID, PAGE, V_GRIND);
      return;
    }
    if (objectId !== ENTRANA_ALTAR_OBJECT_ID) return;
    if (itemId === ORB_ITEM_ID) {
      if (!questActive(player)) return;
      event.handled = true;
      startTranscript(api, player, HIGH_PRIEST_NPC_ID, PAGE, V_ORB_ON_ALTAR);
      return;
    }
    if (itemId === ORB_POUCH_ITEM_ID || itemId === COLOSSAL_ORB_POUCH_ITEM_ID) {
      if (quest.getStage(player) !== STAGE_ORB_IN_POUCH) return;
      event.handled = true;
      const colossal = itemId === COLOSSAL_ORB_POUCH_ITEM_ID;
      // The large pouch is destroyed with the orb; the colossal pouch survives.
      if (!colossal) player.getInventory().deleteNumber(ORB_POUCH_ITEM_ID, 1);
      player.getPacketSender().sendVarbit(MONK_VARBIT, 1); // the monk is replaced by his corpse
      player.getPacketSender().sendVarbit(ALTAR_VARBIT, ALTAR_POUCH);
      quest.setStage(player, STAGE_ALTAR);
      startTranscript(api, player, HIGH_PRIEST_NPC_ID, PAGE, V_PLACE_POUCH);
      if (colossal) {
        player.sendMessage("The colossal pouch was so strong that it survived the blast from the glowing orb.");
      }
    }
  }

  /** Slender blade + bow string, and the orb into a pouch. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    const stringId = BOW_STRING_ITEM_IDS.has(usedItemId)
      ? usedItemId
      : BOW_STRING_ITEM_IDS.has(usedWithItemId)
        ? usedWithItemId
        : undefined;
    if (pair.has(SLENDER_BLADE_ITEM_ID) && stringId !== undefined) {
      if (!questActive(player)) return;
      event.handled = true;
      if (player.getSkillManager().getCurrentLevel(Skill.FLETCHING) < FLETCHING_LEVEL) {
        player.sendMessage("You need a Fletching level of 50 to string this blade.");
        return;
      }
      player.getInventory().deleteNumber(stringId, 1);
      player.getInventory().deleteNumber(SLENDER_BLADE_ITEM_ID, 1);
      player.getInventory().adds(BOW_SWORD_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_BOW_SWORD) quest.setStage(player, STAGE_BOW_SWORD);
      startTranscript(api, player, MONK_NPC_ID, PAGE, V_STRING);
      return;
    }
    if (!pair.has(ORB_ITEM_ID)) return;
    const pouchId = usedItemId === ORB_ITEM_ID ? usedWithItemId : usedItemId;
    if (quest.getStage(player) !== STAGE_ORB_GIVEN) return;
    event.handled = true;
    if (pouchId === SMALL_POUCH_ITEM_ID) {
      startTranscript(api, player, MONK_NPC_ID, PAGE, V_ORB_SMALL);
      return;
    }
    if (MEDIUM_POUCH_ITEM_IDS.has(pouchId)) {
      startTranscript(api, player, MONK_NPC_ID, PAGE, V_ORB_MEDIUM);
      return;
    }
    if (GIANT_POUCH_ITEM_IDS.has(pouchId)) {
      startTranscript(api, player, MONK_NPC_ID, PAGE, V_ORB_GIANT);
      return;
    }
    if (pouchId === LARGE_POUCH_ITEM_ID) {
      player.getInventory().deleteNumber(ORB_ITEM_ID, 1);
      player.getInventory().deleteNumber(LARGE_POUCH_ITEM_ID, 1);
      player.getInventory().adds(ORB_POUCH_ITEM_ID, 1);
      quest.setStage(player, STAGE_ORB_IN_POUCH);
      startTranscript(api, player, MONK_NPC_ID, PAGE, V_ORB_LARGE);
      return;
    }
    if (COLOSSAL_POUCH_ITEM_IDS.has(pouchId)) {
      player.getInventory().deleteNumber(ORB_ITEM_ID, 1);
      player.getInventory().deleteNumber(pouchId, 1);
      player.getInventory().adds(COLOSSAL_ORB_POUCH_ITEM_ID, 1);
      player.setAttribute(COLOSSAL_ORB_BASE_POUCH_ATTRIBUTE, pouchId);
      quest.setStage(player, STAGE_ORB_IN_POUCH);
      // The colossal-pouch variant is a transcript gap; the large-pouch words fit.
      player.sendMessage("You hide the orb in the pouch.");
      return;
    }
    event.handled = false;
  }

  /** Check/Empty on the orb-filled large pouch. */
  function handlePouchCheck(event) {
    if (event.itemId !== ORB_POUCH_ITEM_ID && event.itemId !== COLOSSAL_ORB_POUCH_ITEM_ID) return false;
    startTranscript(api, event.player, MONK_NPC_ID, PAGE, V_ORB_CHECK);
    return true;
  }

  function handlePouchEmpty(event) {
    const { player } = event;
    if (event.itemId !== ORB_POUCH_ITEM_ID && event.itemId !== COLOSSAL_ORB_POUCH_ITEM_ID) return false;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage("You need one free inventory slot to empty the pouch.");
      return true;
    }
    const isColossal = event.itemId === COLOSSAL_ORB_POUCH_ITEM_ID;
    const savedBasePouchId = Number(player.getAttribute(COLOSSAL_ORB_BASE_POUCH_ATTRIBUTE));
    const returnedPouchId = isColossal
      ? (COLOSSAL_POUCH_ITEM_IDS.has(savedBasePouchId) ? savedBasePouchId : ItemIdentifiers.COLOSSAL_POUCH)
      : LARGE_POUCH_ITEM_ID;
    inventory.deleteNumber(event.itemId, 1);
    inventory.adds(ORB_ITEM_ID, 1);
    inventory.adds(returnedPouchId, 1);
    if (isColossal) player.setAttribute(COLOSSAL_ORB_BASE_POUCH_ATTRIBUTE, 0);
    if (quest.getStage(player) === STAGE_ORB_IN_POUCH) quest.setStage(player, STAGE_ORB_GIVEN);
    startTranscript(api, player, MONK_NPC_ID, PAGE, V_ORB_EMPTY);
    return true;
  }

  /** Search the dead monk at Paterdomus. */
  function handleNpcInteraction(event) {
    const { player, npcId, clickType } = event;
    if (npcId !== DEAD_MONK_NPC_ID) return;
    const action = event.definition?.getActions?.()?.[clickType - 1];
    if (action !== "Search") return;
    if (quest.getStage(player) < STAGE_ALTAR) return;
    event.handled = true;
    startTranscript(api, player, DEAD_MONK_NPC_ID, PAGE, V_FIND_DEAD_MONK);
  }

  /** Mirror the dead-monk varbit from the stage (login and ::quest jumps). */
  function sendQuestVarbits(player) {
    const stage = quest.getStage(player);
    player.getPacketSender().sendVarbit(MONK_VARBIT, stage >= STAGE_ALTAR ? 1 : 0);
  }

  function handleStageChanged({ player, key }) {
    if (key !== "devious_minds") return;
    sendQuestVarbits(player);
  }

  function handleLogin({ player }) {
    sendQuestVarbits(player);
    // The altar stays scorched once the cutscene has played; stage 6 is the
    // cutscene placement, so re-send the durable post-cutscene transform.
    player.getPacketSender().sendVarbit(
      ALTAR_VARBIT,
      quest.getStage(player) >= STAGE_ALTAR ? ALTAR_SCORCHED : 0
    );
    refreshQuestList(player);
  }

  api.persistAttribute(MET_MONK_ATTRIBUTE);
  api.persistAttribute(BOW_SWORD_GIVEN_ATTRIBUTE, 0);
  api.persistAttribute(COLOSSAL_ORB_BASE_POUCH_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "devious_minds",
    name: "Devious Minds",
    varpId: VARP_DEVIOUS_BASE,
    varbitId: VARBIT_DEVIOUS_MAIN,
    varbitValue: stageWire,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.FLETCHING.getIndex(), amount: 5000, label: "Fletching" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 5000, label: "Runecraft" },
      { skillId: Skill.SMITHING.getIndex(), amount: 6500, label: "Smithing" },
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onNpcInteraction(handleNpcInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Large pouch", { Check: handlePouchCheck, Empty: handlePouchEmpty });
  api.onItemAction("Colossal pouch", { Check: handlePouchCheck, Empty: handlePouchEmpty });
  api.onPlayerLogin(handleLogin);
};
