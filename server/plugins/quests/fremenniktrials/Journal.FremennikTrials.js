/**
 * The Fremennik Trials' quest journal.
 *
 * Completed, live shows (1001646 t3517, qj1-qj11): the struck story, "QUEST COMPLETE!", then
 * "They also gave me a new name:" and the name.
 *
 * Running (rsprox 1002313, read at t93 ... t7510, 14 times): the struck start, the vote line, then one
 * section per trial in a fixed order: Navigator, Merchant, Hunter, Seer, Warrior, Reveller, Bard. A trial
 * not yet started is a blank line (the Merchant's three); a passed one its struck vote line (the
 * Merchant's after two blanks). Live's full stops are as recorded, not consistent.
 */
module.exports = function attachFremennikTrialsJournal(api, ctx) {
  const { T, I, STAGE_COMPLETE, VOTES_REQUIRED } = ctx;

  const COMPLETE_STORY = [
    "I made my way to the far north of Kandarin and found the",
    "Barbarian hometown of Rellekka. The tribe that live there call",
    "themselves the Fremennik, and offered me the chance to join",
    "them if I could pass their trials.",
    "I managed to persuade seven of the twelve council of elders",
    "to vote for me at their next meeting, and became an honorary",
    "member of the Fremennik.",
  ];

  const BLUE = "<col=000080>";
  const RED = "<col=800000>";
  const START = [
    "<str>I spoke to Brundt the Fremennik chieftain, and he told me <str>that",
    "<str>I could join their tribe if I could pass some trials <str>and get",
    "<str>seven of the twelve council members votes.",
  ];
  const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six"];

  function voteLines(votes) {
    if (votes <= 0) return [`${BLUE}I don't have any votes yet`, `${BLUE}I should try and find some of the ${RED}council members`];
    if (votes >= VOTES_REQUIRED) return [`${BLUE}I have ${RED}seven votes${BLUE}! I should go and speak to ${RED}Brundt${BLUE} again`];
    return [`${BLUE}I have ${RED}${COUNT_WORDS[votes]}${BLUE} vote${votes === 1 ? "" : "s"} so far`];
  }

  const header = (who, stop = "") => `${BLUE}The ${RED}${who}${BLUE} will vote for me if I can pass his trial${stop}`;

  /** The Merchant's current request, by the link that asked last (only the armourer's is captured, t2582). */
  const CHAIN_LINES = new Map([
    ["skulgrimen", `${BLUE}The ${RED}armourer${BLUE} is looking for a ${RED}rare inedible fish${BLUE}...`],
  ]);

  /** The Bard's progress line, by the lyre the player has got to (t323, t452, t611). */
  function bardProgress(player) {
    if (ctx.held(player, I.ENCHANTED_LYRE)) {
      return [`${BLUE}Now I have an enchanted ${RED}Lyre${BLUE} I should go and play ${BLUE}it at the`,
        `${RED}${RED}longhall${BLUE} to pass the ${RED}Bards' trial`];
    }
    if (ctx.held(player, I.LYRE)) return [`${BLUE}Now I have my lyre, I should get it ${RED}enchanted`];
    if (ctx.held(player, I.GOLDEN_WOOL)) return [`${BLUE}I now have some ${RED}golden wool${BLUE} to string my lyre with`];
    return [""];
  }

  function merchantStarted(player) {
    const lines = [header("Merchant", "."), `${BLUE}Someone in this town has a ${RED}rare flower${BLUE} that he wants.`, ""];
    const merchant = ctx.merchant;
    const asked = merchant?.asked?.(player) ?? 0;
    const chain = asked > 0 ? CHAIN_LINES.get(merchant.LINKS[asked - 1]?.name) : undefined;
    if (chain) lines.push(chain);
    lines.push("");
    return lines;
  }

  /**
   * Each trial's section: [not started, started, passed]. Ours: the Navigator's and the Warrior's running
   * lines (no recording reads them) follow the captured headers, with the task in our words.
   */
  const SECTIONS = [
    [T.NAVIGATOR, () => [""], () => [header("Navigator"), `${BLUE}I have to find my way through his ${RED}maze`],
      () => ["<str>I now have the Navigator's vote at the council."]],
    [T.MERCHANT, () => ["", "", ""], merchantStarted, () => ["", "", "<str>I now have the Merchant's vote at the council."]],
    [T.HUNTER, () => [""], () => [header("Hunter", "."), `${BLUE}I need to ${RED}track and defeat${BLUE} a creature called the ${RED}Draugen`],
      () => ["<str>I now have the Hunter's vote at the council."]],
    [T.SEER, () => [""], () => [header("Seer"), `${BLUE}I have to get from ${RED}one side${BLUE} of his house to ${RED}the other`],
      () => ["<str>I now have the Seer's vote at the council"]],
    [T.WARRIOR, () => [""], () => [header("Warrior"), `${BLUE}I have to defeat a ${RED}warrior${BLUE} without any weapons or armour`],
      () => ["<str>I now have the Warrior's vote at the council"]],
    [T.REVELLER, () => [""], () => [header("Reveller"), `${BLUE}I have to defeat him in a ${RED}drinking contest${BLUE} somehow!`],
      () => ["<str>I now have the Reveller's vote at the council"]],
    [T.BARD, () => [""], (player) => [
      header("Bard"),
      `${BLUE}I must make myself ${RED}a lyre${BLUE} and play it in the ${RED}longhall`,
      `${BLUE}First I need to get some ${RED}wood${BLUE} from a ${RED}special musical tree`,
      `${BLUE}Next I need to get some ${RED}Golden Wool${BLUE} from a local troll`,
      `${BLUE}Finally I need to get the ${RED}Lake Spirit${BLUE} to ${RED}enchant my lyre`,
      ...bardProgress(player),
    ], () => ["<str>I now have the Bard's vote at the council."]],
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
    const lines = [...START, ...voteLines(ctx.votesFor(player))];
    for (const [trial, notStarted, running, passed] of SECTIONS) {
      const state = ctx.trialState(player, trial);
      lines.push(...(state === 2 ? passed(player) : state === 1 ? running(player) : notStarted(player)));
    }
    return lines;
  }

  ctx.buildJournal = buildJournal;
};
