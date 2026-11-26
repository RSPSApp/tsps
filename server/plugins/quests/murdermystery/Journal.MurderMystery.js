/**
 * The Murder Mystery quest journal as the revision 242 capture shows it (MurderMystery.bin, opened at
 * ticks 946, 1159, 1732, 1920 and 2041): the struck story of the murder, the guard's request in blue
 * with its key words in red, an empty line, then one fixed line each for the coloured thread, the
 * murder weapon and the strange smelling pot. A line not yet earned is sent empty (tick 946: the thread
 * only, qj9 and qj10 blank). The words, tags and the doubled tags on the wrapped lines are the capture's.
 *
 * Ours: a clue line shows while the item is carried (the captures never drop one between openings), and
 * the completed journal (not captured) strikes the whole entry and adds QUEST COMPLETE!.
 */
const STR = "<str>";
const BLUE = "<col=000080>";
const RED = "<col=800000>";

const STORY = [
  `${STR}Lord Sinclair, a prominent nobleman, had been horribly`,
  `${STR}${STR}murdered at his mansion. The guards had been sent to`,
  `${STR}${STR}investigate his murder, but have been completely stuck.`,
];

const REQUEST = [
  `${BLUE}One of the ${RED}guards${BLUE} has asked me for my help in solving the`,
  `${BLUE}${BLUE}murder. I should ${RED}examine the crime scene${BLUE} very closely for`,
  `${BLUE}${BLUE}evidence, and ${RED}interrogate everybody${BLUE} in the area carefully`,
];

const REQUEST_STRUCK = [
  `${STR}One of the guards has asked me for my help in solving the`,
  `${STR}murder. I should examine the crime scene very closely for`,
  `${STR}evidence, and interrogate everybody in the area carefully`,
];

/** [the line, the item ids that earn it]. */
const CLUES = [
  [`${BLUE}I have found some ${RED}coloured thread${BLUE}. It might be useful.`, [1808, 1809, 1810]],
  [`${BLUE}I have taken the ${RED}murder weapon${BLUE}. I think it might help me.`, [1813, 1814]],
  [`${BLUE}I have a ${RED}strange smelling pot${BLUE}. It seems like a clue.`, [1812]],
];

function journal(player, stage, { STARTED, COMPLETE }) {
  if (stage < STARTED) return ["I can start this quest by speaking to a", `${BLUE}${RED}guard${BLUE} outside the Sinclair Mansion.`];
  if (stage >= COMPLETE) return [...STORY, ...REQUEST_STRUCK, "", "<col=ff0000>QUEST COMPLETE!</col>"];
  const inventory = player.getInventory();
  const carried = (ids) => ids.some((id) => inventory.getAmount(id) > 0);
  return [...STORY, ...REQUEST, "", ...CLUES.map(([line, ids]) => (carried(ids) ? line : ""))];
}

module.exports = { journal };
