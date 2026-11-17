/**
 * The Fremennik Trials' quest journal.
 *
 * Completed, live shows (1001646 t3517, qj1-qj11): the struck story, "QUEST COMPLETE!", then
 * "They also gave me a new name:" and the name. The running journal is ours: no capture reads it
 * mid-quest line by line, so it lists the trials and the votes earned.
 */
module.exports = function attachFremennikTrialsJournal(api, ctx) {
  const { T, STAGE_COMPLETE, VOTES_REQUIRED } = ctx;

  const COMPLETE_STORY = [
    "I made my way to the far north of Kandarin and found the",
    "Barbarian hometown of Rellekka. The tribe that live there call",
    "themselves the Fremennik, and offered me the chance to join",
    "them if I could pass their trials.",
    "I managed to persuade seven of the twelve council of elders",
    "to vote for me at their next meeting, and became an honorary",
    "member of the Fremennik.",
  ];

  const TRIAL_LABELS = [
    [T.REVELLER, "Manni the Reveller", "beat him in a drinking contest"],
    [T.BARD, "Olaf the Bard", "perform a song in the longhall"],
    [T.MERCHANT, "Sigmund the Merchant", "find him a rare flower"],
    [T.NAVIGATOR, "Swensen the Navigator", "find my way through his maze"],
    [T.SEER, "Peer the Seer", "solve the puzzle of his house"],
    [T.WARRIOR, "Thorvald the Warrior", "fight Koschei the Deathless"],
    [T.HUNTER, "Sigli the Huntsman", "hunt down the Draugen"],
  ];

  function buildJournal(player, quest) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      const lines = [...COMPLETE_STORY.map((line) => `<str>${line}</str>`), "", "<col=ff0000>QUEST COMPLETE!</col>"];
      const name = ctx.fremennikName?.(player);
      if (name) lines.push("<col=000080>They also gave me a new name:</col>", `<col=800000>${name}</col>`);
      return lines;
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Brundt the Chieftain</col>",
        "in the <col=800000>Rellekka Longhall</col>.",
        "",
        "I may need 40 Woodcutting, 40 Crafting and 25 Fletching",
        "to make the lyre, and the courage to fight unarmed.",
      ];
    }
    const lines = [`I have ${ctx.votesFor(player)} of the ${VOTES_REQUIRED} council votes I need.`, ""];
    for (const [index, name, task] of TRIAL_LABELS) {
      const state = ctx.trialState(player, index);
      if (state === 2) lines.push(`<str>${name}: vote earned.</str>`);
      else if (state === 1) lines.push(`${name}: I must ${task}.`);
      else lines.push(`${name}: I have not started this trial.`);
    }
    return lines;
  }

  ctx.buildJournal = buildJournal;
};
