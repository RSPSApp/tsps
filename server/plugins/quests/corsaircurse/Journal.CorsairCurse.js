/**
 * The Corsair Curse's quest journal, as live writes it (rsprox capture local 1001340, rev 240.1:
 * questjournal 119 at ticks 5903, 6009, 6039, 6058, 6135, 6176, 6197, 6242, 6327, 6360, 6469, 7287
 * and 7418, and the overview's start sentence at tick 4352).
 *
 * The journal follows the quest's varbits (corscurs_progress, _cabinboy, _cook, _thief, _navigator):
 * each crew member's section grows a block per step, the newest block in blue with its red words,
 * every older one struck through. The crew sections all strike at progress 20, when every theory
 * is ruled out; after that the traitor blocks follow one another the same way.
 *
 * Blocks whose active (blue) form no snapshot shows keep the struck form's words in plain blue
 * (Ours: which words live reddens there is not captured): the intro at progress 5/10, Colin's
 * first and last blocks, Arsen's first three and his fifth, Gnocci's first, and the kill order.
 */
const RED = "<col=800000>";
const red = (text) => `${RED}${text}</col>`;

/** One block: `active` lines (blue, red words) and the `struck` words; a plain string is both. */
function block(active, struck = null) {
  const plain = struck ?? active.map((line) => line.replace(/<col=[0-9a-f]{6}>|<\/col>/g, ""));
  return { active, struck: plain };
}

const INTRO_MET = block([
  "I met the Corsair Captain at the crossroads north of Port",
  "Sarim. He wanted help with a curse that was afflicting his crew.",
  "I agreed to go to his ship, moored west of Rimmington.",
]);
const INTRO_SAILED = block([
  `The ${red("Corsair Captain")} told me that ${red("four")} of his crew had been`,
  `affected by a ${red("curse")}: ${red("Gnocci")}, ${red("Ithoi")}, ${red("Arsen")} and ${red("Colin")}, all of`,
  `whom were ${red("in their beds")}. He sailed me south to ${red("Corsair Cove")} to`,
  `${red("meet them")} and investigate.`,
]);

const COLIN = [
  block([
    `${red("Cabin Boy Colin")} thought the ${red("curse")} might have come because`,
    `he offended a ${red("mermaid")} he saw through ${red("Ithoi's telescope")}.`,
  ]),
  block([
    `However, I looked through that ${red("telescope")} myself, and saw an`,
    `${red("ogre")} rather than a ${red("mermaid")}.`,
  ]),
  block([
    "I told Colin that there was no mermaid there, to reassure him",
    "that the curse was not his fault.",
  ]),
];

const ITHOI = block([
  `${red("Ithoi the Navigator")} said he knew a lot about ${red("curses")}. He said`,
  `there were ${red("any number of things")} that could cause one.`,
]);

/** Arsen's blocks by corscurs_thief: 1 his story, 2 his request, 3 the artefact, 4 Tess, 5 telling him, 6 reassured. */
const ARSEN = [
  block([
    "Arsen the Thief told me he had been exploring a cave to the",
    "west of the cove. In there, he found fearsome ogres. He",
    "quickly stole an artefact from them, and fled. When the curse",
    "began, Arsen thought the ogres had cursed him for stealing a",
    "sacred relic from them.",
  ]),
  block([
    "He asked me to retrieve the relic from Captain Tock and return",
    "it to the ogre chief with his apologies.",
  ]),
  block([
    "I retrieved the ogre artefact from Captain Tock to return it to",
    "the ogre chief in their cave to the west of the cove.",
  ]),
  block([
    `${red("Tess")}, the ogre chief, said the artefact was a ${red("tooth-pick")}, and`,
    "she didn't care about it being stolen. She said her shamans",
    `had not ${red("cursed")} the crew.`,
  ]),
  block([
    "I returned to Arsen and began telling him what Tess had told",
    "me.",
  ]),
  block([`I was able to reassure ${red("Arsen")} that the ${red("curse")} was not his fault.`]),
];

const GNOCCI = [
  block([
    "Gnocci the Cook thought the curse might have come because",
    "he awakened a possessed doll he found while fishing. He",
    "buried the doll in the sand but was afraid that its possessor",
    "might have cursed them.",
  ]),
  block([
    `However, I dug up the ${red("doll")} and found that it was ${red("clockwork")}, and`,
    `did not appear to be ${red("possessed")}. It fell in the ${red("sea")} and was lost`,
    "again.",
  ]),
  block([
    `I told ${red("Gnocci")} that the doll was not ${red("possessed")}, to reassure him`,
    `that the ${red("curse")} was not his fault.`,
  ]),
];

const RULED_OUT = block([
  `I had ruled out all the corsairs' ${red("theories")} about how they had`,
  `become ${red("cursed")}.`,
]);
const TOCK_DINNER = block([
  `${red("Captain Tock")} mentioned that the ${red("curse")} had begun straight`,
  `after the ${red("crew's dinner")}, although ${red("Ithoi")} wasn't there to eat`,
  "that meal.",
]);
const GNOCCI_MEAL = block([
  `${red("Gnocci the Cook")} told me that the ${red("Ithoi")} had prepared the ${red("meal")}`,
  `that the ${red("crew")} ate immediately before becoming sick, though`,
  `${red("Ithoi")} himself did not eat that meal.`,
]);
const ARSEN_FIRED = block([
  `${red("Arsen the Thief")} told me that ${red("Ithoi")} might be about to get ${red("fired")}`,
  "from the crew.",
]);
const CONFESSED = block([
  `${red("Ithoi the Navigator")} admitted ${red("poisoning the dinner")} and`,
  `${red("pretending to be sick")} so that the ${red("Corsairs")} would think they`,
  `were ${red("cursed")}, and would therefore want him to stay on the`,
  "crew.",
]);
// Live rewords this line when it strikes it (ticks 6360 and 6469): "to prove that he" -> "to prove he".
const CHALLENGED = block(
  [`He challenged me to ${red("prove")} that he was faking his own ${red("illness")}.`],
  ["He challenged me to prove he was faking his own illness."],
);
const DRIFTWOOD = block([
  `By ${red("igniting the driftwood")} under ${red("Ithoi's hut")}, I made him run out,`,
  `proving he'd ${red("faked his illness")}. I also saw him cast a ${RED}magic`,
  `${RED}spell</col>, showing he has some ${red("magical combat ability")}.`,
]);
const KILL_ORDER = block([
  "When I told Captain Tock that I'd seen Ithoi running around,",
  "thus proving he'd faked his illness, the Captain told me to kill",
  "Ithoi.",
]);
const KILLED = block([`I fought ${red("Ithoi")} and successfully ${red("killed him")}.`]);
const COMPLETE = [
  "<str>Captain Tock thanked me for all my help.",
  "",
  "<col=ff0000>QUEST COMPLETE!",
  "",
  `For helping the Corsairs, I received ${red("2 Quest Points")} and`,
  `access to the facilities of ${red("Corsair Cove")}.`,
  "",
  `I can travel to ${red("Corsair Cove")} via the Corsairs' ship, which is`,
  `moored west of ${red("Rimmington")}.`,
];

const START = `I can start this quest by talking to ${red("Captain Tock")} north of ${red("Port Sarim")}.`;

function lines(out, entry, struck) {
  if (struck) out.push(...entry.struck.map((line) => `<str>${line}`));
  else out.push(...entry.active);
}

/** A crew section: its blocks up to `progress`, all struck but the newest, which strikes once `done`. */
function section(out, blocks, progress, done) {
  const shown = Math.min(progress, blocks.length);
  if (shown <= 0) return false;
  for (let i = 0; i < shown; i++) lines(out, blocks[i], done || i < shown - 1);
  out.push("");
  return true;
}

/**
 * @param state { progress, cabinboy, cook, thief, navigator, gnocciTold, arsenTold, arsenFirst } where
 *   progress is the corscurs_progress value (0, 5 ... 60) and the rest the crew varbits; the three
 *   traitor flags say which of Gnocci and Arsen told the player about Ithoi, and in which order.
 */
function buildLines(state) {
  const { progress } = state;
  if (progress <= 0) return [START];
  const out = [];
  lines(out, INTRO_MET, progress >= 15);
  if (progress >= 15) lines(out, INTRO_SAILED, progress >= 20);
  out.push("");
  const crewDone = progress >= 20;
  section(out, COLIN, state.cabinboy, crewDone);
  if (state.navigator > 0) {
    lines(out, ITHOI, crewDone);
    out.push("");
  }
  section(out, ARSEN, state.thief, crewDone);
  section(out, GNOCCI, state.cook, crewDone);
  if (progress >= 20) {
    lines(out, RULED_OUT, progress >= 25);
    if (progress >= 25) lines(out, TOCK_DINNER, progress >= 30);
    // The two reports in the order they were heard; the newer stays blue until Ithoi confesses.
    const told = [];
    if (state.gnocciTold) told.push(GNOCCI_MEAL);
    if (state.arsenTold) told.push(ARSEN_FIRED);
    if (state.arsenFirst) told.reverse();
    told.forEach((entry, index) => lines(out, entry, progress >= 40 || index < told.length - 1));
    if (progress >= 40) lines(out, CONFESSED, progress >= 50);
    if (progress >= 45) lines(out, CHALLENGED, progress >= 50);
    if (progress >= 50) lines(out, DRIFTWOOD, progress >= 52);
    if (progress >= 52) lines(out, KILL_ORDER, progress >= 55);
    if (progress >= 55) lines(out, KILLED, progress >= 60);
    if (progress >= 60) out.push(...COMPLETE);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

module.exports = { buildLines, START };
