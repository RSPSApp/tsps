/**
 * Icthlarin's Little Helper: the quest journal, as live sends it (questjournal 119 text lines; the capture opened it
 * at stages 3, 4, 5, 6, 7, 11 and 15, local 1002310 t528-t2781). Each part of the story is written in blue with
 * its names in red while it is current, then struck through (<str>) in the past tense once it is done.
 *
 * Ours (not captured, marked OURS below): the text at stages 1-2, 8-10, 12-14 and from 16 on, and the
 * embalmer's line with only some of his items handed in. They follow the captured parts' wording.
 */
const B = "<col=000080>";
const R = "<col=800000>";
const red = (text) => `${R}${text}${B}`;

const START_DONE = [
  "<str>I spoke to a Wanderer in her camp north of the locked down",
  "<str>city of Sophanem, but she didn't take kindly to the presence",
  "<str>of my Cat. In return for me putting it away, she promised to",
  "<str>tell me about a Secret Passage into the city.",
];
// OURS: the start part while current (only its struck form was captured).
const START_ACTIVE = START_DONE.map((line) => line.replace("<str>", B));
const START_SUPPLIES = [`${B}She asked me to bring her a full ${red("Waterskin")} and a ${red("Tinderbox")}.`];

const WOKE_ACTIVE = [
  `${B}I woke up outside a ${red("Pyramid")} in the city of ${red("Sophanem")} with a`,
  `${B}strange ${red("Burial Jar")} in my possession. I have no memory of how`,
  `${B}I obtained it or how I got there, but a nearby ${red("Ghost")} seems`,
  `${B}very angry with me. The last thing I remember was speaking to`,
];
const WOKE_TAIL = [`${B}the ${red("Wanderer")} outside the city. I need to try and work out what`, `${B}happened to me.`];
const WOKE_TAIL_SPHINX = [
  `${B}the ${red("Wanderer")} outside the city. Along with my ${red("Cat")}, I spoke to`,
  `${B}the ${red("Sphinx")}, a strange cat-like creature living in the city. She`,
  `${B}suggested I look around for something that could remind me`,
  `${B}what happened.`,
];
const WOKE_DONE = [
  "<str>I woke up outside a Pyramid in the city of Sophanem with a",
  "<str>strange Burial Jar in my possession. I had no memory of how I",
  "<str>obtained it or how I got there, but a nearby Ghost seemed",
  "<str>very angry with me. The last thing I remembered was speaking",
  "<str>to the Wanderer outside the city.",
];

const FLASHBACK_1_IN = [
  `${B}I touched the door to the ${red("Pyramid")}, and I experienced a`,
  `${R}${red("Flashback")}. Hopefully this can help me work out what`,
  `${B}happened.`,
];
const FLASHBACK_1_LEFT = [
  `${B}I touched the door to the ${red("Pyramid")}, and I experienced a`,
  `${R}${red("Flashback")}. I should touch the door again to try and work out`,
  `${B}what happened.`,
];
const FLASHBACK_1_SOLVED = [
  `${B}I touched the door to the ${red("Pyramid")}, and I experienced a`,
  `${R}${red("Flashback")} of me going inside to steal something. It seems I`,
  `${B}was hypnotised to do so, likely by the ${red("Wanderer")}. I should`,
  `${B}discuss this with the ${red("Sphinx")}.`,
];
const FLASHBACK_1_DONE = [
  "<str>I touched the door to the Pyramid, and I experienced a",
  "<str>Flashback of me going inside to steal something. It seems I",
  "<str>was hypnotised to do so, likely by the Wanderer.",
];

const SPHINX_ACTIVE = [
  `${B}Along with my ${red("Cat")}, I spoke to the ${red("Sphinx")}, a strange cat-like`,
  `${B}creature living in ${red("Sophanem")}. She told me that the ${red("Pyramid")} is`,
  `${B}the resting place for ${red("Klenter")}, a former ${red("High Priest of Icthlarin")},`,
  `${B}and that it is his ghost which is now angry with me. She also`,
  `${B}suggested that the ${red("Burial Jar")} I woke up with is likely the thing I`,
  `${B}stole from within. To put things right, she suggested I speak`,
  `${B}with the new ${red("High Priest of Icthlarin")} in the south west corner`,
  `${B}of the city. To get him to talk to me, I'll need to give him a`,
  `${R}${red("Token")} from the ${red("Sphinx")}.`,
];
const SPHINX_DONE = [
  "<str>Along with my Cat, I spoke to the Sphinx, a strange cat-like",
  "<str>creature living in Sophanem. She told me that the Pyramid was",
  "<str>the resting place for Klenter, a former High Priest of Icthlarin,",
  "<str>and that it was his ghost which was angry with me. She also",
  "<str>suggested that the Burial Jar I woke up with was likely the",
  "<str>thing I stole from within.",
];

const PRIEST_ACTIVE = [
  `${B}Following advice from the ${red("Sphinx")}, I spoke with the new ${R}High`,
  `${R}Priest of Icthlarin${B} in ${red("Sophanem")}. He told me I could put things`,
  `${B}right by returning the ${red("Burial Jar")} I stole to the ${red("Pyramid")}. He also`,
  `${B}told me that I'd need my ${red("Cat")} with me to enter the ${red("Pyramid")} due`,
  `${B}to them being guardians against the ${red("Devourer")}, the ${R}Menaphite`,
  `${R}Goddess of Destruction${B}.`,
];
const PRIEST_DONE = [
  "<str>Following advice from the Sphinx, I spoke with the new High",
  "<str>Priest of Icthlarin in Sophanem. He told me I could put things",
  "<str>right by returning the Burial Jar I stole to the Pyramid. He also",
  "<str>told me that I'd need my Cat with me to enter the Pyramid, due",
  "<str>to them being guardians against the Devourer, the Menaphite",
  "<str>Goddess of Destruction.",
];

const FLASHBACK_2_IN = [
  `${B}When I entered the ${red("Pyramid")}, I experienced another ${red("Flashback")}.`,
  `${B}Perhaps this will give me more information on how I stole the`,
  `${R}${red("Burial Jar")}.`,
];
// OURS: stages 12-13 (the flashback over, the jar to put back).
const FLASHBACK_2_OVER = [
  `${B}When I entered the ${red("Pyramid")}, I experienced another ${red("Flashback")}`,
  `${B}of me stealing the ${red("Burial Jar")} from a room within. I should return`,
  `${B}to that room and put the ${red("Burial Jar")} back.`,
];
// OURS: stage 14 (the jar back; the struck form is captured from stage 15).
const FLASHBACK_2_RETURNED = [
  `${B}When I entered the ${red("Pyramid")}, I experienced another ${red("Flashback")}`,
  `${B}of me stealing the ${red("Burial Jar")} from a room within. I returned to`,
  `${B}that room and put the ${red("Burial Jar")} back. I should tell the ${red("High Priest")}.`,
];
const FLASHBACK_2_DONE = [
  "<str>When I entered the Pyramid, I experienced another Flashback",
  "<str>of me stealing the Burial Jar from a room within. I returned to",
  "<str>that room and put the Burial Jar back.",
];

const CEREMONY_ACTIVE = [
  `${B}I returned to the ${red("High Priest")}, and he asked me to help prepare`,
  `${B}for a ${red("Ceremony")} to reconsecrate the ${red("Pyramid")}. To do so, he`,
  `${B}suggested I speak with the ${red("Embalmer")} and the ${red("Carpenter")} within`,
  `${B}the city.`,
];
const EMBALMER_TODO = `${B}I need to speak to the ${red("Embalmer")} and see what he needs.`;
const EMBALMER_DONE = ["<str>I gave the Embalmer some Salt, some Tree Sap and some Linen", "<str>for the Ceremony."];
const CARPENTER_TODO = `${B}I need to speak to the ${red("Carpenter")} and see what he needs.`;
// OURS: the parts after the capture's last journal (stage 15).
const CEREMONY_DONE = [
  "<str>I returned to the High Priest, and he asked me to help prepare",
  "<str>for a Ceremony to reconsecrate the Pyramid. I helped the",
  "<str>Embalmer and the Carpenter, who made me a Holy Symbol.",
];
const SYMBOL_ACTIVE = [`${B}The ${red("Ceremony")} has begun. I should take the ${red("Holy Symbol")} to the`, `${R}High Priest${B} inside the ${red("Pyramid")}.`];
const SYMBOL_DONE = ["<str>The Ceremony began, and I took the Holy Symbol into the Pyramid."];
const FLASHBACK_3_IN = [`${B}When I jumped the pit, I experienced another ${red("Flashback")}. I need to`, `${B}see what I did in the ${red("Pyramid")}.`];
const FLASHBACK_3_DONE = [
  "<str>When I jumped the pit, I experienced another Flashback, of me",
  "<str>hiding an Unholy Symbol in the ceremonial room for the Wanderer.",
];
const WARN = [`${B}The ${red("Wanderer")} is going to attack the ${red("Ceremony")}! I need to warn`, `${B}the ${red("High Priest")} in the eastern room.`];
const FIGHT = [`${B}The ${red("Wanderer")} was the ${red("Devourer")} all along! She possessed a`, `${B}priest. I must stop the ${red("Possessed Priest")}.`];
const FIGHT_DONE = ["<str>The Wanderer was the Devourer all along! She possessed a", "<str>priest, but I stopped him and saved the Ceremony."];
const THANKS = [`${B}I should speak to the ${red("High Priest")} in the eastern room.`];
const THANKED = [`${B}The ${red("High Priest")} asked me to meet him back in the city.`];
const ICTHLARIN = [`${B}${red("Icthlarin")} himself freed me from the ${red("Devourer")}'s hold. I should`, `${B}speak to the ${red("High Priest")} in the south west of ${red("Sophanem")}.`];
const COMPLETE = [
  "<str>Icthlarin himself freed me from the Devourer's hold, and the",
  "<str>High Priest thanked me for saving the Ceremony.",
  "",
  "<col=ff0000>QUEST COMPLETE!",
];

function createJournal(state, common, { STAGE, VARBIT }) {
  function build(player, quest) {
    const s = quest.getStage(player);
    const get = (varbit) => state.get(player, varbit);
    if (s <= STAGE.NOT_STARTED) return null;
    const lines = [];
    const add = (...parts) => { for (const part of parts) lines.push(...(Array.isArray(part) ? part : [part])); };
    if (s < STAGE.IN_SOPHANEM) {
      add(START_ACTIVE, "", START_SUPPLIES);
      return lines;
    }
    add(START_DONE);
    if (s === STAGE.IN_SOPHANEM) {
      add(WOKE_ACTIVE, get(VARBIT.MET_SPHINX) ? WOKE_TAIL_SPHINX : WOKE_TAIL);
      return lines;
    }
    add(WOKE_DONE);
    if (s === STAGE.FLASHBACK_1) {
      add(get(VARBIT.FLASHBACK) ? FLASHBACK_1_IN : FLASHBACK_1_LEFT);
      return lines;
    }
    if (s === STAGE.SEE_SPHINX) {
      add(FLASHBACK_1_SOLVED);
      return lines;
    }
    add(FLASHBACK_1_DONE);
    if (s === STAGE.SEE_HIGH_PRIEST) {
      add(SPHINX_ACTIVE);
      return lines;
    }
    add(SPHINX_DONE);
    if (s <= STAGE.IN_PYRAMID) {
      add(PRIEST_ACTIVE);
      return lines;
    }
    add(PRIEST_DONE);
    if (s <= STAGE.GUARDIAN_DEAD) {
      add(FLASHBACK_2_IN);
      return lines;
    }
    if (s <= STAGE.JAR_ROOM_OPEN) {
      add(FLASHBACK_2_OVER);
      return lines;
    }
    if (s === STAGE.JAR_RETURNED) {
      add(FLASHBACK_2_RETURNED);
      return lines;
    }
    add(FLASHBACK_2_DONE);
    if (s === STAGE.PREPARATIONS) {
      add(CEREMONY_ACTIVE, "", get(VARBIT.EMBALMER_ITEMS) === 7 ? EMBALMER_DONE : EMBALMER_TODO, "", CARPENTER_TODO);
      return lines;
    }
    add(CEREMONY_DONE);
    if (s === STAGE.CEREMONY_BEGUN) {
      add(SYMBOL_ACTIVE);
      return lines;
    }
    add(SYMBOL_DONE);
    if (s <= STAGE.SYMBOL_HIDDEN) {
      add(FLASHBACK_3_IN);
      return lines;
    }
    add(FLASHBACK_3_DONE);
    if (s <= STAGE.DEVOURER) {
      add(WARN);
      return lines;
    }
    if (s === STAGE.POSSESSED) {
      add(FIGHT);
      return lines;
    }
    add(FIGHT_DONE);
    if (s === STAGE.PRIEST_DEAD) {
      add(THANKS);
      return lines;
    }
    if (s === STAGE.ICTHLARIN_NEXT) {
      add(THANKED);
      return lines;
    }
    if (s === STAGE.FINISH) {
      add(ICTHLARIN);
      return lines;
    }
    add(COMPLETE);
    return lines;
  }

  return { build };
}

module.exports = { createJournal };
