// Spawn offsets/ticks: RSProx 235/940,944,948,3467,3837. Actors belong to the current boat.
const common = require("./Common.Charting");
const revival = require("./CorpseRevival.Charting");
const { removeDeckNpc } = require("../SailingContent.Sailing");
const effects = new Map();
const IMMEDIATE = new Set(["drink_crate_platinum_rum", "drink_crate_wild_whisky", "drink_crate_sailing_cat"]);
const PASSIVE = new Set(["drink_crate_platinum_rum", "drink_crate_wild_whisky", "drink_crate_sailing_cat"]);
const DWARF_COUNT = 7;
const DWARF_INTERVAL = 2;

function introduction(npc) {
  const data = require("../../../quests/QuestRuntime").loadTranscripts(common.api());
  const variants = data[npc.getCurrentDefinition().getName()]?.variants;
  for (const key of ["upon-spawning-in", "upon-appearing", "when-spawned-or-regenerated", "upon-entering-the-arena"]) {
    const line = variants?.[key]?.find(step => step.presentation === "overhead" && typeof step.npc === "string");
    if (line) { npc.forceChat(line.npc); return; }
  }
}

function alive(state) {
  const { BoatManager } = common.core();
  return effects.get(state.player)?.get(state.key) === state && state.player.isRegistered()
    && BoatManager.getBoatAboard(state.player) === state.boat
    && BoatManager.getBoat(state.boat.entityIndex) === state.boat && state.boat.teleportCount === state.teleportCount;
}
function clear(state) {
  effects.get(state.player)?.delete(state.key);
  common.core().TaskManager.cancelTasks(state);
  for (const npc of state.npcs) {
    removeDeckNpc(common.api(), state.boat, npc);
  }
  state.npcs.clear();
  state.corpse = null;
  if (!effects.get(state.player)?.size) effects.delete(state.player);
}
function cleanup({ player, boat }) {
  for (const state of [...(effects.get(player)?.values() ?? [])]) {
    if (!boat || state.boat === boat) clear(state);
  }
}
function later(state, ticks, callback) {
  const { CountdownTask, TaskManager } = common.core();
  TaskManager.submit(new CountdownTask(state, ticks, () => {
    if (!alive(state)) return clear(state);
    callback();
  }));
}
function actor(state, gameval, sea = false) {
  const { BoatManager, NPC } = common.core();
  const deck = BoatManager.getDeck(state.boat);
  if (!deck) return null;
  const here = sea ? BoatManager.rootLocation(state.player) : state.player.getLocation();
  const npc = common.api().spawnNpc({
    id: common.core().CacheDefinitions.getNpcId(gameval),
    x: here.getX() + (sea ? -6 : 0), y: here.getY() + (sea ? 4 : 0), z: here.getZ(),
    owner: state.player, ownerOnly: true, wanderRadius: 0,
  });
  if (!npc) return null;
  npc.setFlag(NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  if (!sea) deck.enter(npc);
  state.npcs.add(npc);
  revival.configure(state, npc);
  if (state.key === "drink_crate_fish_stoutier") {
    // Wiki Dinky says 51+; 51 is an authorized provisional ceiling, not a verified maximum.
    npc.setCombatOverride({ maxHit: 51 });
  }
  introduction(npc);
  if (!PASSIVE.has(state.key)) {
    if (sea) common.api().emitCustomEvent("sea-combat:creature-attacked", { player: state.player, npc });
    else npc.getCombat().attack(state.player);
  }
  return npc;
}
function dwarf(state, index) {
  const { CacheDefinitions, Item, Animation } = common.core();
  const npc = actor(state, state.spot.drink.effect);
  if (!npc) return clear(state);
  npc.performAnimation(new Animation(CacheDefinitions.getSeqId("dwarf_drunkwave")));
  // Wiki Drunken Dwarf (Sea charting): one beer or kebab, equal probability, per dwarf.
  const gift = new Item(CacheDefinitions.getObjId(Math.random() < 0.5 ? "beer" : "kebab"), 1);
  if (state.player.getInventory().getAddableAmount(gift) === 1) state.player.getInventory().add(gift, true);
  later(state, DWARF_INTERVAL, () => {
    removeDeckNpc(common.api(), state.boat, npc);
    state.npcs.delete(npc);
    if (index + 1 < DWARF_COUNT) dwarf(state, index + 1);
    else {
      state.player.sendMessage("They seem to have exhausted themselves now.");
      clear(state);
    }
  });
}
function spawn(state) {
  state.started = true;
  if (state.key === "drink_crate_platinum_rum") return dwarf(state, 0);
  if (state.key === "drink_crate_wild_whisky") {
    for (const animal of ["squirrel", "racoon", "chinchompa"]) actor(state, `sailing_charting_drink_crate_wild_whisky_effect_${animal}`);
  } else actor(state, state.spot.drink.effect, state.key === "drink_crate_monkfish_stout");
}
function start(player, spot) {
  if (!spot.drink?.effect) return;
  const { BoatManager, Task, TaskManager } = common.core();
  const boat = BoatManager.getBoatAboard(player);
  if (!boat) return;
  const previous = effects.get(player)?.get(spot.key);
  if (previous) clear(previous);
  const state = { player, boat, spot, key: spot.key, teleportCount: boat.teleportCount, npcs: new Set() };
  if (!effects.has(player)) effects.set(player, new Map());
  effects.get(player).set(spot.key, state);
  if (IMMEDIATE.has(spot.key)) spawn(state);
  else later(state, 1, () => spawn(state));
  // Only this owned effect is examined; no global player-process polling.
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, state, false); }
    execute() {
      if (!alive(state)) { clear(state); return this.stop(); }
      for (const npc of state.npcs) if (!npc.isRegistered()) state.npcs.delete(npc);
      if (state.started && state.npcs.size === 0) { clear(state); this.stop(); }
    }
  })());
}
function attach(api) {
  common.init(api);
  api.onPlayerLogout(cleanup);
  api.onCustomEvent("sailing:left", cleanup);
  revival.attach(api);
}
module.exports = { attach, start, effects, introduction, alive };
