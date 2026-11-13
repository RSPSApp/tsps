/**
 * The Slug Menace's quest journal, as live writes it (RSProx capture TheSlugMenace, rev 242.1,
 * questjournal 119 at ticks 380, 1022, 1177, 1407, 1451, 1780, 2195, 2332, 2959, 4354 and 4914).
 *
 * Each section shows once its condition holds: in blue until the quest moves past it, then struck
 * through (the quest plugin says when). Live rewords a few lines when it strikes them ("information about" ->
 * "the ritual to restore", "earth rune" -> "Earth Rune"), so a line carries both forms.
 * The three people O'Niall names are struck one by one as they are spoken to (ticks 1177, 1407,
 * 1451); a placed rune's line is struck as it goes in (Ours: the capture only shows none and all
 * five placed).
 */
const BLUE = "<col=000080>";
const RED = "<col=800000>";
const red = (text) => `${RED}${text}${BLUE}`;

/** [active, struck] for one line; a plain string is the same text in both forms. */
const SECTIONS = [
  {
    id: "started",
    lines: [
      "Sir Tiffy Cashien has given me a new task for the Temple",
      "Knights.",
      [`I am to report to ${red("Col. O'Niall")} in ${red("Witchaven")}, East of ${red("Ardougne")}.`,
        "I am to report to Col. O'Niall in Witchaven, East of Ardougne."],
    ],
  },
  {
    id: "briefed",
    lines: [
      "Col. O'Niall has explained that some of the people in",
      "Witchaven are acting very strangely. The mayor has been",
      "buying large quantities of items that Witchaven shouldn't",
      "need. He recommends I speak to the following people:",
    ],
  },
  { id: "track-holgart", person: true, lines: ["Holgart."] },
  { id: "track-hobb", person: true, lines: ["Mayor Eustace Hobb."] },
  { id: "track-maledict", person: true, lines: ["Brother Maledict."] },
  {
    id: "all-tracks",
    lines: [
      "After speaking to all these people I now need to report back",
      [`to ${red("Col. O'Niall")}.`, "to Col. O'Niall."],
    ],
  },
  {
    id: "reported",
    lines: [
      "After speaking to the Mayor and others, I have concluded",
      "something is very wrong in Witchaven.",
      [`I think I need to take a close look at the ${red("Saradomin shrine")},`,
        "I think I need to take a close look at the Saradomin shrine,"],
      [`west of ${red("Witchaven")}.`, "west of Witchaven."],
    ],
  },
  {
    id: "slug",
    lines: [
      "I also found a dead sea slug on the floor. I wonder if it will",
      "come in handy?",
    ],
  },
  {
    id: "scanned",
    lines: [
      "I have been to the Saradomin temple and found a secret",
      "entrance leading to some strange doors covered in odd",
      "glyphs. Savant has given me a transcript of the glyphs and",
      "directed me to Jorral north-west of Ardougne.",
      "If I lose this copy I should be able to get another copy",
      "through the CommOrb.",
    ],
  },
  {
    id: "translated",
    lines: [
      "Both Jorral and Savant reckon that this threat is very, very",
      "old. Savant has been able to research the Mother Mallum and",
      "will let me know some more information in due time.",
    ],
  },
  {
    id: "savant-info",
    lines: [
      "Savant has revealed that the Mother Mallum is behind that",
      [`strange door. ${red("Col. O'Niall")} needs to be informed of this.`,
        "strange door. Col. O'Niall needs to be informed of this."],
    ],
  },
  {
    id: "warned",
    lines: [
      "Col. O'Niall thinks that the Mother Mallum may be breaking",
      [`free. ${red("Brother Maledict")} may have some information on how to`,
        "free. Brother Maledict may have some information on how to"],
      "strengthen her prison.",
    ],
  },
  {
    id: "church",
    lines: [
      "I just saw Mayor Hobb coming from the church. This doesn't",
      "bode well at all.",
    ],
  },
  {
    id: "pages",
    lines: [
      "Aside from acting very strangely, Brother Maledict has",
      ["informed me that information about the Mother Mallum's",
        "informed me that the ritual to restore the Mother Mallum's"],
      "prison is contained within his holy book. However, the relevant",
      "pages have been stolen. I should go looking for them.",
    ],
  },
  {
    id: "torn",
    lines: [
      "One of the recovered pages has been torn into pieces. I",
      [`wonder if ${red("swamp paste")} can stick it back together?`,
        "wonder if swamp paste can stick it back together?"],
    ],
  },
  {
    id: "glue-advice",
    lines: [
      "Savant thinks I can make some clear glue, from a boiled down",
      "sea slug, to fix the torn pages. Perhaps Bailey at the Fishing",
      "Platform could help me?",
    ],
  },
  {
    id: "glue",
    lines: [
      "Bailey has cooked up a dead sea slug into a clear paste. I",
      "should use this to repair the page fragments.",
    ],
  },
  {
    id: "fixed",
    lines: [
      "After repairing the torn page I have discovered that each one",
      [`contains instructions on how to modify ${RED}earth, air, fire, water`,
        "contains instructions on how to modify earth, air, fire, water"],
      [`${RED}and mind runes${BLUE} to repair the ${red("doorway")}.`,
        "and mind runes to repair the doorway."],
    ],
  },
  { id: "rune-earth", rune: "earth", lines: [[`I need to place a shaped ${red("earth rune")} in the doorway.`, "I need to place a shaped Earth Rune in the doorway."]] },
  { id: "rune-air", rune: "air", lines: [[`I need to place a shaped ${red("air rune")} in the doorway.`, "I need to place a shaped Air Rune in the doorway."]] },
  { id: "rune-fire", rune: "fire", lines: [[`I need to place a shaped ${red("fire rune")} in the doorway.`, "I need to place a shaped Fire Rune in the doorway."]] },
  { id: "rune-water", rune: "water", lines: [[`I need to place a shaped ${red("water rune")} in the doorway.`, "I need to place a shaped Water Rune in the doorway."]] },
  { id: "rune-mind", rune: "mind", lines: [[`I need to place a shaped ${red("mind rune")} in the doorway.`, "I need to place a shaped Mind Rune in the doorway."]] },
  {
    id: "duped",
    lines: [
      "I have been duped. The modified runes actually open the",
      "prison doorway! The Sea Slug Prince emerged and we engaged",
      "in a mighty battle.",
    ],
  },
  {
    id: "escaped",
    lines: [
      "After slaying the Prince, the Mother Mallum appeared and",
      "announced her plans for world domination. Thankfully, Savant",
      "removed me to safety. However, the Sea Slug Queen has",
      "escaped. I wonder what her next action will be.",
    ],
  },
];

/**
 * `state` answers which sections show and which are done: shown(id) - the section is written;
 * done(id) - struck through; complete - the quest is done and every line is struck. Live strikes
 * by progress, not by the newest section: at tick 1451 the briefing stays blue beside the
 * "report back" lines, both struck together at the report (tick 1780).
 */
function buildLines(state) {
  const visible = SECTIONS.filter((section) => state.shown(section.id));
  const out = [];
  for (const section of visible) {
    const struck = state.complete || state.done(section.id);
    for (const line of section.lines) {
      const [active, plain] = Array.isArray(line) ? line : [line, line];
      if (struck) out.push(`<str>${plain}`);
      else if (section.person) out.push(`${RED}${active}`);
      else out.push(`${BLUE}${active}`);
    }
  }
  return out;
}

module.exports = { buildLines, SECTIONS };
