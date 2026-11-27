/**
 * Eagles' Peak's quest journal, as live sends its lines (RSProx capture, rev 243: journal opened at t97 (stage 5),
 * t292 (15, before meeting Nickolaus), t513 (15, disguise asked for), t785 (15, Asyff asked), t850/t1061 (15,
 * costumes made), t1984 (20) and t2040 (25)). A done section is struck through in plain text; the active one is
 * navy with its key words maroon. The capture never opened it at 10, 30, 35 or 40: those are marked "Ours".
 */
const NAVY = "<col=000080>";
const RED = "<col=800000>";
const red = (text) => `${RED}${text}${NAVY}`;

/** Each section once done (struck), and while active (its captured colours, or Ours). */
const SECTIONS = Object.freeze({
  charlie: {
    done: [
      "I spoke to Charlie, who deals with new deliveries at the zoo in",
      "Ardougne. Apparently one of their associates, Nickolaus,",
      "went in search of a ferret to replace one they lost, but he",
      "hasn't been heard from since.  I should head to Eagles' Peak,",
      "a mountain to the west of the Gnome Stronghold, where he",
      "was last expected to have been. Maybe I can find some clues",
      "to his whereabouts there.",
    ],
    active: [
      `${NAVY}I spoke to ${red("Charlie")} who deals with new deliveries at the`,
      `${NAVY}Ardougne zoo. Apparently one of their associates named`,
      `${RED}${red("Nickolaus")} went in search of a ferret to replace one they lost,`,
      `${NAVY}but he hasn't been heard from since. I should head to ${RED}Eagles'`,
      `${RED}Peak${NAVY}, a mountain to the ${red("West of the Gnome Stronghold")}, where`,
      `${NAVY}he was last expected to have been. Maybe there I can find`,
      `${NAVY}some clues as to his whereabouts.`,
    ],
  },
  camp: {
    done: [
      "I found a camp-site in the area where Nickolaus was expected",
      "to have been, but it looked like it had been abandoned in a",
      "hurry. Looking around the campsite I found a small metal",
      "feather inside a book about birds.  Maybe if I can find out",
      "what this is for then I can find Nickolaus.",
    ],
    // Ours: the capture has this section struck only; the active wording is the struck text in navy.
    active: null,
  },
  cliff: {
    done: [
      "I found a part of the cliff that looked out of place compared",
      "to the rest of the mountain. Upon closer inspection, this",
      "turned out to be a secret passage, unlocked by the metal",
      "feather I had found earlier. Maybe if I go into the mountain I",
      "will find out what Nickolaus was up to.",
    ],
    active: [
      `${NAVY}I found a part of the cliff that looked out of place compared`,
      `${NAVY}to the rest of the mountain. Upon closer inspection, this`,
      `${NAVY}turned out to be a secret passage, unlocked by the metal`,
      `${NAVY}feather I had found earlier. Maybe if I go ${red("into the mountain")}`,
      `${NAVY}then I will find out what ${red("Nickolaus")} was up to.`,
    ],
  },
  nest: {
    done: [
      "I found Nickolaus within the cave system of the mountain. It",
      "seems that he has been abducted by giant eagles. Nickolaus",
      "suggested making an eagle disguise to try to infiltrate the",
      "eagles' nest. He recommended that I talk to the owner of the",
      "fancy dress shop in Varrock who may be able to help me. I",
      "should take some suitable materials with me; there are plenty",
      "of giant feathers around the nest that I could take.",
    ],
    active: [
      `${NAVY}I found ${red("Nickolaus")} within the cave system of the mountain. It`,
      `${NAVY}seems that he has been abducted by giant eagles. Nickolaus`,
      `${NAVY}suggested making an eagle ${red("disguise")} to try to infiltrate the`,
      `${NAVY}eagles' nest. He recommended that I talk to the ${RED}owner of the`,
      `${RED}fancy dress shop${NAVY} in ${red("Varrock")} who may be able to help me. I`,
      `${NAVY}should take some ${red("suitable materials")} with me; there are plenty`,
      `${NAVY}of ${red("giant feathers")} around the nest that I could take.`,
    ],
  },
  disguise: {
    done: [
      "I got the fancy dress shop owner to make me an eagle",
      "disguise so that I could trick the eagles and get into their",
      "nest. I gave a disguise to Nickolaus so that he could escape",
      "the nest. I still need to get him to capture a ferret for the",
      "zookeeper.",
    ],
    active: [
      `${NAVY}I got the fancy dress shop owner to make me an eagle`,
      `${NAVY}disguise so that I could trick the eagles and get into their`,
      `${NAVY}nest. I gave a disguise to ${red("Nickolaus")} so that he could escape`,
      `${NAVY}the nest. I still need to get him to ${red("capture a ferret")} for the`,
      `${RED}${red("zookeeper")}.`,
    ],
  },
});

/** Before the quest: the older plugin's start lines (Ours; the overview's sentence comes from the cache row). */
const NOT_STARTED = Object.freeze([
  `I can start this quest by talking to ${RED}Charlie</col> at the`,
  `${RED}East Ardougne Zoo</col>.`,
  "",
  "I need level 27 Hunter.",
]);

const strike = (lines) => lines.map((line) => `<str>${line}`);
const navy = (lines) => lines.map((line) => `${NAVY}${line}`);

/** The costume list (t785): each line struck once it is carried (Ours: maroon while it is not). */
function costumeList(player, state, done) {
  const { ITEM } = state;
  const header = ["The owner of the fancy dress shop said he could make a", "disguise for me, but he needs the following items first..."];
  const items = [
    ["10 Giant eagle feathers", state.held(player, ITEM.EAGLE_FEATHER, 10)],
    ["Yellow dye", state.held(player, ITEM.YELLOW_DYE)],
    ["Swamp tar", state.held(player, ITEM.SWAMP_TAR)],
  ];
  const lines = done ? strike(header) : navy(header);
  for (const [text, carried] of items) lines.push(done || carried ? `<str>${text}` : `${RED}${text}`);
  return lines;
}

function buildJournal(player, state) {
  const { STAGE, CHAT, VARBIT } = state;
  const stage = state.stage(player);
  const chat = state.get(player, VARBIT.NICKOLAUS_CHAT);
  if (stage < STAGE.STARTED) return NOT_STARTED.slice();
  const lines = [""];
  // The last section has no blank line after it (t252: 20 lines, the cliff's last on qj20).
  const finish = () => {
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };
  const section = (key, active) => {
    const entry = SECTIONS[key];
    lines.push(...(active ? entry.active ?? navy(entry.done) : strike(entry.done)), "");
  };
  section("charlie", stage === STAGE.STARTED);
  if (stage < STAGE.BOOK_READ) return finish();
  section("camp", stage === STAGE.BOOK_READ);
  if (stage < STAGE.CAVE_OPEN) return finish();
  const metNickolaus = stage > STAGE.CAVE_OPEN || chat >= CHAT.AGREED;
  section("cliff", !metNickolaus);
  if (!metNickolaus) return finish();
  const askedAsyff = stage > STAGE.CAVE_OPEN || chat >= CHAT.ASKED_ASYFF;
  section("nest", !askedAsyff);
  if (!askedAsyff) return finish();
  const made = stage > STAGE.CAVE_OPEN || chat >= CHAT.COSTUMES_MADE;
  lines.push(...costumeList(player, state, made));
  const given = stage >= STAGE.DISGUISE_GIVEN;
  lines.push(given ? "<str>I should then take the disguise to Nickolaus in the cave."
    : `${NAVY}I should then take the disguise to ${red("Nickolaus")} in the cave.`, "");
  if (!given) return finish();
  // Ours from 35: the capture did not open the journal after the ferret lesson or the hand-in.
  section("disguise", stage < STAGE.FERRET_CAUGHT);
  if (stage < STAGE.FERRET_CAUGHT) return finish();
  if (stage < STAGE.COMPLETE) {
    lines.push(`${NAVY}Nickolaus taught me how to catch a ferret. I should take it to`, `${red("Charlie")} at the ${red("Ardougne zoo")}.`);
    return finish();
  }
  lines.push("<col=ff0000>QUEST COMPLETE!</col>");
  return finish();
}

module.exports = { buildJournal, SECTIONS };
