// Sailing crewmates: what recruiting, the Crew Registrar, the deck and the facilities share. The
// crewmates are data/sailing-crew.json joined with their cache row (table 173: the NPC that
// stands on the boat and the Helmsmanship/Privateering/Deckhandiness stats); varbits and
// messages follow rsprox captures (docs/sailing.md, Crewmates).
const DATA = require("../data/sailing-crew.json");

/** A player's crew (persisted): who they have met and recruited, the slots and their jobs. */
const CREW_ATTRIBUTE = "sailing:crew";
const MAX_SLOTS = 5;
const CREW_TABLE = 173;

/** `crew_stat_requirement`'s stat ids (tables 176 and 181) and the names messages give them. */
const STAT = Object.freeze({ HELMSMANSHIP: 1, PRIVATEERING: 2, DECKHANDINESS: 3 });
const STAT_NAMES = Object.freeze({ 1: "Helmsmanship", 2: "Privateering", 3: "Deckhandiness" });
const STAT_LETTERS = Object.freeze({ 1: "H", 2: "P", 3: "D" });

const VARBIT = Object.freeze({
  SELECTED_CREW: 18310, // sailing_crew_selected_crew_id: the registrar's recruits list
  SELECTED_SLOT: 18311, // sailing_crew_selected_slot_id: its crew list, from 0
  SLOT0: 19468, // sailing_crew_slot_1..5: a crewmate id, 0 empty
  SLOT0_POSITION: 19478, // sailing_crew_slot_1..5_position: where they work
  SIDEPANEL_SLOT0: 19243, // sailing_sidepanel_crew_slot_1..5: the crew aboard
  SIDEPANEL_SLOT0_POSITION: 19238,
  ON_DOCK: 19503, // sailing_crew_on_dock: the crewmate waiting on the docks
  ASSIGNATION: 19106, // sailing_sidepanel_crew_assignation: the sidepanel's crew picker
  ASSIGNATION_FACILITY: 19171, // ..._facility_viewed: the facility row it assigns to
  BUSY: 12393,
});

/**
 * Where a crewmate works (sailing_crew_slot_n_position), as client script 9031 numbers it:
 * the sails, the helm (or both, on a boat with combined navigation), hull repairs, and hotspot
 * n at 6 + n. Captured: 4 for a skiff's helm and sails, 10 for its hook on hotspot 4.
 */
const POSITION = Object.freeze({ IDLE: 0, SAILS: 2, HELM: 3, HELM_AND_SAILS: 4, REPAIRS: 5, HOTSPOT0: 6 });

/**
 * A crewmate's visibility varbit: at their recruit spot (not recruited), at the Pandemonium,
 * aboard the player's boat, or waiting on the docks (rsprox: Jenkins's control varbit is 3 there).
 */
const VISIBILITY = Object.freeze({ UNRECRUITED: 0, PANDEMONIUM: 1, ABOARD: 2, DOCK: 3 });

/** Tempoross kill count (varp 2934, kept by the Tempoross plugin). */
const VARP_TEMPOROSS_KILLS = 2934;

let core;
let crewmates;

function init(api) {
  core = api.core;
}

/**
 * The crewmates, each with their cache row's ship NPC, the forms they carry 1-3 courier crates in
 * (`cargo_npc`) and their stats.
 */
function all() {
  if (crewmates) return crewmates;
  const rows = core.CacheDefinitions.getDbTableRows(CREW_TABLE);
  const column = (name) => core.CacheDefinitions.getDbColumn(CREW_TABLE, name);
  const [uniqueId, boatNpc, cargoNpc, helm, privateering, deckhand] = ["unique_id", "boat_npc", "cargo_npc",
    "stat_helmsmanship", "stat_privateering", "stat_deckhandiness"].map(column);
  crewmates = DATA.crew.map((crew) => {
    const row = rows.find((candidate) => candidate.int(uniqueId, -1) === crew.id);
    return {
      ...crew,
      shipNpc: row?.int(boatNpc, -1) ?? -1,
      cargoNpcs: (cargoNpc === null ? [] : row?.column(cargoNpc) ?? []).map(Number),
      stats: {
        [STAT.HELMSMANSHIP]: row?.int(helm, 0) ?? 0,
        [STAT.PRIVATEERING]: row?.int(privateering, 0) ?? 0,
        [STAT.DECKHANDINESS]: row?.int(deckhand, 0) ?? 0,
      },
    };
  });
  return crewmates;
}

function byId(id) {
  return all().find((crew) => crew.id === id);
}

/** The crewmate an NPC id (any of its forms) belongs to, and which form: recruit, pandemonium, dock or ship. */
function byNpc(npcId) {
  for (const crew of all()) {
    const { npcs } = crew;
    if (npcId === npcs.dock) return { crew, at: "dock" };
    if (npcId === crew.shipNpc) return { crew, at: "ship" };
    if (crew.cargoNpcs.includes(npcId)) return { crew, at: "cargo" };
    if (npcId === npcs.recruitTalk || npcId === npcs.recruit) return { crew, at: "recruit" };
    if (npcId === npcs.pandemonium) return { crew, at: "pandemonium" };
    if (npcId === npcs.world) return { crew, at: "world" };
  }
  return undefined;
}

/** A crewmate's stat on a boat (its saved record): their own, raised by a keg of whirlpool surprise. */
function statOf(owned, crew, stat) {
  return require("../Kegs.Sailing").crewStat(owned, crew.stats[stat], stat);
}

/** "Jobless Jim (H2 P1 D3)" as the assignment menu titles them. */
function statLine(crew) {
  return Object.keys(STAT_LETTERS).map((stat) => `${STAT_LETTERS[stat]}${crew.stats[stat]}`).join(" ");
}

function state(player) {
  const saved = player.getAttribute(CREW_ATTRIBUTE) ?? {};
  const slots = Array.from({ length: MAX_SLOTS }, (_, slot) => Number(saved.slots?.[slot]) || 0);
  const positions = Array.from({ length: MAX_SLOTS }, (_, slot) => Number(saved.positions?.[slot]) || 0);
  return {
    met: Array.isArray(saved.met) ? saved.met : [],
    recruited: Array.isArray(saved.recruited) ? saved.recruited : [],
    slots,
    positions,
    onDock: saved.onDock === true,
  };
}

function save(player, crew) {
  player.setAttribute(CREW_ATTRIBUTE, crew);
}

/** Changes the saved crew, then sends the crew varbits (unless `send` is false). */
function update(player, change, send = true) {
  const crew = state(player);
  change(crew);
  save(player, crew);
  if (send) sendVarbits(player);
  return crew;
}

function isRecruited(player, id) {
  return state(player).recruited.includes(id);
}

function hasMet(player, id) {
  return state(player).met.includes(id);
}

function setMet(player, id) {
  if (hasMet(player, id)) return;
  update(player, (crew) => crew.met.push(id));
}

/** Crew slots unlocked: one at each "Maximum crewmates" level (Wiki: boosts don't count). */
function slotLimit(player) {
  const level = player.getSkillManager().getMaxLevel(core.Skill.SAILING);
  return DATA.slotLevels.filter((required) => level >= required).length;
}

function freeSlot(player) {
  const crew = state(player);
  for (let slot = 0; slot < slotLimit(player); slot++) if (!crew.slots[slot]) return slot;
  return -1;
}

/** The slot a crewmate is in, or -1. */
function slotOf(player, id) {
  return state(player).slots.indexOf(id);
}

function sailingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.SAILING);
}

function questComplete(player, key) {
  const request = { player, key, complete: false };
  core.PluginManager.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function diaryComplete(player, diary, tier) {
  const request = { player, diary, tier, complete: false };
  core.PluginManager.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function pandemoniumDone(player) {
  return questComplete(player, "pandemonium");
}

/** Everything a crewmate asks for: their Sailing level (boostable, Wiki), quests, diaries, Tempoross. */
function meetsRequirements(player, crew) {
  if (sailingLevel(player) < crew.level) return false;
  if ((crew.quests ?? []).some((key) => !questComplete(player, key))) return false;
  if ((crew.diaries ?? []).some(([diary, tier]) => !diaryComplete(player, diary, tier))) return false;
  const kills = player.getPacketSender().getVarp(VARP_TEMPOROSS_KILLS);
  return !crew.tempoross || kills >= crew.tempoross;
}

const GHOSTSPEAK = new Set([552, 4250]); // Ghostspeak amulet, and enchanted
const MORYTANIA_LEGS_2_UP = new Set([13113, 13114, 13115]);

/** Hearing ghosts: a ghostspeak amulet, or Morytania legs 2 or better (Wiki, Cabin Boy Jenkins). */
function hearsGhosts(player) {
  const equipment = player.getEquipment();
  const worn = (slot) => equipment.get(slot)?.getId?.();
  return GHOSTSPEAK.has(worn(core.Equipment.AMULET_SLOT)) || MORYTANIA_LEGS_2_UP.has(worn(core.Equipment.LEG_SLOT));
}

/**
 * Recruits a crewmate. One who "heads off in search of your boat" takes the first free slot;
 * one who "departs for the Pandemonium" (no slot free, or as their transcript has it) waits there.
 * Returns the slot taken, or -1.
 */
function recruit(player, crew, toBoat) {
  let taken = -1;
  // Where they stand changes as they leave, once the screen has faded (Recruit.Crew.js).
  update(player, (state) => {
    if (!state.recruited.includes(crew.id)) state.recruited.push(crew.id);
    if (!state.met.includes(crew.id)) state.met.push(crew.id);
    if (!toBoat || state.slots.includes(crew.id)) return;
    for (let slot = 0; slot < slotLimit(player); slot++) {
      if (state.slots[slot]) continue;
      state.slots[slot] = crew.id;
      state.positions[slot] = POSITION.IDLE;
      taken = slot;
      return;
    }
  }, false);
  const sender = player.getPacketSender();
  sender.sendVarbit(crew.varbits.unlocked, 1);
  if (taken >= 0) sender.sendVarbit(VARBIT.SLOT0 + taken, crew.id);
  return taken;
}

/**
 * Walks a crewmate to a deck tile, running to a job (rsprox: two steps a tick on their way to a
 * facility; wandering, one). Their home moves there first: a crewmate spawns with no wander
 * radius, and the movement coordinator walks an NPC off its home straight back to it.
 */
function walkTo(npc, x, y, { run = false } = {}) {
  const { Location, PathFinder } = core;
  npc.setSpawnPosition(new Location(x, y, npc.getLocation().getZ()));
  npc.setMovementSteps(run ? 2 : 1);
  PathFinder.calculateWalkRoute(npc, x, y);
}

/** Puts a crewmate on a deck tile at once (a walk that couldn't get there), home included. */
function placeAt(npc, location) {
  npc.setSpawnPosition(location);
  npc.moveTo(location);
}

/** Crew aboard each boat, per slot: { crew, npc, position } (Deck.Crew.js keeps it). */
const aboard = new Map();

function crewAboard(boat) {
  return aboard.get(boat) ?? [];
}

function setCrewAboard(boat, members) {
  if (members.length) aboard.set(boat, members);
  else aboard.delete(boat);
}

/** The crewmate aboard an NPC belongs to, with their boat. */
function memberFor(npc) {
  for (const [boat, members] of aboard) {
    const member = members.find((candidate) => candidate.npc === npc);
    if (member) return { boat, member };
  }
  return undefined;
}

function visibilityOf(player, crew, state) {
  if (!state.recruited.includes(crew.id)) return VISIBILITY.UNRECRUITED;
  const boat = core.Sailing.instanceAboard(player);
  if (boat && crewAboard(boat).some((member) => member.crew === crew)) return VISIBILITY.ABOARD;
  if (state.onDock && state.slots[0] === crew.id && !boat) return VISIBILITY.DOCK;
  return VISIBILITY.PANDEMONIUM;
}

/** Sends every crew varbit: who is met and recruited and where they are, and the crew slots. */
function sendVarbits(player) {
  const crew = state(player);
  const sender = player.getPacketSender();
  for (const member of all()) {
    const { varbits } = member;
    if (varbits.met) sender.sendVarbit(varbits.met, crew.met.includes(member.id) ? 1 : 0);
    sender.sendVarbit(varbits.unlocked, crew.recruited.includes(member.id) ? 1 : 0);
    sender.sendVarbit(varbits.visibility, visibilityOf(player, member, crew));
    // Jenkins haunts Crandor until recruited.
    if (varbits.recruitVisibility) sender.sendVarbit(varbits.recruitVisibility, crew.recruited.includes(member.id) ? 0 : 1);
  }
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    sender.sendVarbit(VARBIT.SLOT0 + slot, crew.slots[slot]);
    sender.sendVarbit(VARBIT.SLOT0_POSITION + slot, crew.positions[slot]);
  }
  const ashore = !core.Sailing.instanceAboard(player);
  sender.sendVarbit(VARBIT.ON_DOCK, crew.onDock && ashore ? crew.slots[0] : 0);
}

module.exports = {
  DATA,
  CREW_ATTRIBUTE,
  MAX_SLOTS,
  STAT,
  STAT_NAMES,
  VARBIT,
  POSITION,
  VISIBILITY,
  init,
  core: () => core,
  all,
  byId,
  byNpc,
  statLine,
  statOf,
  state,
  update,
  isRecruited,
  hasMet,
  setMet,
  slotLimit,
  freeSlot,
  slotOf,
  sailingLevel,
  questComplete,
  pandemoniumDone,
  meetsRequirements,
  hearsGhosts,
  recruit,
  walkTo,
  placeAt,
  crewAboard,
  setCrewAboard,
  memberFor,
  sendVarbits,
};
