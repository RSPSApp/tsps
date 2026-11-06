"use strict";

// The 2026 Easter hunt for Archibald: Talk-to the Easter Bunny, the note table, the eight
// hunt locations, the two egg boxes and the scribbled notes. Words come from the
// osrsreboxed "2026 Easter event" transcript (Wiki Transcript:2026 Easter event); this
// unit only answers its conditions and moves progress at the steps that say so.
const Progress = require("./Progress.EasterEvents");
const Scene = require("./Scene.EasterEvents");
const PAGE = "2026 Easter event";
const SOURCE = require("../../../data/definitions/event-dialogues.json")[PAGE];
const ORDINALS = Object.freeze(["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"]);
const V = Object.freeze({
  start: "starting-the-event-talking-to-the-easter-bunny",
  tableEarly: "starting-the-event-searching-the-note-on-a-table-before-starting-the-event",
  table: "starting-the-event-searching-the-note-on-a-table-after-starting-the-event",
  unread: "the-hunt-for-archibald-talking-to-the-easter-bunny-before-reading-the-notes",
  lost: "the-hunt-for-archibald-talking-to-the-easter-bunny-after-losing-the-notes",
  hint: note => `the-hunt-for-archibald-talking-to-the-easter-bunny-after-picking-up-the-${ORDINALS[note - 1]}-note`,
  shelves: "the-hunt-for-archibald-searching-the-apothecary-s-bookshelf",
  stepladder: "the-hunt-for-archibald-searching-lowe-s-stepladder",
  boxWrong: "the-hunt-for-archibald-opening-the-locked-egg-with-the-wrong-password",
  boxRight: "the-hunt-for-archibald-opening-the-locked-egg-with-the-correct-password",
  wall: "the-hunt-for-archibald-searching-the-wall-on-top-of-the-varrock-church",
  sword: "the-hunt-for-archibald-searching-the-varrock-swordshop-table",
  chair: "the-hunt-for-archibald-searching-the-chair-in-the-zamorakian-chapel",
  bed: "the-hunt-for-archibald-searching-the-bed-in-the-blue-moon-inn",
  decoy: "the-hunt-for-archibald-opening-the-decoy-egg",
  armour: "the-hunt-for-archibald-searching-the-suit-of-armour-in-varrock-palace",
  catch: "the-hunt-for-archibald-catching-archibald-in-the-varrock-west-bank-basement",
  missing: "the-hunt-for-archibald-talking-to-the-easter-bunny-after-finding-archibald-but-without-him-in-your-inventory",
  complete: "the-hunt-for-archibald-talking-to-the-easter-bunny-with-archibald-in-your-inventory",
  unclaimed: "the-hunt-for-archibald-talking-to-the-easter-bunny-before-claiming-the-rewards",
  after: "post-event-talking-to-the-easter-bunny",
});
// Hunt location n (1..7) -> the variant its search plays. Location 8 is the vault Archibald.
const SEARCH_VARIANTS = Object.freeze([null, V.shelves, V.stepladder, V.wall, V.sword, V.chair, V.bed, V.armour]);
// Wiki Scribbled notes: what Read shows for each note found so far.
const NOTE_TEXT = Object.freeze([null,
  "I heard there is a potion that can make me stronger!",
  "I heard about a guy who sells bendy sticks.",
  "I heard the view from up here is the best!",
  "I heard you can buy shiny, pointy sticks from this guy.",
  "I heard about an evil place of worship. Sounds cool!",
  "Bil noun omen.",
  "I heard there is a real king, in a court!",
  "I heard there is this massive vault of riches underground.",
]);
// Transcript boxes shown with an item picture ({{tbox|pic=...}}); other boxes are plain.
const NOTE_PICTURE = new Set(["You pick up the note left by Archibald.", "You manage to open the egg and inside you find a note.",
  "You open the egg and inside you find a note.", "I should bring my notes with me incase I need them."]);
const BOX_PICTURE = new Set(["You find a wooden egg that needs to be unlocked.", "You find a decoy egg."]);
const sessions = new WeakMap();
let enabled = false;
const Rewards = require("./Rewards.EasterEvents");
// Players who were refused their rewards for space this login hear the shorter return line.
const refused = new WeakSet();
let lock = null;

function activate(active) { enabled = active === true; }
function isActive() { return enabled && Scene.active(); }
function item(api, symbol) {
  const id = api.core.CacheDefinitions.getObjId(symbol);
  if (id === null) throw new Error("Missing 2026 Easter item " + symbol);
  return id;
}
function heldAnywhere(api, player, symbol) {
  const id = item(api, symbol), banks = player.getBanks().slice(0, api.core.Bank.BANK_SEARCH_TAB_INDEX);
  return [player.getInventory(), player.getEquipment(), ...banks].some(container => container && container.getAmount(id) > 0);
}
function hasNotes(api, player) { return player.getInventory().getAmount(item(api, "easter26_clue_stack")) > 0; }
function handsFree(api, player) {
  const { Equipment } = api.core, equipment = player.getEquipment();
  const held = slot => (equipment.get(slot)?.getId?.() ?? -1) > 0;
  return !held(Equipment.WEAPON_SLOT) && !held(Equipment.SHIELD_SLOT);
}
function give(api, player, symbol) {
  const inventory = player.getInventory(), loot = new api.core.Item(item(api, symbol), 1);
  if (inventory.getAddableAmount(loot) !== 1) return false;
  inventory.addItem(loot);
  return true;
}
function take(api, player, symbol) {
  const id = item(api, symbol), inventory = player.getInventory(), slot = inventory.getSlotForItemId(id);
  if (slot < 0) return false;
  inventory.deleteAtSlot(slot, 1);
  return true;
}

/** Plays one 2026 Easter transcript variant with the Easter Bunny as its owner NPC. */
function play(api, player, variant, npc = null, extra = {}) {
  if (!isActive() || !Array.isArray(SOURCE?.variants?.[variant])) return false;
  const npcId = Scene.npcId(api, Scene.BUNNY.symbol);
  if (npcId === null) return false;
  const previous = sessions.get(player);
  const session = { variant, npc, ...extra };
  sessions.set(player, session);
  const request = { player, npc, npcId, variant: { page: PAGE, variant }, exact: true };
  api.emitCustomEvent("npc-dialogue:start", request);
  if (!request.handled && !request.cancel) {
    if (previous) sessions.set(player, previous); else sessions.delete(player);
    return false;
  }
  session.cancel = request.cancel;
  return true;
}
function owned(api, event) {
  // Every hunt playback runs as the archived Easter Bunny; Archibald's own pet transcript
  // shares the page in the id index, so the actor id keeps a stale session out of it.
  const session = sessions.get(event.player);
  return session && event.npcId === Scene.npcId(api, Scene.BUNNY.symbol) && event.pages?.some(row => row.page === PAGE) ? session : null;
}
function cancelAll(api) {
  for (const player of api.core.World.getPlayers()) {
    const session = player && sessions.get(player);
    if (session) { session.cancel?.(); sessions.delete(player); }
  }
  lock?.cancelAll?.();
}
function clear({ player }) { sessions.delete(player); }

/**
 * Held items are the truth for the two physical hunt steps: an egg box or the runaway egg
 * that has gone (destroyed, incinerated, lost on death) sends the player back to find it.
 */
function reconcile(api, player) {
  const state = Progress.read(player);
  if (!state.started || state.complete) return state;
  let changed = false;
  if (state.caught && !heldAnywhere(api, player, "easter26_runaway_egg")) { state.caught = false; changed = true; }
  const box = state.box === Progress.BOX.LOCKED ? "easter26_second_location_egg_box" : state.box === Progress.BOX.DECOY ? "easter26_sixth_location_egg_box" : null;
  if (box && !heldAnywhere(api, player, box)) { state.box = Progress.BOX.NONE; changed = true; }
  if (changed) Progress.write(api, player, state);
  return state;
}
function bunnyVariant(api, player) {
  const state = reconcile(api, player);
  if (state.complete) return V.after;
  if (!state.started) return V.start;
  if (state.caught) {
    if (player.getInventory().getAmount(item(api, "easter26_runaway_egg")) < 1) return V.missing;
    return refused.has(player) ? V.unclaimed : V.complete;
  }
  if (state.note === 0) return V.unread;
  if (!heldAnywhere(api, player, "easter26_clue_stack")) return V.lost;
  return V.hint(state.note);
}
function talkToBunny(api, event) {
  if (!Scene.isNpc(api, event.npc, Scene.BUNNY.symbol) || event.clickType !== 1) return;
  event.handled = true;
  if (!isActive()) return;
  play(api, event.player, bunnyVariant(api, event.player), event.npc);
}
function catchArchibald(api, event) {
  if (!Scene.isNpc(api, event.npc, Scene.VAULT_EGG.symbol) || event.clickType !== 1) return;
  event.handled = true;
  const state = reconcile(api, event.player);
  // The parent NPC only morphs into the catchable Archibald while easter26_hunt_loc8 is set.
  if (!isActive() || Progress.target(state) !== Progress.LAST_NOTE) return;
  play(api, event.player, V.catch, event.npc);
}

/** Hunt scenery: Search only plays while this player's Archibald is at that location. */
function searchScenery(api, location, event) {
  if (!isActive()) return false;
  const state = reconcile(api, event.player);
  if (Progress.target(state) !== location) return false;
  event.handled = true;
  play(api, event.player, SEARCH_VARIANTS[location]);
  return true;
}
function searchTable(api, event) {
  if (!isActive()) return false;
  const state = Progress.read(event.player);
  if (!state.started) return play(api, event.player, V.tableEarly);
  if (state.note !== 0) return false;
  return play(api, event.player, V.table);
}
function openEggBox(api, symbol, event) {
  if (!isActive()) return;
  const state = Progress.read(event.player);
  if (symbol === "easter26_second_location_egg_box") {
    if (state.box !== Progress.BOX.LOCKED || state.note !== 2) return;
    lock.open(event.player);
  } else {
    if (state.box !== Progress.BOX.DECOY || state.note !== 6) return;
    play(api, event.player, V.decoy);
  }
}
function lockSolved(api, player) {
  const state = Progress.read(player);
  if (!isActive() || state.box !== Progress.BOX.LOCKED || state.note !== 2) return;
  play(api, player, V.boxRight);
}
function readNotes(api, event) {
  const { player } = event, state = Progress.read(player), c = api.core;
  if (!isActive() || !state.started || state.note < 1) return;
  const box = new c.DialogueChainBuilder();
  box.add(new c.ItemStatementDialogue(0, item(api, "easter26_clue_stack"), NOTE_TEXT[state.note]));
  player.getDialogueManager().startDialogues(box);
  if (!state.read) { state.read = true; Progress.write(api, player, state); }
}

/** Wiki transcript prose conditions, answered from this player's saved hunt. */
function condition(api, event) {
  const session = owned(api, event);
  if (!session) return;
  const { player } = event, state = Progress.read(player), text = String(event.text ?? "").toLowerCase();
  if (text === "if the player does not have both hands free:") return !handsFree(api, player);
  if (text === "if the player has no inventory space:") return player.getInventory().getFreeSlots() === 0;
  if (text === "if the player has not read the note yet:") return !state.read;
  if (text === "if the player has already read the note:") return state.read;
  if (text === "if the player isn't holding the scribbled notes:") return !hasNotes(api, player);
  if (text === "if the player is holding the scribbled notes:") return hasNotes(api, player);
  if (text === "if the player has insufficient inventory space:") {
    const short = Rewards.missingSlots(api, player) > 0;
    if (short) refused.add(player); else refused.delete(player);
    return short;
  }
  // No guessed truth for a condition this event does not define.
  return false;
}
function choice(api, event) {
  // A choice event carries no transcript pages; the playback session identifies it.
  const session = sessions.get(event.player);
  if (!session || session.variant !== V.start || session.npc !== event.npc || event.option !== "Yes.") return;
  const state = Progress.read(event.player);
  if (!isActive() || state.started) return;
  state.started = true;
  Progress.write(api, event.player, state);
}
// Message boxes that move the hunt on, keyed by their transcript text.
const ADVANCE = Object.freeze({
  "You pick up the note left by Archibald.": (api, player, state) =>
    state.note === 0 && give(api, player, "easter26_clue_stack") && note(state, 1),
  "As you reach for Archibald, he tumbles away. You pick up the note he left behind.": (api, player, state) =>
    Progress.target(state) === 1 && note(state, 2),
  "You find a wooden egg that needs to be unlocked.": (api, player, state) =>
    Progress.target(state) === 2 && give(api, player, "easter26_second_location_egg_box") && box(state, Progress.BOX.LOCKED),
  "You manage to open the egg and inside you find a note.": (api, player, state) =>
    state.box === Progress.BOX.LOCKED && take(api, player, "easter26_second_location_egg_box") && box(state, Progress.BOX.NONE) && note(state, 3),
  "You pick up the note left behind by Archibald after his escape.": (api, player, state) =>
    Progress.target(state) === 3 && note(state, 4),
  "You find Archibald, but before you could grab him, he tumbles away once more. You grab the note he left behind.": (api, player, state) =>
    Progress.target(state) === 4 && note(state, 5),
  "You find Archibald, but he swiftly tumbles out of your hands. You spot an anagram he left behind and pick it up.": (api, player, state) =>
    Progress.target(state) === 5 && note(state, 6),
  "You find a decoy egg.": (api, player, state) =>
    Progress.target(state) === 6 && give(api, player, "easter26_sixth_location_egg_box") && box(state, Progress.BOX.DECOY),
  "You open the egg and inside you find a note.": (api, player, state) =>
    state.box === Progress.BOX.DECOY && take(api, player, "easter26_sixth_location_egg_box") && box(state, Progress.BOX.NONE) && note(state, 7),
  "You find Archibald. You look away for a split second, but he's gone again. You grab the note he left behind.": (api, player, state) =>
    Progress.target(state) === 7 && note(state, 8),
});
function note(state, value) { state.note = value; state.read = false; return true; }
function box(state, value) { state.box = value; return true; }
function message(api, event) {
  const session = owned(api, event);
  if (!session || event.kind !== "message") return;
  const { player } = event, original = String(event.text ?? "");
  if ((session.variant === V.complete || session.variant === V.unclaimed) && original.startsWith("You need [1/2] more free inventory")) {
    const missing = Rewards.missingSlots(api, player);
    event.text = `You need ${missing} more free inventory ${missing === 1 ? "slot" : "slots"} to receive your Easter event rewards.`;
  }
  const advance = ADVANCE[original];
  if (advance) {
    const state = Progress.read(player);
    if (!isActive() || !advance(api, player, state)) { event.handled = true; event.end = true; return; }
    Progress.write(api, player, state);
  }
  if (NOTE_PICTURE.has(original)) event.box = { items: [item(api, "easter26_clue_stack")] };
  else if (BOX_PICTURE.has(original)) event.box = { items: [item(api, "easter26_second_location_egg_box")] };
  else event.box = { statement: true };
}
function action(api, event) {
  const session = owned(api, event);
  if (!session || event.kind === "message") return;
  if (event.text === "Archibald tips slowly off the wall") {
    api.emitCustomEvent("easter-events:church-fall", { player: event.player });
    event.handled = true;
  } else if (event.text === "Event completion screen pops up.") {
    event.handled = true;
    const rows = Rewards.claim(api, event.player);
    if (rows) session.scroll = rows; else event.end = true;
  }
}
function line(api, event) {
  const session = owned(api, event);
  if (!session) return;
  const { player } = event, original = String(event.text ?? "");
  let after = null;
  if (session.variant === V.lost && original === "Thats okay, I made some copies so here you go.") {
    after = () => give(api, player, "easter26_clue_stack");
  } else if (session.variant === V.catch && original === "Got you! You're not getting away this time!") {
    after = () => {
      const state = Progress.read(player);
      if (Progress.target(state) !== Progress.LAST_NOTE || !give(api, player, "easter26_runaway_egg")) return false;
      state.caught = true;
      Progress.write(api, player, state);
      return true;
    };
  } else if (session.scroll && original === "Archibald enjoyed your adventure so much that he'd like to travel with you.") {
    // The conversation's own close removes every interface, so the completion screen
    // opens on the next tick, after the Bunny's closing line.
    const rows = session.scroll;
    session.scroll = null;
    after = () => { Rewards.showNextTick(api, player, rows); return true; };
  }
  if (after) event.after = () => { if (!isActive() || !after()) sessions.get(player)?.cancel?.(); };
}
function dropOrDestroy(api, { player }) {
  // A destroyed egg box or runaway egg is found again where it was found last
  // (Wiki Egg box and Archibald, Destroy).
  reconcile(api, player);
}

function setLock(created) { lock = created; }
/** The wrong-code line ({{mes}}, a chat message, so it is not played as a box). */
function wrongCode() { return SOURCE.variants[V.boxWrong].find(step => step.type === "message").text; }

module.exports = {
  PAGE, V, NOTE_TEXT, activate, isActive, setLock, wrongCode, play, cancelAll, clear,
  talkToBunny, catchArchibald, searchScenery, searchTable, openEggBox, lockSolved, readNotes,
  condition, choice, message, action, line, dropOrDestroy, item, heldAnywhere,
};
