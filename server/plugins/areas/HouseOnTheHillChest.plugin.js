/**
 * The stone chest upstairs in Fossil Island's House on the Hill (loc fossil_dkl_chest1), which
 * gives the ten Fossil Island Notes for numulites, as live OSRS plays it (rsprox captures: rsprox.net
 * recording 3040, rev 231, 44 Search clicks from tick 11054 to 14378; docs/house-on-the-hill-chest.md).
 *
 * - Search, before the player has found the hole's number: a message box, "It looks like the hole
 *   in the front of this locked chest exactly the size of a numulite." With a numulite in the
 *   inventory it is followed by "Insert a numulite into the hole?"; inserting one plays
 *   human_pickuptable and sound 2402 and shows two numulite object boxes, the second naming 100.
 * - Search after that: "Insert 100 numulites into the hole?" while the player has 100, else their
 *   own "Perhaps I should have brought some more numulites with me." Each 100 inserted has one of
 *   three outcomes: a hollow clunk (sound 2386); a spike, "Ow!" and a hit (sound 2386); or the
 *   chest opens (sound 2387) and gives the lowest-numbered note the player lacks, logged and shown
 *   in an object box. With all ten owned, the open outcome finds nothing.
 */
const HOLE_FOUND_ATTRIBUTE = "house-on-the-hill:chest-hole-found";

const NUMULITES_PER_TRY = 100;
const INSERT_ANIMATION = 832; // human_pickuptable
const INSERT_SOUND = 2402;
const CLUNK_SOUND = 2386;
const OPEN_SOUND = 2387;
/** The player chat heads the two recorded lines use: chatneu2 and chatquiz1. */
const HEAD_NEUTRAL = 589;
const HEAD_QUIZ = 554;
/**
 * Ours: the outcome weights. The capture has 21 opens, 13 clunks and 13 spikes from 47 tries;
 * no source gives the real odds.
 */
const OUTCOME_WEIGHTS = { open: 2, clunk: 1, spike: 1 };

const TEXT = {
  hole: "It looks like the hole in the front of this locked chest exactly the size of a numulite.",
  insertOneTitle: "Insert a numulite into the hole?",
  insertOne: "Yes, insert a numulite.",
  keepOne: "No, keep my numulites!",
  inserted: "You place a numulite into the hole, it rattles around and a mechanism clicks a few times and the lid opens ever so slightly.",
  number: "You notice a scratched number 100 near the hole. Perhaps you should feed in more numulites?",
  insertTitle: "Insert 100 numulites into the hole?",
  insert: "Yes, insert 100 numulites.",
  keep: "Don't waste numulites!",
  tooFew: "Perhaps I should have brought some more numulites with me.",
  clunk: "The numulites seem to clunk hollowly and nothing happens to the chest.",
  spike: "The numulites seem to rattle louder and a spike shoots out of the hole, stabbing you.",
  ow: "Ow!",
  opened: "The chest pops open and you snatch a very aged piece of parchment before it slams shut again.",
  empty: "You don't find anything much of interest.",
  allNotes: "Hmm, maybe I have all the old notes now.",
};

let core = null;
let pluginApi = null;
let random = Math.random;

/** The ten notes in the order the chest hands them out (fossil_note1-10). */
function notes() {
  const ids = core.ItemIdentifiers;
  return [ids.SCRIBBLED_NOTE, ids.PARTIAL_NOTE, ids.ANCIENT_NOTE, ids.ANCIENT_WRITINGS, ids.EXPERIMENTAL_NOTE,
    ids.PARAGRAPH_OF_TEXT, ids.MUSTY_SMELLING_NOTE, ids.HASTILY_SCRAWLED_NOTE, ids.OLD_WRITING, ids.SHORT_NOTE];
}

/**
 * Ours: "has a note" is the inventory, worn items or bank. Live keeps the notes put in the Fossil
 * Island note book too; tsps has no note book yet.
 */
function owns(player, itemId) {
  const searchTab = core.Bank?.BANK_SEARCH_TAB_INDEX;
  return player.getInventory().contains(itemId)
    || (player.getEquipment?.().contains?.(itemId) ?? false)
    || (player.getBanks?.() ?? []).some((bank, tab) => tab !== searchTab && bank?.contains?.(itemId));
}

function nextNote(player) {
  return notes().find((id) => !owns(player, id)) ?? null;
}

/**
 * Fitted to the 11 captured spikes (99 -> 9 ... 39 -> 6): 5 plus a twentieth of the current
 * Hitpoints. Ours: it never takes the last Hitpoint; the capture never went below 39.
 */
function spikeDamage(hitpoints) {
  return Math.max(0, Math.min(hitpoints - 1, 5 + Math.floor(hitpoints / 20)));
}

function rollOutcome() {
  const entries = Object.entries(OUTCOME_WEIGHTS);
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [outcome, weight] of entries) {
    roll -= weight;
    if (roll < 0) return outcome;
  }
  return entries[entries.length - 1][0];
}

function start(player, ...dialogues) {
  const chain = new core.DialogueChainBuilder();
  dialogues.forEach((dialogue) => chain.add(dialogue));
  player.getDialogueManager().startDialogues(chain);
}

function close(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

function menu(player, index, title, yes, no, onYes) {
  const options = new core.OptionDialogue(index, { executeOption: (option) => {
    if (Number(option) === 1) onYes(player);
    else close(player);
  } }, yes, no);
  options.setTitle(title);
  return options;
}

function insertOne(player) {
  const numulite = core.ItemIdentifiers.NUMULITE;
  if (!player.getInventory().contains(numulite)) {
    close(player);
    return;
  }
  player.getInventory().delete(numulite, 1);
  player.setAttribute(HOLE_FOUND_ATTRIBUTE, true);
  player.performAnimation(new core.Animation(INSERT_ANIMATION));
  player.getPacketSender().sendSound(INSERT_SOUND, 1, 0);
  start(player,
    new core.ItemStatementDialogue(0, numulite, TEXT.inserted),
    new core.ItemStatementDialogue(1, numulite, TEXT.number),
    new core.EndDialogue(2));
}

function stab(player) {
  player.sendMessage(TEXT.spike);
  player.forceChat(TEXT.ow);
  const damage = spikeDamage(player.getHitpointsAfterPendingDamage());
  if (damage > 0) player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
}

function open(player) {
  const note = nextNote(player);
  if (note === null) {
    player.sendMessage(TEXT.empty);
    start(player, new core.PlayerDialogue(0, TEXT.allNotes, HEAD_QUIZ), new core.EndDialogue(1));
    return;
  }
  const inventory = player.getInventory();
  // Ours: a full inventory puts the note under the player; the capture always had room.
  if (inventory.getFreeSlots() > 0) inventory.add(new core.Item(note, 1), true);
  else core.ItemOnGroundManager.registerLocation(player, new core.Item(note, 1), player.getLocation());
  pluginApi?.emitCustomEvent("collection-log:obtain", { player, itemId: note, amount: 1 });
  start(player, new core.ItemStatementDialogue(0, note, TEXT.opened), new core.EndDialogue(1));
}

function insertHundred(player) {
  const numulite = core.ItemIdentifiers.NUMULITE;
  if (player.getInventory().getAmount(numulite) < NUMULITES_PER_TRY) {
    close(player);
    return;
  }
  player.getInventory().delete(numulite, NUMULITES_PER_TRY);
  const outcome = rollOutcome();
  player.getPacketSender().sendSound(outcome === "open" ? OPEN_SOUND : CLUNK_SOUND, 1, 0);
  if (outcome === "open") {
    open(player);
    return;
  }
  close(player);
  if (outcome === "spike") stab(player);
  else player.sendMessage(TEXT.clunk);
}

/** 21 other "Stone chest" locs (DT2 Stranglewood, Karuulm, DS2, ...) also have Search; only this one takes numulites. */
function searchChest({ player, objectId }) {
  if (objectId !== core.ObjectIdentifiers.STONE_CHEST) return false; // fossil_dkl_chest1
  const numulite = core.ItemIdentifiers.NUMULITE;
  const inventory = player.getInventory();
  if (!player.getAttribute(HOLE_FOUND_ATTRIBUTE)) {
    const hole = new core.StatementDialogue(0, TEXT.hole);
    if (!inventory.contains(numulite)) start(player, hole, new core.EndDialogue(1));
    else start(player, hole, menu(player, 1, TEXT.insertOneTitle, TEXT.insertOne, TEXT.keepOne, insertOne));
    return;
  }
  if (inventory.getAmount(numulite) < NUMULITES_PER_TRY) {
    start(player, new core.PlayerDialogue(0, TEXT.tooFew, HEAD_NEUTRAL), new core.EndDialogue(1));
    return;
  }
  start(player, menu(player, 0, TEXT.insertTitle, TEXT.insert, TEXT.keep, insertHundred));
}

module.exports = {
  name: "HouseOnTheHillChest",
  description: "Fossil Island's House on the Hill stone chest: numulites for the ten Fossil Island Notes, or a clunk or a spike.",
  members: true,
  _test: {
    HOLE_FOUND_ATTRIBUTE, TEXT, notes, spikeDamage, rollOutcome, searchChest,
    set random(fn) { random = fn; },
  },
  register(api) {
    core = api.core;
    pluginApi = api;
    api.persistAttribute(HOLE_FOUND_ATTRIBUTE, false);
    api.onObjectInteraction("Stone chest", { Search: searchChest });
  },
};
