/**
 * The Zogre Flesh Eaters quest journal. The revision 242 capture opens it twice in the tomb part
 * (rsprox ZogreFleshEaters.bin ticks 777 and 1158): struck lines for what is done, then the
 * current findings in blue with their key words in red. Those two pages are reproduced exactly:
 *
 * - tick 777 (488 = 3, the zombie killed, the page found): the coffin search and the forced
 *   lock struck, then the zombie, the page and the prism in blue;
 * - tick 1158 (488 = 5, the bartender asked, the three books found): the whole tomb part struck
 *   and the Yanille findings in blue.
 *
 * Ours: the pages before the barricade and from the evidence hand-in on were not captured; they
 * keep the plain summaries this plugin had.
 */
const { STAGES, ATTRIBUTES } = require("./State.ZogreFleshEaters");

const STR = "<str>";
const BLUE = "<col=000080>";
const RED = "<col=800000>";

const OPENING = [
  "I started this quest by talking to Grish, he asked me to check",
  "out the underground area where some Zombie ogres (Zogres)",
  "were coming from.",
  "I have to find a way into the ceremonial dance area and then",
  "underground.",
];
const PERSUADED = [
  "I persuaded a guard to let me past, I only had to mention",
  "Grish's name and the guard smashed the barricade down. I",
  "can enter now. ",
];
const ENTERED_SHORT = ["I need to find out what happened here."];
const ENTERED_LONG = [
  "The guard has smashed the barricade down. I can enter now. I",
  "need to find out what happened here.",
];
const COFFIN_SEARCHED = ["I have searched a coffin, it had a funny looking hole at the", "side."];
const LOCK_FORCED = ["I have forced the lock on a coffin, maybe I can open it now?"];

/** [struck text, current text] for each finding, as the two pages show them. */
const FINDINGS = {
  zombie: [
    ["I killed a human zombie which dropped a backpack. The", "backpack had the name 'B. Vahn' on it, inside the backpack I", "found a tankard."],
    [
      `${BLUE}I killed a ${RED}human zombie${BLUE} which dropped a ${RED}backpack${BLUE}. The`,
      `${BLUE}backpack had the name '${RED}B. Vahn${BLUE}' on it, inside the backpack I`,
      `${BLUE}found a ${RED}tankard${BLUE}.`,
    ],
  ],
  page: [
    ["I found a half torn page from a necromantic spell book, maybe", "this is a clue?"],
    [
      `${BLUE}I found a ${RED}half torn page${BLUE} from a ${RED}necromantic spell book${BLUE}, maybe`,
      `${BLUE}this is a ${RED}clue${BLUE}?`,
    ],
  ],
  prism: [
    ["I've opened the coffin and retrieved a black prism, this may", "be useful."],
    [
      `${BLUE}I've ${RED}opened${BLUE} the ${RED}coffin${BLUE} and retrieved a ${RED}black prism${BLUE}, this may`,
      `${BLUE}be useful.`,
    ],
  ],
  shown: [["I have shown the prism to the grand secretary of the wizards", "guild."], null],
};
const INNKEEPER = [
  `${BLUE}The 'Dragon Inn' ${RED}Innkeeper${BLUE} says the tankard belongs to one`,
  `${BLUE}of his locals called ${RED}Brentle Vahn${BLUE}. He was seen talking to a`,
  `${BLUE}${RED}wizard${BLUE} the other day.`,
];
const SITHIK_SPOKEN = [
  `${BLUE}I've spoken to ${RED}Sithik${BLUE}, I need to see if he was ${RED}involved${BLUE} in some`,
  `${BLUE}way.`,
];
const PORTRAITURE_FOUND = `${BLUE}I've found a ${RED}book${BLUE} on ${RED}portraiture${BLUE}...what does this prove?`;
const HAM_FOUND = `${BLUE}I've found a ${RED}book${BLUE} on ${RED}HAM philosophy${BLUE}...what does this prove?`;
const NECRO_FOUND = `${BLUE}I've found a ${RED}necromantic book${BLUE}...what does this prove?`;

const struck = (lines) => lines.map((line) => STR + line);

/** The tomb and Yanni part (stage 3), from the native varbits and the found-item flags. */
function tombPage(state) {
  const search = state.prismSearch;
  const lines = [...struck(OPENING), ...struck(PERSUADED)];
  if (search < 4) {
    lines.push(...struck(ENTERED_SHORT));
    if (search >= 1) lines.push(...(search >= 2 ? struck(COFFIN_SEARCHED) : COFFIN_SEARCHED.map((l) => BLUE + l)));
    if (search >= 2) lines.push(...(search >= 3 ? struck(LOCK_FORCED) : LOCK_FORCED.map((l) => BLUE + l)));
    if (state.zombieKilled) lines.push(...FINDINGS.zombie[1]);
    if (state.pageFound) lines.push(...FINDINGS.page[1]);
    if (search >= 3) lines.push(...FINDINGS.prism[1]);
    return lines;
  }
  lines.push(...struck(ENTERED_LONG), ...struck(COFFIN_SEARCHED), ...struck(LOCK_FORCED));
  lines.push(...struck(FINDINGS.prism[0]), ...struck(FINDINGS.page[0]), ...struck(FINDINGS.shown[0]));
  if (state.zombieKilled) lines.push(...struck(FINDINGS.zombie[0]));
  if (state.innkeeper) lines.push(...INNKEEPER);
  if (search >= 5) lines.push(...SITHIK_SPOKEN);
  if (state.portraitureFound) lines.push(PORTRAITURE_FOUND);
  if (state.hamFound) lines.push(HAM_FOUND);
  if (state.necroFound) lines.push(NECRO_FOUND);
  return lines;
}

module.exports = function createJournal(ctx) {
  function journalState(player) {
    return {
      prismSearch: ctx.prismSearchValue(player),
      zombieKilled: (Number(player.getAttribute(ctx.SKELETON_ATTRIBUTE)) || 0) >= 2,
      pageFound: player.getAttribute(ATTRIBUTES.PAGE_FOUND) === true || ctx.has(player, ctx.items.TORN_PAGE),
      innkeeper: ctx.flag(player, ctx.INNKEEPER_MUG_ATTRIBUTE),
      portraitureFound: player.getAttribute(ATTRIBUTES.PORTRAITURE_FOUND) === true,
      hamFound: player.getAttribute(ATTRIBUTES.HAM_FOUND) === true,
      necroFound: player.getAttribute(ATTRIBUTES.NECRO_FOUND) === true,
    };
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const has = (item) => ctx.has(player, item);
    if (stage >= STAGES.COMPLETE) {
      return [
        "<str>Grish asked me to find out why the Zogres had appeared at</str>",
        "<str>Jiggig. I found that the wizard Sithik Ints was responsible,</str>",
        "<str>but the necromantic spell could not be removed.</str>",
        "<str>I recovered the ogre artefacts so Grish can move the</str>",
        "<str>ceremonial grounds.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGES.KILLED_SLASH_BASH) {
      return has(ctx.items.OGRE_ARTEFACT)
        ? ["<str>I defeated Slash Bash.</str>", "I have the <col=800000>ogre artefact</col>; I should take it to Grish."]
        : ["<str>I defeated Slash Bash.</str>", "I lost the artefact; searching the <col=800000>stand</col> may find another."];
    }
    if (stage >= STAGES.GIVEN_KEY) {
      return [
        "<str>Sithik admitted the spell is permanent.</str>",
        "Grish gave me the <col=800000>ogre gate key</col>.",
        "I should search the tomb for the <col=800000>ogre artefacts</col>.",
      ];
    }
    if (stage >= STAGES.PERMANENT_SPELL) {
      return ["<str>Sithik told me the curse cannot be removed.</str>", "I should tell <col=800000>Grish</col> what I have learned."];
    }
    if (stage >= STAGES.POTION) {
      return ["<str>I poured Zavistic's potion into Sithik's tea.</str>", "I should check on <col=800000>Sithik</col> and see what happened."];
    }
    if (stage >= STAGES.SITHIK) {
      return has(ctx.items.STRANGE_POTION)
        ? ["<str>Zavistic gave me a strange potion for Sithik.</str>", "I should pour it into <col=800000>Sithik's cup of tea</col>."]
        : ["<str>Zavistic gave me a strange potion, but I lost it.</str>", "I should ask <col=800000>Zavistic Rarve</col> for another."];
    }
    if (stage >= STAGES.BARRICADE) return tombPage(journalState(player));
    if (stage >= STAGES.STARTED) return [...OPENING, "I need to get past the <col=800000>ogre guard</col>."];
    const lines = [
      "I can start this quest by speaking to <col=800000>Grish</col>",
      "at <col=800000>Jiggig</col>, south of Castle Wars.",
      "",
      "To start this quest I must complete:",
    ];
    lines.push(ctx.questComplete(player, "jungle_potion") ? "<str>Jungle Potion</str>" : "Jungle Potion");
    lines.push(ctx.questComplete(player, "big_chompy_bird_hunting") ? "<str>Big Chompy Bird Hunting</str>" : "Big Chompy Bird Hunting");
    lines.push("", "I must have 4 Smithing, 8 Herblore and 30 Ranged.");
    return lines;
  }

  return { buildJournal, tombPage };
};

module.exports.tombPage = tombPage;
