/**
 * Learning the Ropes (free-to-play; Tutorial Island made a trackable quest on 22 Oct 2025).
 *
 * The quest has no varp of its own: the cache's quest-list script (4024) maps the
 * "Learning the Ropes" quest row (dbrow 9643) to get_varp 281 - the `tutorial` progress
 * varp - and the row's endstate (column 19) is 671, the step where the Wind Strike task
 * hands over to the Magic Instructor ("To the mainland!"). Stage values are therefore the
 * tutorial step values (plugins/areas/data/tutorial-island.json, from a recorded OSRS run):
 * 1 past-experience screen, 650 cast Wind Strike, 671 complete, 680 home teleport,
 * 1000 left the island.
 *
 * Completion follows the tutorial's step listener (Common.TutorialIsland.onStep), so the
 * quest completes at 671 - exactly where the tutorial's first Wind Strike hands off and
 * where it used to send its own completion message (Combat.TutorialIsland). The starter
 * kit (bronze tools, runes and the 25 banked coins, the wiki's reward list) is granted by
 * Leave.TutorialIsland.complete() on arriving in Lumbridge; this file only mirrors the
 * tutorial stage on login so accounts from before the quest resync.
 *
 * Rewards (OSRS Wiki): 1 Quest point, access to the mainland, the Lumbridge Home Teleport,
 * the tutorial's equipment and runes, and 25 coins in the bank.
 */
module.exports = function registerLearningTheRopesQuest(api) {
  const Tutorial = require("../../areas/tutorialisland/Common.TutorialIsland");
  const { registerQuest, QUEST_POINTS_ATTRIBUTE, QUEST_POINTS_VARP } = require("../QuestRuntime");

  const VARP_TUTORIAL = 281; // "tutorial" (script 4024, quest dbrow 9643)
  const STAGE_STARTED = Tutorial.STEP.PAST_EXPERIENCE; // 1
  const STAGE_COMPLETE = Tutorial.STEP.LEAVE_TALK; // 671, the quest row's endstate

  let quest;

  /**
   * Mirrors a tutorial step into the quest stage; completes it on crossing 671. Completing
   * writes the endstate (671) to the shared varp, so the stage then still follows the step:
   * skipping the island jumps straight to 1000, and left at 671 the cache's gameframe kept the
   * tabs it locks on the island (logout among them) disabled until the next login.
   */
  function applyTutorialProgress(player, value) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (value >= STAGE_COMPLETE && !quest.isComplete(player)) quest.complete(player);
    // A jump straight past the threshold (the island skip, or a save resync) still leaves the
    // durable stage and the shared tutorial varp at the value the tutorial actually reached.
    if (quest.getStage(player) !== value) quest.setStage(player, value);
  }

  function onTutorialStep(player, value) {
    applyTutorialProgress(player, value);
  }

  /**
   * Login resync: an account that reached the tutorial's completion point before this
   * quest existed is completed quietly (no scroll on login), and every account's quest
   * stage follows its persisted tutorial progress.
   */
  function onLogin({ player }) {
    if (!player) return;
    const value = Tutorial.progress(player);
    if (value < STAGE_STARTED) return;
    if (value >= STAGE_COMPLETE && !quest.isComplete(player)) {
      const total = (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) + (quest.questPoints || 0);
      player.setAttribute(QUEST_POINTS_ATTRIBUTE, total | 0);
      player.getPacketSender().sendConfig(QUEST_POINTS_VARP, total | 0);
    }
    if (quest.getStage(player) !== value) quest.setStage(player, value);
  }

  /** The current tutorial task, in the journal's voice. */
  function currentObjective(stage) {
    if (stage >= Tutorial.STEP.CAST_WIND_STRIKE) {
      return ["I should cast <col=800000>Wind Strike</col> on a chicken for the", "Magic Instructor."];
    }
    if (stage >= Tutorial.STEP.MAGIC_TALK) {
      return ["I should speak to the <col=800000>Magic Instructor</col> about magic."];
    }
    if (stage >= Tutorial.STEP.PRAYER_TALK) {
      return ["I should speak to <col=800000>Brother Brace</col> in the chapel and", "learn about Prayer."];
    }
    if (stage >= Tutorial.STEP.OPEN_BANK) {
      return ["I should visit the <col=800000>bank</col> and then talk to the", "<col=800000>Account Guide</col>."];
    }
    if (stage >= Tutorial.STEP.COMBAT_TALK) {
      return ["I should learn about <col=800000>combat</col> from the Combat Instructor", "at the rat pen."];
    }
    if (stage >= Tutorial.STEP.MINING_TALK) {
      return ["I should learn about <col=800000>Mining and Smithing</col> in the caves", "below the Quest Guide's house."];
    }
    if (stage >= Tutorial.STEP.QUEST_TALK) {
      return ["I should speak to the <col=800000>Quest Guide</col> and open my", "quest list."];
    }
    if (stage >= Tutorial.STEP.CHEF_TALK) {
      return ["I should speak to the <col=800000>Master Chef</col> and bake some bread."];
    }
    if (stage >= Tutorial.STEP.SURVIVAL_TALK) {
      return ["I should speak to the <col=800000>Survival Expert</col>, catch some", "shrimp and cook them on a fire."];
    }
    return ["I should speak to the <col=800000>Gielinor Guide</col> to begin the", "tutorial."];
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I visited Tutorial Island and learned the basics of</str>",
        "<str>Gielinor: fishing, cooking, mining, smithing, combat,</str>",
        "<str>banking, prayer and magic.</str>",
        "",
        "<str>I can now reach the mainland, and I have the Lumbridge</str>",
        "<str>Home Teleport spell.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I am on <col=800000>Tutorial Island</col>, learning the basics of",
        "Gielinor from the island's instructors.",
        "",
        ...currentObjective(stage),
      ];
    }
    return [
      "I can start this quest by talking to the",
      "<col=800000>Quest Guide</col> on <col=800000>Tutorial Island</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  quest = registerQuest(api, {
    key: "learning_the_ropes",
    name: "Learning the Ropes",
    varpId: VARP_TUTORIAL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    otherRewards: [
      "Access to the Mainland",
      "The Lumbridge Home Teleport",
      "Tutorial equipment and runes",
      "25 Coins (banked)",
    ],
    buildJournal,
  });

  Tutorial.onStep(onTutorialStep);
  api.onPlayerLogin(onLogin);
  api.onCustomEvent("player:bootstrap-complete", onLogin);
};
