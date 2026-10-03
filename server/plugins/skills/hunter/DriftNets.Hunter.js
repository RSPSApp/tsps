"use strict";

const C = require("./Context.Hunter"), { H } = C;
const ATTRIBUTE = "hunter.drift-nets";
const bases = new Map(), sessions = new Map(), chasing = new Map();
let Area;

function state(player) {
  let s = player.getAttribute(ATTRIBUTE);
  if (!s || typeof s !== "object" || Array.isArray(s)) player.setAttribute(ATTRIBUTE, s = { nets: {}, stored: 0, until: 0 });
  return s;
}

function initialize() {
  bases.clear();
  for (let id = 0; id < H.core.CacheDefinitions.getCounts().objects; id++) {
    const d = H.core.CacheDefinitions.getObject(id);
    if (d.transforms?.[0] === H.core.ObjectIdentifiers.DRIFT_NET_ANCHORS) bases.set(id, d);
  }
}

function permitted(player) {
  const m = player.getSkillManager();
  return m.getMaxLevel(H.core.Skill.HUNTER) >= 44
    && m.getMaxLevel(H.core.Skill.FISHING) >= 47
    && C.questComplete(player, "bone_voyage");
}

function enter(player) {
  if (!permitted(player)) { player.sendMessage("You need Bone Voyage, 44 Hunter and 47 Fishing to enter."); return; }
  if (state(player).until !== -1 && state(player).until <= Date.now()) { player.sendMessage("Pay Ceto for access first."); return; }
  cleanup({ player });
  Area ??= class extends H.core.PrivateArea {
    constructor() { super([new H.core.Boundary(3730, 3752, 10285, 10305, 1)]); }
    postLeave(m, logout) {
      super.postLeave(m, logout);
      if (sessions.get(m)?.area === this) sessions.delete(m);
    }
  };
  const area = new Area();
  area.enter(player);
  player.moveTo(new H.core.Location(3731, 10293, 1));
  H.core.RegionManager.loadMapFiles(3740, 10295);
  for (const rows of H.core.MapObjects.mapObjects.values()) {
    for (const o of rows) {
      const l = o.getLocation();
      if (l.getZ() !== 1 || l.getX() < 3730 || l.getX() > 3752 || l.getY() < 10285 || l.getY() > 10305) continue;
      const clone = new H.core.GameObject(o.getId(), l.clone(), o.getType(), o.getFace(), area);
      area.add(clone);
      H.core.ObjectManager.register(clone, true);
    }
  }
  const npcs = [];
  for (const [x, y] of [[3737,10299],[3738,10297],[3738,10300],[3739,10292],[3739,10295],[3741,10292],
    [3741,10299],[3742,10290],[3744,10300],[3747,10300],[3748,10298]]) {
    const npc = H.api.spawnNpc({ id: H.core.NpcIdentifiers.FISH_SHOAL, x, y, z: 1, wanderRadius: 3 });
    if (npc) { area.add(npc); npcs.push(npc); }
  }
  sessions.set(player, { area, npcs });
  H.players.add(player);
  sync({ player });
}

function pay({ player, npc }) {
  if (!C.nearby(player, npc)) return true;
  C.choose(player, [["Enter drift net fishing", () => enter(player)],
    ["Pay 200 numulite for today", () => purchase(player, 200)],
    ["Pay 20,000 numulite for permanent access", () => purchase(player, 20000)]], npc);
  return true;
}

function purchase(player, cost) {
  if (!permitted(player)) return;
  if (state(player).until === -1) { enter(player); return; }
  if (!C.exchange(player, [[H.core.ItemIdentifiers.NUMULITE, cost]], [])) return;
  state(player).until = cost === 20000 ? -1 : (Math.floor(Date.now() / 86400000) + 1) * 86400000;
  enter(player);
}

function login({ player }) {
  const l = player.getLocation();
  if (l.getZ() === 1 && l.getX() >= 3730 && l.getX() <= 3752 && l.getY() >= 10285 && l.getY() <= 10305) {
    if (permitted(player) && (state(player).until === -1 || state(player).until > Date.now())) enter(player);
    else player.moveTo(new H.core.Location(3728, 10293, 1));
  }
  sync({ player });
}

function sync({ player }) {
  for (const [id, d] of bases) {
    const net = state(player).nets[id];
    player.getPacketSender().sendVarbit(d.transformVarbit, !net ? 0 : net.count >= 10 ? 3 : net.count ? 2 : 1);
  }
}

// XP scales to level 70 in both skills; level 44 Hunter/47 Fishing pay 52.3/46.2.
function experience(level, hunter) {
  const l = Math.min(70, level);
  return Math.floor((hunter ? l * l / 100 + 0.75 * l : l * l / 200 + 0.75 * l) * 10) / 10;
}

function anchor(player, id) {
  return sessions.get(player)?.area.getObjects().find(object => object.getId() === Number(id));
}

function setup({ player, object }) {
  const id = object.getId();
  if (!bases.has(id)) return false;
  if (!sessions.has(player) || !permitted(player) || !C.nearby(player, object) || state(player).nets[id]) return true;
  C.begin(player, 2, C.ANIM.NET, () => {
    const s = state(player);
    if (s.nets[id] || !sessions.has(player) || !permitted(player)) return;
    if (s.stored > 0) s.stored--;
    else if (!C.exchange(player, [[H.core.ItemIdentifiers.DRIFT_NET, 1]], [])) return;
    s.nets[id] = { count: 0, last: Date.now() };
    H.players.add(player);
    sync({ player });
  });
  return true;
}

function capture(player, net, active) {
  if (net.count >= 10 || net.rewards) return;
  net.count++;
  net.last = Date.now();
  const m = player.getSkillManager();
  m.addExperiences(H.core.Skill.FISHING, experience(m.getMaxLevel(H.core.Skill.FISHING), false));
  if (active) C.xp(player, experience(m.getMaxLevel(H.core.Skill.HUNTER), true), "drift-net");
  if (net.count === 10) player.sendMessage("Your drift net is full.");
  sync({ player });
}

function nearAnchor(npc, location) {
  const here = npc.getLocation();
  return here.getZ() === location.getZ()
    && Math.max(Math.abs(here.getX() - location.getX()), Math.abs(here.getY() - location.getY())) <= 1;
}

// ponytail: Wiki does not publish scare odds or passive timing; both are explicit
// approximations. A successful scare sends the shoal swimming to the nearest net.
function chase({ player, npc, npcId }) {
  if (npcId !== H.core.NpcIdentifiers.FISH_SHOAL) return false;
  if (!sessions.has(player) || !C.nearby(player, npc, 5) || !C.available(npc) || !permitted(player)) return true;
  const nets = state(player).nets, position = npc.getLocation();
  const netEntry = Object.entries(nets)
    .filter(([, net]) => net.count < 10 && !net.rewards)
    .sort(([a], [b]) => {
      const pa = anchor(player, a)?.getLocation() ?? position, pb = anchor(player, b)?.getLocation() ?? position;
      return C.distance(pa, position) - C.distance(pb, position);
    })[0];
  if (!netEntry) {
    player.sendMessage(Object.values(nets).some(net => net.count >= 10)
      ? "All of your drift nets are full." : "Set an empty drift net before chasing fish.");
    return true;
  }
  const [id, net] = netEntry, token = { player };
  H.reserved.set(npc, token);
  const cancel = () => { if (H.reserved.get(npc) === token) H.reserved.delete(npc); };
  if (!C.begin(player, 2, C.ANIM.NET, () => {
    cancel();
    if (state(player).nets[id] !== net || net.count >= 10 || net.rewards || !sessions.has(player)
      || !C.available(npc) || !C.nearby(player, npc, 5) || !permitted(player)) return;
    const I = H.core.ItemIdentifiers;
    const weapon = player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId();
    if (Math.random() >= ([I.MERFOLK_TRIDENT, I.TRIDENT_OF_THE_SEAS, I.TRIDENT_OF_THE_SWAMP, I.DRAGON_HARPOON].includes(weapon) ? 0.8 : 0.5)) {
      player.sendMessage("The fish shoal evades you.");
      return;
    }
    const target = anchor(player, id);
    if (target) H.core.PathFinder.calculateWalkRoute(npc, target.getLocation().getX(), target.getLocation().getY());
    chasing.set(npc, { player, id, net, due: H.tick + 30 });
    player.sendMessage("You scare the fish shoal towards your drift net.");
  }, cancel)) cancel();
  return true;
}

function fossil(factor = 3, max = 14) {
  const I = H.core.ItemIdentifiers, draw = Math.random();
  let cumulative = 9 * factor / 175;
  if (draw < cumulative) return [I.NUMULITE, C.roll(5, max)];
  for (const [id, divisor] of [[I.UNIDENTIFIED_SMALL_FOSSIL, 350], [I.UNIDENTIFIED_MEDIUM_FOSSIL, 700],
    [I.UNIDENTIFIED_LARGE_FOSSIL, 875], [I.UNIDENTIFIED_RARE_FOSSIL, 3500]]) {
    cumulative += factor / divisor;
    if (draw < cumulative) return [id, 1];
  }
  return null;
}

function rewards(player, count) {
  const I = H.core.ItemIdentifiers, l = player.getSkillManager().getMaxLevel(H.core.Skill.FISHING);
  const fish = [I.OYSTER, I.PUFFERFISH, I.RAW_ANCHOVIES, I.RAW_SARDINE, I.RAW_TUNA];
  for (const [min, id] of [[50, I.RAW_LOBSTER], [60, I.RAW_SWORDFISH], [70, I.RAW_SHARK],
    [80, I.RAW_SEA_TURTLE], [90, I.RAW_MANTA_RAY]]) if (l >= min) fish.push(id);
  const result = [];
  for (let i = 0; i < count; i++) {
    if (C.roll(1, 25) === 1) { const f = fossil(); if (f) result.push(f); }
    else if (C.roll(1, 600) === 1 && !C.ownsClue(player, "MEDIUM") && !result.some(([id]) => id === I.CLUE_BOTTLE_MEDIUM_)) result.push([I.CLUE_BOTTLE_MEDIUM_, 1]);
    else result.push([fish[C.roll(0, fish.length - 1)], 1]);
  }
  return result;
}

function bank(player, items) {
  const plan = new Map();
  for (const [id, n] of items) {
    const tab = H.core.Bank.getTabForItem(player, id), target = player.getBank(tab);
    let p = plan.get(target);
    if (!p) plan.set(target, p = new Map(target.getItems().filter(i => i.getId() > 0).map(i => [i.getId(), i.getAmount()])));
    p.set(id, (p.get(id) ?? 0) + n);
    if (p.size > target.capacity() || p.get(id) > 2147483647) return false;
  }
  if (!C.exchange(player, [[H.core.ItemIdentifiers.NUMULITE, 5]], [])) return false;
  for (const [id, n] of items) player.getBank(H.core.Bank.getTabForItem(player, id)).adds(id, n);
  return true;
}

function harvest({ player, object }) {
  const id = object.getId();
  if (!bases.has(id)) return false;
  const net = state(player).nets[id];
  if (!net || !sessions.has(player) || !C.nearby(player, object)) return true;
  net.rewards ??= rewards(player, net.count);
  C.choose(player, [["Take catch", () => finish(player, id, net, "take")],
    ["Bank catch (5 numulite)", () => finish(player, id, net, "bank")],
    ["Discard catch", () => finish(player, id, net, "discard")]]);
  return true;
}

function finish(player, id, net, mode) {
  const session = sessions.get(player);
  if (state(player).nets[id] !== net || !session || player.getPrivateArea() !== session.area || !C.active(player)) return;
  const target = anchor(player, id);
  if (!target || !C.nearby(player, target)) return;
  if (mode === "take") {
    const remaining = [];
    for (const item of net.rewards) if (!C.exchange(player, [], [item])) remaining.push(item);
    net.rewards = remaining;
    if (remaining.length) { player.getInventory().full(); return; }
  } else if (mode === "bank" && !bank(player, net.rewards)) return;
  delete state(player).nets[id];
  sync({ player });
}

function inspect({ player, object }) {
  if (!bases.has(object.getId())) return false;
  const net = state(player).nets[object.getId()];
  player.sendMessage(net ? `Your drift net holds ${net.count}/10 fish shoals.` : "No drift net is set here.");
  return true;
}

function takeDown(event) {
  const net = state(event.player).nets[event.object.getId()];
  if (!bases.has(event.object.getId())) return false;
  if (net?.count) return harvest(event);
  if (net && sessions.has(event.player) && C.nearby(event.player, event.object)
    && C.exchange(event.player, [], [[H.core.ItemIdentifiers.DRIFT_NET, 1]])) {
    delete state(event.player).nets[event.object.getId()];
    sync(event);
  }
  return true;
}

function storage({ player, object }) {
  if (!C.nearby(player, object)) return true;
  C.choose(player, [["Store all drift nets", () => { if (C.nearby(player, object)) store(player); }],
    ["Withdraw 10 drift nets", () => { if (C.nearby(player, object)) withdraw(player, 10); }],
    ["Withdraw all drift nets", () => { if (C.nearby(player, object)) withdraw(player, 2000); }]]);
  return true;
}

function store(player) {
  const I = H.core.ItemIdentifiers, s = state(player);
  for (const id of [I.DRIFT_NET, H.core.ItemDefinition.forId(I.DRIFT_NET).getNoteId()]) {
    const amount = Math.min(2000 - s.stored, player.getInventory().getAmount(id));
    if (amount > 0 && C.exchange(player, [[id, amount]], [])) s.stored += amount;
  }
  player.sendMessage(`Annette is storing ${s.stored} drift nets.`);
}

function withdraw(player, n) {
  const s = state(player), amount = Math.min(n, s.stored, player.getInventory().getFreeSlots());
  if (amount > 0 && C.exchange(player, [], [[H.core.ItemIdentifiers.DRIFT_NET, amount]])) s.stored -= amount;
}

function use(event) {
  if (bases.has(event.objectId) && event.itemId === H.core.ItemIdentifiers.DRIFT_NET) {
    event.handled = true;
    setup(event);
  } else if (event.objectId === H.core.ObjectIdentifiers.COL_FFFF00_ANNETTE_COL
    && [H.core.ItemIdentifiers.DRIFT_NET, H.core.ItemDefinition.forId(H.core.ItemIdentifiers.DRIFT_NET).getNoteId()].includes(event.itemId)) {
    event.handled = true;
    if (C.nearby(event.player, event.object)) store(event.player);
  }
}

function exit({ player }) {
  if (!sessions.has(player)) return false;
  cleanup({ player });
  player.moveTo(new H.core.Location(3728, 10293, 1));
  return true;
}

function cleanup({ player }) {
  for (const [npc, run] of chasing) if (run.player === player) chasing.delete(npc);
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  session.area.leave(player, false);
  session.area.destroy();
}

// ponytail: one passive shoal per minute; exact passive timing is unpublished.
function process() {
  for (const [npc, run] of chasing) {
    const net = state(run.player).nets[run.id], target = anchor(run.player, run.id);
    if (H.tick >= run.due || !npc.isRegistered() || !npc.isVisible() || !C.active(run.player)
      || net !== run.net || net.count >= 10 || net.rewards || !target) { chasing.delete(npc); continue; }
    if (H.tick % 2 === 0) H.core.PathFinder.calculateWalkRoute(npc, target.getLocation().getX(), target.getLocation().getY());
    if (nearAnchor(npc, target.getLocation())) {
      capture(run.player, net, true);
      C.hide(npc, 8);
      chasing.delete(npc);
    }
  }
  for (const player of H.players) {
    for (const net of Object.values(state(player).nets)) {
      if (!net.rewards && net.count < 10 && Date.now() - net.last >= 60000) capture(player, net, false);
    }
  }
}

module.exports = { ATTRIBUTE, initialize, state, enter, pay, setup, chase, harvest, inspect, takeDown, storage, use, exit,
  cleanup, process, login, sync, experience, rewards, fossil, bases };
