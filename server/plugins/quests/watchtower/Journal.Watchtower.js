/**
 * The Watchtower quest journal as the revision 242 capture shows it (Watchtower.bin, opened at
 * ticks 229, 322, 1000, 1200, 1415, 1677, 1789, 1832, 2238, 2433, 2835, 3022, 3117, 3332, 3682,
 * 5184 and 5481): an empty first line, finished entries struck through, the current ones in blue with
 * their key words in red. The words and colours are the capture's.
 *
 * Ours (not captured): Toban's entry before the dragon bones, the stage 5 page (the riddle; it shows
 * the stage 4 page), the map line when the map is not carried, the two skavid words the capture
 * learned last ('Cur bidith' - 'Ig', 'Tanath gor' - 'Nod', in the same form as the two it shows, in
 * skavid order), the shaman count once some are dead, and everything from all the shamans dead on.
 */
const { STAGES } = require("./State.Watchtower");

const STR = "<str>";
const BLUE = "<col=000080>";
const RED = "<col=800000>";

const struck = (...lines) => lines.map((line) => STR + line);

/** The skavid words in the order the journal lists them (t3117: 'Gor cur' before 'Bidith tanath'). */
const WORDS = [
  ["learnedIg", "'Cur bidith' - 'Ig'"],
  ["learnedAr", "'Gor cur' - 'Ar'"],
  ["learnedCur", "'Bidith tanath' - 'Cur'"],
  ["learnedNod", "'Tanath gor' - 'Nod'"],
];

/**
 * The journal for `stage` (null before the quest: the native overview). `facts` says what the
 * player carries and has done: { fingernails, gold, tooth, map, spokenOg, helpedOg, spokenGrew,
 * helpedGrew, helpedToban, eastGatePaid, learning, learnedIg, learnedAr, learnedCur, learnedNod,
 * shamansLeft }.
 */
function journal(stage, facts = {}) {
  if (stage <= 0) return null;
  const out = [""];
  const push = (...lines) => out.push(...lines);

  if (stage === STAGES.STARTED) {
    push(`${BLUE}I accepted the challenge of finding the lost ${RED}crystals${BLUE}.`);
    if (facts.fingernails) {
      push(`${BLUE}I found some ${RED}fingernails${BLUE} as evidence. I should take them to`,
        `${BLUE}the ${RED}Watchtower wizard${BLUE} in the Watchtower.`);
    } else {
      push(`${BLUE}I need to ${RED}find evidence${BLUE} of what's happened. It has been`,
        `${BLUE}suggested I try searching the ${RED}bushes${BLUE} near the Watchtower.`);
    }
    return out;
  }
  push(...struck("I accepted the challenge of finding the lost crystals.",
    "I found some fingernails as evidence. I should take them to", "the Watchtower wizard."), "");

  if (stage <= STAGES.RIDDLE) {
    push(`${BLUE}Now I need to ${RED}deal with the tribal ogres.`, "",
      `${BLUE}I should search the area to see if I can find any ogres and try`,
      `${BLUE}and communicate with the leaders.`);
    if (facts.helpedOg) push(...struck("I returned Og's stolen gold."));
    else if (facts.gold) push(`${BLUE}I have Og's ${RED}stolen gold${BLUE}; I should give it to him for a reward.`);
    else if (facts.spokenOg) push(`${BLUE}Og wants me to ${RED}retrieve his stolen gold${BLUE} from Toban.`);
    if (facts.helpedGrew) push(...struck("I knocked out one of Gorad's teeth and gave it to Grew."));
    else if (facts.tooth) {
      push(`${BLUE}I have ${RED}one of Gorad's teeth${BLUE}; I should give it to ${RED}Grew${BLUE} for a`, `${BLUE}reward.`);
    } else if (facts.spokenGrew) push(`${BLUE}Grew wants me to give him ${RED}one of Gorad's teeth.`);
    if (facts.helpedToban) push(...struck("I gave the dragon bones to Toban."));
    if (facts.eastGatePaid) push(...struck("I gave the gold to the east guard."));
    if (stage >= STAGES.GUTANOTH) push(...struck("I gave the ogre relic to the north west guard."));
    return out;
  }

  if (stage === STAGES.MAP) {
    push(...struck("I have solved the guard's puzzle."), `${BLUE}I was given ${RED}a map${BLUE} by the guard.`);
    if (facts.map) push(`${BLUE}I have it with me now, so I can navigate the skavid caves.`);
    push(`${BLUE}I need to ${RED}search the skavid caves.`);
    if (facts.learning) {
      push("", `${BLUE}I have been taught a few words of the skavid language:`, "", `${BLUE}ar, nod, gor, ig, cur`);
      for (const [fact, line] of WORDS) if (facts[fact]) push("", `${RED}${line}`);
    }
    return out;
  }
  push(...struck("I was given a map by the guard.", "I need to search the skavid caves."), "",
    ...struck("I found my way into the skavid caves."));

  if (stage === STAGES.SKAVID_CRYSTAL) {
    push(`${BLUE}I have been told that the other crystals are in the ${RED}shamans'`,
      `${RED}enclave${BLUE}. I should speak to the ${RED}Watchtower wizard${BLUE} to find out`,
      `${BLUE}how to get in.`);
    return out;
  }
  push(...struck("I used some cave nightshade to distract the enclave guard."), "");

  if (stage === STAGES.NIGHTSHADE) {
    push(`${BLUE}I need to ${RED}defeat the ogre shamans ${BLUE}and ${RED}find the other`, `${RED}crystals.`);
    return out;
  }
  push(...struck("I need to defeat the ogre shamans and find the other", "crystals.",
    "I tried to defeat the shamans, but they are protected by",
    "powerful magics! I should speak with the Watchtower wizard to", "see if he has any advice for me."));

  if (stage === STAGES.RECIPE) {
    push(`${BLUE}I need to make the ${RED}potion${BLUE} that will ${RED}defeat the ogre shamans${BLUE}.`);
    return out;
  }
  push("", ...struck("I have made the ogre potion.", "I gave the potion to the wizard.",
    "He infused it into a magic ogre potion.", "I need to defeat the ogre shamans."), "");

  const left = facts.shamansLeft ?? 6;
  if (stage === STAGES.MAGIC_POTION && left > 0) {
    push(`${BLUE}Now I need to ${RED}kill ${left} ogre shaman(s).`);
    return out;
  }
  // Ours from here on: not captured.
  push(...struck("Now I need to kill 6 ogre shaman(s)."));
  if (stage === STAGES.MAGIC_POTION) {
    push(`${BLUE}I have destroyed the ogre shamans. I should take the ${RED}crystals${BLUE} to the`,
      `${RED}Watchtower wizard${BLUE}.`);
    return out;
  }
  if (stage < STAGES.COMPLETE) {
    push("", `${BLUE}I need to put the ${RED}crystals${BLUE} on the ${RED}pillars${BLUE} and pull the ${RED}lever${BLUE}.`);
    return out;
  }
  push("", ...struck("I need to put the crystals on the pillars and pull the lever."), "",
    "<col=ff0000>QUEST COMPLETE!</col>");
  return out;
}

module.exports = { journal };
