/**
 * Shilo Village's quest journal (interface 119). The lines through Ah Za Rhoon are the ones the
 * capture shows (RSProx capture ShiloVillage, rev 242.1, the journal opened at tick 2993, stage 8
 * with the scrolls read and Zadimus' corpse carried): a finished step is struck through (<str>), the
 * current one is blue with its red keywords. The capture opened the journal once, so which entries
 * are struck at the other stages follows that page's pattern (a step is struck once the next one has
 * begun), and the lines after Ah Za Rhoon are ours: no capture shows them.
 */
const NOW = (text) => `<col=000080>${text}`;
const DONE = (text) => `<str>${text}`;
const RED = (text) => `<col=800000>${text}<col=000080>`;

/** Each entry: when it shows, when it's done, and its lines (captured unless marked ours). */
function entries(sv) {
  const { STAGE, MECH, ITEM } = sv;
  const stage = (player) => sv.stage(player);
  return [
    { shows: (p) => stage(p) >= STAGE.STARTED, done: () => true, lines: [
      "I spoke to Mosol Rei in South Karamja, and have agreed to",
      "help his village. He gave me a 'Wampum belt'. I took the belt to",
      "Trufitus in Tai Bwo Wannai.",
    ] },
    { shows: (p) => stage(p) >= STAGE.STARTED, done: () => true, lines: [
      "After speaking to Trufitus I found that there is a legend",
      "about a place called Ah Za Rhoon that may contain the key to",
      "defeating Rashiliyia and the zombies invading Shilo Village.",
    ] },
    { shows: (p) => stage(p) >= STAGE.STARTED, done: (p) => stage(p) >= STAGE.SEARCHED_MOUND, lines: [
      "I need to find the location of 'Ah Za Rhoon'.",
    ], now: [
      `I need to find the location of '${RED("Ah Za Rhoon")}'.`,
    ] },
    { shows: (p) => stage(p) >= STAGE.DUG_MOUND, done: (p) => stage(p) >= STAGE.LIT_MOUND, lines: [
      "I've found a mound of earth in the jungle which seems",
      "curious. I've used a spade to excavate the mound of earth.",
    ] },
    { shows: (p) => stage(p) >= STAGE.LIT_MOUND, done: (p) => stage(p) >= STAGE.ROPED_MOUND, lines: [
      "After using the spade on the mound of earth I hit granite and",
      "discovered a dark fissure. I illuminated the fissure and saw it",
      "was a long way down.",
    ] },
    { shows: (p) => stage(p) >= STAGE.ROPED_MOUND, done: (p) => stage(p) >= STAGE.ENTERED_TEMPLE, lines: [
      "I attached a rope to the start of the fissure.",
    ] },
    { shows: (p) => stage(p) >= STAGE.ENTERED_TEMPLE, done: () => true, lines: [
      "I climbed down the rope into some sort of underground cavern",
      "system, I need to identify this place.",
    ] },
    { shows: (p) => stage(p) >= STAGE.ENTERED_TEMPLE, done: (p) => stage(p) >= STAGE.ENTERED_BERVIRIUS, lines: [
      "The cavern system I found might be Ah Za Rhoon, if I could",
      "identify the cavern it would help a lot.",
    ], now: [
      `The ${RED("cavern system")} I found might be ${RED("Ah Za Rhoon")}, if I could`,
      `${RED("identify")} the ${RED("cavern")} it would help a lot.`,
    ] },
    { shows: (p) => sv.mechTest(p, MECH.READ_TATTERED), done: () => true, lines: [
      "I've read the tattered scroll, it gives details about Bervirius",
      "who was Rashiliyia's son.",
    ] },
    { shows: (p) => sv.mechTest(p, MECH.READ_CRUMPLED), done: () => true, lines: [
      "I read the crumpled scroll, it said that Rashiliyia attacked",
      "people, it also said something about a ward.",
    ] },
    { shows: (p) => sv.mechTest(p, MECH.FOUND_CORPSE),
      done: (p) => !sv.held(p, ITEM.ZADIMUS_CORPSE) || stage(p) >= STAGE.ENTERED_BERVIRIUS, lines: [
        "I've discovered the grisly remains of some poor soul.",
      ], now: [
        `I've discovered the grisly ${RED("remains")} of some poor soul.`,
      ] },
    // Ours from here: no capture opened the journal past stage 8.
    { shows: (p) => stage(p) >= STAGE.ENTERED_BERVIRIUS, done: (p) => stage(p) >= STAGE.UNLOCKED_TOMB, lines: [
      "I searched Bervirius' tomb and found a crystal, some notes and",
      "an ivory sword pommel. I should craft a bone key and look for",
      "Rashiliyia's final resting place.",
    ], now: [
      `I searched ${RED("Bervirius' tomb")} and found a crystal, some notes and`,
      `an ivory sword pommel. I should craft a ${RED("bone key")} and look for`,
      "Rashiliyia's final resting place.",
    ] },
    { shows: (p) => stage(p) >= STAGE.UNLOCKED_TOMB, done: (p) => stage(p) >= STAGE.UNLOCKED_TOMB_DOOR, lines: [
      "I unlocked Rashiliyia's tomb with a bone key. The Beads of the",
      "Dead should protect me inside.",
    ], now: [
      `I unlocked ${RED("Rashiliyia's tomb")} with a bone key. The ${RED("Beads of the")}`,
      `${RED("Dead")} should protect me inside.`,
    ] },
    { shows: (p) => stage(p) >= STAGE.UNLOCKED_TOMB_DOOR, done: (p) => stage(p) >= STAGE.RETRIEVED_CORPSE, lines: [
      "I placed three bones in the skeletal door of Rashiliyia's tomb",
      "and it opened. I should search the tomb dolmen for her remains.",
    ], now: [
      `I placed three bones in the skeletal door of ${RED("Rashiliyia's tomb")}`,
      `and it opened. I should search the ${RED("tomb dolmen")} for her remains.`,
    ] },
    { shows: (p) => stage(p) >= STAGE.RETRIEVED_CORPSE, done: (p) => sv.complete(p), lines: [
      "I have Rashiliyia's remains. I should lay them to rest on the",
      "dolmen in Bervirius' tomb.",
    ], now: [
      "I have Rashiliyia's remains. I should lay them to rest on the",
      `dolmen in ${RED("Bervirius' tomb")}.`,
    ] },
  ];
}

function buildJournal(sv, player) {
  const stage = sv.stage(player);
  // The not-started page is the quest overview's start sentence (QuestRuntime's startSentence reads it).
  if (stage < sv.STAGE.STARTED) {
    return [
      "I can start this quest by speaking to <col=800000>Mosol Rei</col>",
      "outside Shilo Village in southern Karamja.",
      "",
      "I need <col=800000>Jungle Potion</col>, 20 Crafting, 32 Agility",
      "and the ability to defeat a level 91 monster.",
    ];
  }
  const lines = [];
  for (const entry of entries(sv)) {
    if (!entry.shows(player)) continue;
    const done = entry.done(player);
    for (const text of done ? entry.lines : entry.now ?? entry.lines) lines.push(done ? DONE(text) : NOW(text));
  }
  if (sv.complete(player)) lines.push("", "<col=ff0000>QUEST COMPLETE!</col>");
  return lines;
}

module.exports = { buildJournal };
