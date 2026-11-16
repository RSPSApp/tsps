/**
 * Mudfoot's Big Adventure's quest journal, as live writes it (rsprox capture MudfootsBigAdventure, rev 242.1,
 * questjournal 119 at ticks 325 (stage 6) and 845 (stage 16)).
 *
 * Each paragraph shows once the quest reaches it: blue with red names while it is the current one, then struck
 * through. Paragraphs follow each other with no blank line. Live shortens the second paragraph when it strikes
 * it (the "According to Mudfoot" sentence goes), so a paragraph carries both forms.
 *
 * Captured: the "harlan" and "recruited" paragraphs struck, "recruited" current (tick 325); "store" struck and
 * "windmill" current (tick 845). Ours (not captured): the current forms of "harlan" and "store" (the struck text
 * with the names in red, as the captured paragraphs mark them), the struck form of "windmill", the "mage" and
 * "warrior" paragraphs, the start text and the completed journal.
 */
const BLUE = "<col=000080>";
const RED = "<col=800000>";

/**
 * "{" and "}" open and close a name live shows in red; a name may run across a line break ("{Ruined" ...
 * "Building}"). Live starts every wrapped line with the colour in effect there, and the first line with its
 * own first colour (tick 845: "<col=800000>Mudfoot<col=000080> and I found ...", then "<col=800000>Building<col=000080> south").
 */
function activeLines(lines) {
  let red = false;
  return lines.map((line, index) => {
    let out = index === 0 ? (line.startsWith("{") ? "" : BLUE) : red ? RED : BLUE;
    for (const char of line) {
      if (char === "{") { out += RED; red = true; }
      else if (char === "}") { out += BLUE; red = false; }
      else out += char;
    }
    return out;
  });
}

const struck = (line) => `<str>${line.replace(/[{}]/g, "")}`;

const PARAGRAPHS = [
  {
    from: 2,
    lines: [
      "I spoke with {Captain Harlan} north of {Lumbridge Castle}. He told",
      "me about a bounty for some {Thieves} who robbed the {General",
      "Store}. According to him, some {Goblins} east of the {River Lum} in",
      "{Lumbridge} were the prime suspects.",
    ],
  },
  {
    from: 6,
    lines: [
      "I went to investigate the {Goblins} east of the {River Lum} in",
      "{Lumbridge}, and encountered one named {Mudfoot}. He revealed",
      "that the {Goblins} weren't responsible, and had instead been",
      "set up by some {Humans}. We decided to work together to bring",
      "them to justice. According to {Mudfoot}, we can find the first",
      "one near the {General Store}.",
    ],
    struckLines: [
      "I went to investigate the Goblins east of the River Lum in",
      "Lumbridge, and encountered one named Mudfoot. He revealed",
      "that the Goblins weren't responsible, and had instead been",
      "set up by some Humans. We decided to work together to bring",
      "them to justice.",
    ],
  },
  {
    from: 8,
    lines: [
      "{Mudfoot} and I found the first {Thief} by the {General Store}.",
      "{Mudfoot} tried to attack him, but didn't have any luck. The",
      "{Thief} then left. {Captain Harlan} came to see what was going on.",
      "Upon explaining the situation, he suggested that because of",
      "the {Ranger Armour} worn by the {Thief}, {Mudfoot} would have",
      "better luck if he used a {Stabbing Weapon}. {Mudfoot} left to get",
      "one, and told me to meet him near the {Windmill} north of",
      "{Lumbridge}, where the {Thief} was seen going.",
    ],
  },
  {
    from: 14,
    lines: [
      "{Mudfoot} and I found the first {Thief} again near the {Windmill}",
      "north of {Lumbridge}. This time, we were able to defeat him.",
      "{Mudfoot} told me the next {Thief} was last seen by a {Ruined",
      "Building} south of the {Windmill}, and that she was using {Magic}.",
      "As such, a {Ranged Weapon} will work best against her. If",
      "needed, I can use the {Bow} dropped by the first {Thief}.",
      "Alternatively, {Captain Harlan} might be able to help me acquire",
      "something suitable.",
    ],
  },
  {
    // Ours: not captured.
    from: 20,
    lines: [
      "{Mudfoot} and I found the second {Thief} by the {Ruined Building}",
      "and defeated her. {Mudfoot} told me the last {Thief} was seen in",
      "the {Graveyard} south east of there, and that he was a {Warrior}",
      "who used {Prayers} to protect himself. As such, {Magic} will work",
      "best against him. If needed, I can use the {Staff} and {Runes}",
      "dropped by the second {Thief}. Alternatively, {Captain Harlan}",
      "might be able to help me acquire something suitable.",
    ],
  },
  {
    // Ours: not captured.
    from: 26,
    lines: [
      "{Mudfoot} and I found the last {Thief} in the {Graveyard} and",
      "defeated him. I should let {Captain Harlan} know that the",
      "{Thieves} have been dealt with.",
    ],
  },
];

const COMPLETE = 32;

/** The journal for a stage: the start text at 0, the paragraphs reached so far, then QUEST COMPLETE! at the end. */
function buildLines(stage) {
  if (stage <= 0) {
    // Ours: the Wiki's start (Talk to Captain Harlan just outside the Lumbridge general store).
    return [
      `I can start this quest by speaking to ${RED}Captain Harlan${BLUE}`,
      `just outside the ${RED}Lumbridge General Store${BLUE}.`,
      "",
      "There are no requirements for this quest.",
    ].map((line) => (line ? BLUE + line : line));
  }
  const reached = PARAGRAPHS.filter((paragraph) => stage >= paragraph.from);
  const lines = [];
  reached.forEach((paragraph, index) => {
    const current = index === reached.length - 1 && stage < COMPLETE;
    if (current) lines.push(...activeLines(paragraph.lines));
    else lines.push(...(paragraph.struckLines ?? paragraph.lines).map(struck));
  });
  if (stage >= COMPLETE) lines.push("", "<col=ff0000>QUEST COMPLETE!</col>");
  return lines;
}

module.exports = { buildLines, PARAGRAPHS };
