"use strict";

// Rules: Wiki Golem crafting, Golem (sunstone), Sunstone core (13 November 2026).
// Native station/rubble variables and sequences: pinned revision 242 gamevals.
const STATE_ATTRIBUTE = "golem-crafting:stations";
const COUNT_ATTRIBUTE = "golem-crafting:completed";
const SIDES = ["north", "east", "south", "west"];
const LEVEL = 60;
const STROKES = 5;
const STROKE_TICKS = 4;
const BASE_XP = 1560;
const ACTIVE_TICKS = 30;
const FURS = [
  ["MOONLIGHT_ANTELOPE_FUR", 1200], ["SUNLIGHT_ANTELOPE_FUR", 1180],
  ["DASHING_KEBBIT_FUR", 1160], ["KYATT_FUR", 1140], ["DARK_KEBBIT_FUR", 1140],
  ["FOX_FUR", 1120], ["SPOTTED_KEBBIT_FUR", 1100], ["GRAAHK_FUR", 1080],
  ["LARUPIA_FUR", 1060], ["FELDIP_WEASEL_FUR", 1030], ["COMMON_KEBBIT_FUR", 1000],
  ["DESERT_DEVIL_FUR", 960], ["POLAR_KEBBIT_FUR", 920], ["WYRMSCRAIG_GOAT_FUR", 880],
];
const STATIONS = [[2596, 2257], [2595, 2253]];
let api, core;
const works = new WeakMap();
const clocks = new WeakMap();
const active = new WeakMap();

function required(id, name) {
  if (!Number.isInteger(id) || id < 0) throw new Error(`Golem crafting: missing cache ${name}`);
  return id;
}
function bit(name) { return required(core.CacheDefinitions.getVarbitId(name), name); }
function loc(name) { return required(core.CacheDefinitions.getLocId(name), name); }
function seq(name) { return required(core.CacheDefinitions.getSeqId(name), name); }
function item(name) { return required(core.ItemIdentifiers[name], name); }
function state(player, station) {
  let all = player.getAttribute(STATE_ATTRIBUTE);
  if (!all) { all = {}; player.setAttribute(STATE_ATTRIBUTE, all); }
  return all[station] ??= { started: false, progress: [0, 0, 0, 0] };
}
function stage(s) { return s.started ? 1 + s.progress.filter(n => n === STROKES).length : 0; }
function stationOf(object) {
  const id = object.getId();
  const p = object.getLocation();
  if (p.getZ() !== 0) return null;
  for (const n of [1, 2]) if (id === loc(`golem_station_${n}`)) return n;
  if (!["golem_station_empty", "golem_station_base", "golem_station_shaped_1",
    "golem_station_shaped_2", "golem_station_shaped_3", "golem_station_shaped_4"].some(n => id === loc(n))) return null;
  for (const n of [1, 2]) {
    if (core.MapObjects.get(loc(`golem_station_${n}`), p, object.getPrivateArea())) return n;
  }
  return null;
}
function sync(player, n) {
  const s = state(player, n), sender = player.getPacketSender();
  sender.sendVarbit(bit(`golem_crafting_station_${n}`), stage(s));
  SIDES.forEach((side, index) => {
    sender.sendVarbit(bit(`golem_crafting_station_${n}_${side}`), s.progress[index] === STROKES ? 1 : 0);
    sender.sendVarbit(bit(`golem_${n}_${side}_progress`), s.progress[index]);
  });
  // Like Farming, refresh the real map locs after changing their private transforms.
  // The Wiki supplies the two tiles, not which cache root owns which tile.
  // Resolve that association from the real map before refreshing its geometry.
  const origin = STATIONS.map(([x, y]) => new core.Location(x, y, 0)).find(p =>
    player.getLocation().isWithinDistance(p, 32)
      && core.MapObjects.get(loc(`golem_station_${n}`), p, player.getPrivateArea()));
  if (!origin) return;
  const cx = origin.getX(), cy = origin.getY();
  const ids = new Set([loc(`golem_station_${n}`), ...SIDES.map(side => loc(`golem_rubble_${side}_${n}`))]);
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
    for (const object of core.MapObjects.getObjectsAt(new core.Location(x, y, 0), player.getPrivateArea())) if (ids.has(object.getId())) {
      sender.sendObjectRemoval(object);
      sender.sendObject(object);
    }
  }
}
function gate(player, tell = true) {
  const q = { player, key: "fallen_from_grace", complete: false };
  api.emitCustomEvent("quest:is-complete", q);
  let refusal = null;
  if (!q.complete) refusal = "You must complete Fallen From Grace to craft golems.";
  else if (player.getSkillManager().getMaxLevel(core.Skill.CRAFTING) < LEVEL
    || player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING) < LEVEL) refusal = "You need a Crafting level of 60 to craft golems.";
  else if (!["CHISEL", "JEWELLERS_CHISEL"].some(name => player.getInventory().contains(item(name)))) refusal = "You need a chisel to craft golems.";
  else if (!["HAMMER", "IMCANDO_HAMMER", "IMCANDO_HAMMER_OFF_HAND_"].some(name => {
    const id = core.ItemIdentifiers[name];
    return Number.isInteger(id) && (player.getInventory().contains(id) || player.getEquipment().contains(id));
  })) refusal = "You need a hammer to craft golems.";
  if (refusal && tell) player.sendMessage(refusal);
  return !refusal && !player.busy() && player.getHitpoints() > 0;
}
function sideOf(player, object) {
  const p = player.getLocation(), o = object.getLocation();
  if (p.getZ() !== o.getZ()) return -1;
  const dx = p.getX() - o.getX(), dy = p.getY() - o.getY();
  if (dx === 0 && dy === 1) return 0;
  if (dx === 1 && dy === 0) return 1;
  if (dx === 0 && dy === -1) return 2;
  if (dx === -1 && dy === 0) return 3;
  return -1;
}
function cancel({ player }) { works.delete(player); }
function worldInput({ player, packet }) {
  const w = works.get(player);
  if (w && packet?.type === "object_option" && packet.clickType === 1
    && packet.x === w.object.getLocation().getX() && packet.y === w.object.getLocation().getY()
    && sideOf(player, w.object) === w.side
    && (packet.id === w.object.getId() || packet.id === core.ObjectDefinition.forPlayer(w.object.getId(), player)?.id)) return;
  cancel({ player });
}
function start(player, n) {
  const s = state(player, n);
  if (s.started) return;
  if (active.get(player)?.some(entry => entry.station === n)) {
    player.sendMessage("You need to wait for the previous golem to clear the station."); return;
  }
  if (player.getInventory().getAmount(item("SUNSTONE")) < 4) {
    player.sendMessage("You need four sunstones to start a golem."); return;
  }
  player.getInventory().deleteNumber(item("SUNSTONE"), 4);
  s.started = true;
  sync(player, n);
}
function shape(player, object, n) {
  const s = state(player, n), side = sideOf(player, object);
  if (!s.started || side < 0) return;
  if (s.progress[side] === STROKES) {
    player.sendMessage("You have already shaped this side of the golem."); return;
  }
  works.set(player, { station: n, side, object, origin: player.getLocation().clone(),
    due: (clocks.get(player) ?? 0) + STROKE_TICKS });
  player.setPositionToFace(object.getLocation());
  player.performAnimation(new core.Animation(seq("human_golem_chisel")));
}
function furAmount(player, id) {
  const request = { player, itemId: id, amount: 0 };
  api.emitCustomEvent("storage:amount", request);
  return player.getInventory().getAmount(id) + request.amount;
}
function takeFur(player, id) {
  if (player.getInventory().contains(id)) player.getInventory().deleteNumber(id, 1);
  else {
    const request = { player, itemId: id, amount: 1, taken: 0 };
    api.emitCustomEvent("storage:take", request);
    if (request.taken !== 1) throw new Error("Golem crafting: validated fur debit failed");
  }
}
function rewardId() {
  if (Math.random() < 1 / 300) return item("JEWELLERS_CHISEL");
  const roll = Math.floor(Math.random() * 23);
  return item(roll < 15 ? "UNCUT_SAPPHIRE" : roll < 20 ? "UNCUT_EMERALD" : roll < 22 ? "UNCUT_RUBY" : "UNCUT_DIAMOND");
}
function finish(player, object, n) {
  const s = state(player, n);
  if (stage(s) !== 5) { player.sendMessage("You must shape all four sides of the golem first."); return; }
  // A loc's quarter-turn rotates the model's south-facing front with it.
  const front = [2, 3, 0, 1][object.getFace() & 3];
  if (sideOf(player, object) !== front) {
    player.sendMessage("You can't insert the core from this side of the golem."); return;
  }
  if (!player.getInventory().contains(item("SUNSTONE_CORE"))) {
    player.sendMessage("You need a sunstone core to power the golem."); return;
  }
  const fur = FURS.find(([name]) => furAmount(player, item(name)) > 0);
  if (!fur) { player.sendMessage("You need a suitable hunter fur to complete the golem."); return; }
  const npc = api.spawnNpc({ id: required(core.NpcIdentifiers.GOLEM_4, "sunstone golem"),
    x: object.getLocation().getX(), y: object.getLocation().getY(), z: 0,
    owner: player, ownerOnly: true, wanderRadius: 0 });
  if (!npc) throw new Error("Golem crafting: could not create completed golem");
  npc.__skipDefaultRespawn = true;
  npc.performAnimation(new core.Animation(seq("human_golem_activate")));
  player.getInventory().deleteNumber(item("SUNSTONE_CORE"), 1);
  takeFur(player, item(fur[0]));
  // The published aggregate is established; the per-stroke split is unverified.
  // Defer the full base award to completion so saved/repeated strokes cannot duplicate XP.
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, BASE_XP + fur[1]);
  const reward = rewardId(), gather = { player, itemId: reward, amount: 1, stored: 0, announce: true };
  api.emitCustomEvent("storage:gather", gather);
  if (!gather.stored) {
    core.ItemOnGroundManager.registers(player, new core.Item(reward, 1));
    player.sendMessage("The golem leaves a gift for you on the ground.");
  }
  const count = (Number(player.getAttribute(COUNT_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(COUNT_ATTRIBUTE, count);
  player.getPacketSender().sendVarbit(bit("golem_crafting_count"), Math.min(65535, count));
  player.sendMessage(`You have crafted ${count} sunstone golem${count === 1 ? "" : "s"}.`);
  s.started = false; s.progress = [0, 0, 0, 0];
  sync(player, n);
  const entries = active.get(player) ?? [];
  entries.push({ station: n, npc, until: (clocks.get(player) ?? 0) + ACTIVE_TICKS });
  active.set(player, entries);
  api.emitCustomEvent("persistence:save", { player, reason: "golem-crafting" });
}
function interact(event) {
  const n = stationOf(event.object);
  if (!n) return;
  event.handled = true;
  const { player } = event;
  if (!gate(player) || sideOf(player, event.object) < 0) { cancel(event); return; }
  const s = state(player, n);
  const w = works.get(player);
  if (w?.station === n && w.side === sideOf(player, event.object)) return;
  cancel(event);
  if (!s.started) start(player, n);
  else if (stage(s) === 5) finish(player, event.object, n);
  else shape(player, event.object, n);
}
function process(player) {
  const tick = (clocks.get(player) ?? 0) + 1;
  clocks.set(player, tick);
  const w = works.get(player);
  if (w) {
    if (!player.getLocation().equals(w.origin) || !gate(player, false)) cancel({ player });
    else if (tick >= w.due) {
      const s = state(player, w.station);
      s.progress[w.side] = Math.min(STROKES, s.progress[w.side] + 1);
      sync(player, w.station);
      if (s.progress[w.side] === STROKES) {
        cancel({ player });
        player.performAnimation(new core.Animation(seq("human_golem_chisel_end")));
      } else {
        w.due = tick + STROKE_TICKS;
        player.performAnimation(new core.Animation(seq("human_golem_chisel")));
      }
    }
  }
  const entries = active.get(player) ?? [];
  for (const entry of entries) if (tick >= entry.until) api.removeNpc(entry.npc);
  active.set(player, entries.filter(entry => tick < entry.until));
}
function cleanup({ player }) {
  cancel({ player });
  for (const entry of active.get(player) ?? []) api.removeNpc(entry.npc);
  active.delete(player);
  clocks.delete(player);
}
function login({ player }) {
  player.getPacketSender().sendVarbit(bit("golem_crafting_count"), Math.min(65535, Number(player.getAttribute(COUNT_ATTRIBUTE)) || 0));
  for (const n of [1, 2]) sync(player, n);
}
function startup() {
  // Resolve required definitions before a player can spend materials.
  for (const n of [1, 2]) {
    loc(`golem_station_${n}`); bit(`golem_crafting_station_${n}`);
    SIDES.forEach(side => { bit(`golem_${n}_${side}_progress`); bit(`golem_crafting_station_${n}_${side}`); });
  }
  const { Area, Boundary } = core;
  class GolemCraftingArea extends Area {
    process(mobile) { if (mobile.isPlayer()) process(mobile.getAsPlayer()); }
    postEnter(mobile) { if (mobile.isPlayer()) login({ player: mobile.getAsPlayer() }); }
    postLeave(mobile) { if (mobile.isPlayer()) cleanup({ player: mobile.getAsPlayer() }); }
  }
  api.registerArea(new GolemCraftingArea([new Boundary(2591, 2601, 2249, 2261, 0)]));
}
function attach(value) {
  api = value; core = value.core;
  api.persistAttribute(STATE_ATTRIBUTE, {});
  api.persistAttribute(COUNT_ATTRIBUTE, 0);
  api.onServerStartup(startup);
  api.onObjectInteraction("Empty plinth", { "Start-golem": interact });
  api.onObjectInteraction("Golem base", { "Shape-golem": interact });
  api.onObjectInteraction("Unfinished golem", { "Shape-golem": interact });
  api.onObjectInteraction("Unpowered golem", { "Insert-core": interact });
  api.onCustomEvent("player:world-input", worldInput);
  api.onPlayerLogin(login);
  api.onPlayerLogout(cleanup);
  api.onPlayerDisconnect(cleanup);
}

module.exports = { attach };
