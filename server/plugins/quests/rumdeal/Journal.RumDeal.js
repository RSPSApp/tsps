/**
 * The Rum Deal quest journal as the revision 242 capture shows it (RumDeal.bin, opened at ticks 629,
 * 852, 906, 1177, 1248, 2171 and 2643): an empty first line, then one entry per step with an empty
 * line between, every finished entry struck through and the current one in blue with its key words
 * in red. The entries' words are the capture's; so is the colouring of the current entry where the
 * capture shows it current (seeds, planted, grown, shown, holy wrench, swill).
 *
 * Ours: the other entries were only captured struck through, so their current form is the same words
 * in blue; the two last pages (Donnie has drunk, and complete) were not captured at all.
 */
const { STAGES } = require("./State.RumDeal");

const STR = "<str>";
const BLUE = "<col=000080>";
const RED = "<col=800000>";

/** [the stage that ends the entry, the struck words, the current words]; current null = the words in blue. */
const ENTRIES = [
  [STAGES.AGREED, ["I have spoken to Pirate Pete, and have agreed to help him", "find his Family Sword."], null],
  [STAGES.MET_BRAINDEATH, ["I have agreed to help Pirate Pete slay Barrelor the Destroyer", "so that he can reclaim his lands."], null],
  [STAGES.GIVEN_SEEDS, [
    "I have a splitting headache. Captain Braindeath has explained",
    "the situation to me, and I have agreed to help brew up a batch",
    "of 'rum'.",
  ], null],
];

const SEEDS = [[
  "I have been given some Blindweed Seeds, and told to grow",
  "them in the Herb Patch outside. Captain Braindeath",
  "recommended that I try and intimidate the Swabs guarding the",
  "Herb Patch if I want them to stop attacking me.",
], [
  `${BLUE}I have been given some ${RED}Blindweed Seeds${RED}${BLUE}, and told to grow`,
  `${BLUE}them in the ${RED}Herb Patch${RED}${BLUE} outside. ${RED}Captain Braindeath${RED}${BLUE}`,
  `${BLUE}recommended that I try and intimidate the ${RED}Swabs${RED}${BLUE} guarding the`,
  `${BLUE}${RED}Herb Patch${RED}${BLUE} if I want them to stop attacking me.`,
]];
const PLANTED = [[
  "I have planted my Blindweed Seeds, and should wait for them",
  "to grow.",
], [
  `${BLUE}I have planted my ${RED}Blindweed Seeds${BLUE}, and should wait for them`,
  `${BLUE}to grow.`,
]];

/** From the blindweed on, one entry per stage: [stage it is current at, struck, current]. */
const LATER = [
  [STAGES.GROWN_BLINDWEED, [
    "I have grown some Blindweed, I should show it to Captain",
    "Braindeath so that he can tell me what to do with it.",
  ], [
    `${BLUE}I have grown some ${RED}Blindweed${BLUE}, I should show it to ${RED}Captain`,
    `${RED}Braindeath${RED}${BLUE} so that he can tell me what to do with it.`,
  ]],
  [STAGES.SHOWN_BLINDWEED, [
    "I have shown my Blindweed to Captain Braindeath. He told me",
    "to put it into the Intake Hopper.",
  ], [
    `${BLUE}I have shown my ${RED}Blindweed${BLUE} to ${RED}Captain Braindeath${BLUE}. He told me`,
    `${BLUE}to put it into the ${RED}Intake Hopper${RED}${BLUE}.`,
  ]],
  [STAGES.BLINDWEED_ADDED, [
    "I have added the Blindweed to the hopper. I should ask",
    "Captain Braindeath what he wants me to do next.",
  ], null],
  [STAGES.FETCH_WATER, [
    "Captain Braindeath has told me to fetch a bucket of Stagnant",
    "Water from the Stagnant Lake near the top of the Volcano to",
    "the North.",
  ], null],
  [STAGES.COLLECTED_WATER, [
    "Using superior cunning and stealth I have managed to exit",
    "the Brewery compound and have collected a bucket of",
    "Stagnant Water.",
  ], null],
  [STAGES.WATER_ADDED, [
    "I have poured the Stagnant Water into the Intake Hopper.  I",
    "should speak to Captain Braindeath again to see what else he",
    "needs.",
  ], null],
  [STAGES.CATCH_CREATURES, [
    "Captain Braindeath has told me to fish with a Fishbowl and Big",
    "Net in the Squid Fishing Spot.  Whatever 5 Sea Creatures I",
    "dredge up are to be put into a barrel and pressurised.",
  ], null],
  [STAGES.PRESSURISED, [
    "I have pressurised the Assorted Sea Creatures in the",
    "Pressure Barrel. I should see Captain Braindeath to check if",
    "this is all he needs me to do.",
  ], null],
  [STAGES.BLESS_WRENCH, [
    "Apparently the Brewing Equipment has become possessed. ",
    "Captain Braindeath has given me a Wrench and told me to sort",
    "it out.  I should check amongst the Brewers to see which of",
    "them can bless it for me.",
  ], null],
];
const HOLY_WRENCH = [[
  "I am now the proud owner of a Holy Wrench. I will take up this",
  "Holy Wrench and strike the Brewing Controls until they are",
  "very, very sorry.",
], [
  `${BLUE}I am now the proud owner of a ${RED}Holy Wrench${BLUE}. I will take up this`,
  `${BLUE}${RED}Holy Wrench${BLUE} and strike the ${RED}Brewing Controls${BLUE} until they are`,
  `${BLUE}${RED}very, very sorry${BLUE}.`,
]];
const AFTER_SPIRIT = [
  [STAGES.SPIRIT_BANISHED, [
    "I have banished the Evil Spirit.  Captain Braindeath told me",
    "there is one more ingredient left.  I should ask him what this",
    "is.",
  ], null],
  [STAGES.KILL_SPIDER, [
    "Captain Braindeath wants me to kill a Fever Spider, and put its",
    "Body into the Intake Hopper. He told me to wear Slayer Gloves",
    "(Available from the Slayer Masters apparently) while I did so,",
    "as they carry a nasty disease. Mental Note; do not drink",
    "whatever comes out of that machine.",
  ], null],
  [STAGES.SPIDER_ADDED, [
    "I have placed the Fever Spider Body in the Hopper. Captain",
    "Braindeath will be able to produce some 'rum' when I tell him.",
  ], null],
  [STAGES.COLLECT_SWILL, [
    "Captain Braindeath has filled the Output Vat with 'rum'. I",
    "should take a bucket of the stuff to Captain Donnie and give",
    "it to him.",
  ], [
    `${RED}Captain Braindeath${BLUE} has filled the ${RED}Output Vat${BLUE} with ${RED}'rum'${BLUE}. I`,
    `${BLUE}should take a bucket of the stuff to ${RED}Captain Donnie${BLUE} and give`,
    `${BLUE}it to him.`,
  ]],
  // Ours: not captured.
  [STAGES.TOLD_DONNIE, [
    "Captain Donnie drank the 'rum', and let slip that Rabid Jack",
    "sent him. I should tell Captain Braindeath.",
  ], null],
];

const struck = (lines) => lines.map((line) => STR + line);
const current = (words, styled) => styled ?? words.map((line) => BLUE + line);

/**
 * The journal for `stage`; `planted` and `holyWrench` are the two in-stage entries the capture shows
 * (the seed in the patch at stage 4, the blessed wrench at stage 13).
 */
function journal(stage, { planted = false, holyWrench = false } = {}) {
  if (stage <= 0) return null;
  const out = [""];
  const add = (lines) => { out.push(...lines, ""); };
  const step = (endsAt, words, styled) => {
    if (stage >= endsAt) add(struck(words));
    else add(current(words, styled));
    return stage >= endsAt;
  };
  for (const [endsAt, words, styled] of ENTRIES) {
    if (!step(endsAt, words, styled)) return finish(out);
  }
  // The seeds are struck once they are planted (tick 852), the planted entry once picked (1177).
  const seedsDone = stage > STAGES.GIVEN_SEEDS || planted;
  add(seedsDone ? struck(SEEDS[0]) : SEEDS[1]);
  if (stage === STAGES.GIVEN_SEEDS) {
    if (planted) add(PLANTED[1]);
    return finish(out);
  }
  add(struck(PLANTED[0]));
  for (const [at, words, styled] of LATER) {
    if (at === STAGES.BLESS_WRENCH) break;
    if (stage === at) { add(current(words, styled)); return finish(out); }
    add(struck(words));
  }
  // The wrench and the holy wrench share one paragraph: no empty line between them (ticks 2171, 2643).
  const [, wrench] = LATER.find(([at]) => at === STAGES.BLESS_WRENCH);
  if (stage === STAGES.BLESS_WRENCH && !holyWrench) {
    add(current(wrench, null));
    return finish(out);
  }
  out.push(...struck(wrench));
  if (stage === STAGES.BLESS_WRENCH) {
    add(HOLY_WRENCH[1]);
    return finish(out);
  }
  add(struck(HOLY_WRENCH[0]));
  for (const [at, words, styled] of AFTER_SPIRIT) {
    if (stage === at) { add(current(words, styled)); return finish(out); }
    add(struck(words));
  }
  out.push("<col=ff0000>QUEST COMPLETE!</col>");
  return out;
}

function finish(out) {
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

module.exports = { journal };
