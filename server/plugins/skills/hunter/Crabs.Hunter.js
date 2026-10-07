"use strict";

const C = require("./Context.Hunter"), { H } = C;
const ATTRIBUTE = "hunter.crabs";
const bases = new Map(), active = new Map(), rendered = new WeakMap();

function initialize() {
  bases.clear();
  const O = H.core.ObjectIdentifiers;
  for (let id = 0; id < H.core.CacheDefinitions.getCounts().objects; id++) {
    const d = H.core.CacheDefinitions.getObject(id);
    if (d.transforms?.includes(O.CRAB_TRAP_EMPTY_)) bases.set(id, d);
  }
}

function states(player) {
  let s = player.getAttribute(ATTRIBUTE);
  if (!s || typeof s !== "object" || Array.isArray(s)) player.setAttribute(ATTRIBUTE, s = {});
  return s;
}

function sync({ player }, force = false) {
  let prev = rendered.get(player);
  if (!prev || force) rendered.set(player, prev = new Map());
  for (const [id, d] of bases) {
    const value = states(player)[id]?.value ?? 0;
    if (prev.get(id) !== value) {
      player.getPacketSender().sendVarbit(d.transformVarbit, value);
      prev.set(id, value);
    }
  }
}

function login(event) { sync(event, true); }

function species(object) {
  const t = bases.get(object.getId())?.transforms;
  const O = H.core.ObjectIdentifiers, I = H.core.ItemIdentifiers, N = H.core.NpcIdentifiers;
  if (t?.includes(O.CRAB_TRAP_FULL_)) return { level: 21, xp: 64, ticks: 15, bait: I.FISH_OFFCUTS, npc: N.RED_CRAB, items: [I.RED_CRAB_2] };
  if (t?.includes(O.CRAB_TRAP_FULL__2)) return { level: 48, xp: 136, ticks: 15, bait: I.FISH_OFFCUTS, npc: N.BLUE_CRAB, items: [I.BLUE_CRAB] };
  if (t?.includes(O.CRAB_TRAP_FULL__3)) return { level: 77, xp: 216, ticks: 25, bait: I.FINE_FISH_OFFCUTS, npc: N.RAINBOW_CRAB, items: [I.RAINBOW_CRAB, I.RAINBOW_CRAB_4, I.RAINBOW_CRAB_7] };
  return null;
}

// Trap limit follows the standard 1 + level/20 formula, capped at 5.
function allowed(player) { return Math.min(5, 1 + Math.floor(C.level(player) / 20)); }

function built(player, object) {
  return Object.values(states(player)).filter(state => state.value >= 2).length >= allowed(player);
}

function build({ player, object }) {
  if (!bases.has(object.getId())) return false;
  if (states(player)[object.getId()]?.value) return true;
  const I = H.core.ItemIdentifiers;
  if (!C.nearby(player, object) || !C.requireLevel(player, 10, H.core.Skill.CONSTRUCTION)) return true;
  const nails = [I.BRONZE_NAILS, I.IRON_NAILS, I.STEEL_NAILS, I.BLACK_NAILS, I.MITHRIL_NAILS, I.ADAMANTITE_NAILS, I.RUNE_NAILS]
    .find(id => player.getInventory().getAmount(id) >= 2);
  if (!nails || !C.hasTool(player, I.SAW) || !C.hasTool(player, I.HAMMER)) {
    player.sendMessage("You need a saw, hammer, plank, bucket and two nails."); return true;
  }
  C.begin(player, 4, C.ANIM.SMALL, () => {
    if (states(player)[object.getId()]?.value || !C.requireLevel(player, 10, H.core.Skill.CONSTRUCTION)
      || !C.hasTool(player, I.SAW) || !C.hasTool(player, I.HAMMER)
      || !C.exchange(player, [[I.PLANK, 1], [I.BUCKET, 1], [nails, 2]], [])) return;
    states(player)[object.getId()] = { value: 1 };
    sync({ player });
    player.getSkillManager().addExperiences(H.core.Skill.CONSTRUCTION, 30);
  });
  return true;
}

function bait({ player, object }) {
  const def = species(object);
  if (!def) return false;
  const s = states(player)[object.getId()];
  if (!s || s.value !== 1 || !C.nearby(player, object) || !C.requireLevel(player, def.level)) return true;
  if (built(player)) { player.sendMessage("You have already baited your maximum number of crab traps."); return true; }
  C.begin(player, 1, C.ANIM.SMALL, () => {
    if (s.value !== 1 || built(player) || !C.requireLevel(player, def.level) || !C.exchange(player, [[def.bait, 1]], [])) return;
    s.value = 2;
    active.set(s, { player, object, def, due: H.tick + def.ticks });
    H.players.add(player);
    sync({ player });
  });
  return true;
}

function empty({ player, object }) {
  const def = species(object);
  if (!def) return false;
  const s = states(player)[object.getId()];
  if (!s || !C.nearby(player, object)) return true;
  if (s.value === 2) { s.value = 1; active.delete(s); sync({ player }); return true; }
  if (s.value < 3) return true;
  const id = def.items[s.value - 3] ?? def.items[0];
  C.begin(player, 1, C.ANIM.TAKE, () => {
    if (s.value < 3 || !C.requireLevel(player, def.level) || !C.exchange(player, [], [[id, 1]])) return;
    s.value = 1;
    active.delete(s);
    sync({ player });
    C.xp(player, def.xp, "crab", def.npc);
    C.begin(player, 2, C.ANIM.SMALL, () => bait({ player, object }));
  });
  return true;
}

function use(event) {
  const def = species(event.object);
  if (!def) return;
  event.handled = true;
  if (event.itemId === def.bait) bait(event);
}

function cut(event) {
  const I = H.core.ItemIdentifiers, pair = [event.usedItemId, event.usedWithItemId];
  const red = pair.includes(I.RED_CRAB_2), blue = pair.includes(I.BLUE_CRAB);
  const rainbow = [I.RAINBOW_CRAB, I.RAINBOW_CRAB_4, I.RAINBOW_CRAB_7].find(id => pair.includes(id));
  if (!red && !blue && !rainbow) return;
  const knife = pair.includes(I.KNIFE), pestle = pair.includes(I.PESTLE_AND_MORTAR);
  if (!knife && !pestle) return;
  event.handled = true;
  const input = red ? I.RED_CRAB_2 : blue ? I.BLUE_CRAB : rainbow;
  const output = knife ? (red ? I.RAW_RED_CRAB_MEAT : blue ? I.RAW_BLUE_CRAB_MEAT : I.RAW_RAINBOW_CRAB_MEAT)
    : (rainbow ? I.RAINBOW_CRAB_PASTE : I.CRAB_PASTE);
  C.exchange(event.player, [[input, 1]], [[output, 1]]);
}

function cleanup({ player }) {
  for (const [s, a] of active) if (a.player === player) { s.value = 1; active.delete(s); }
  for (const s of Object.values(states(player))) if (s.value >= 2) s.value = 1;
  sync({ player });
}

function process() {
  for (const [s, a] of active) {
    if (!C.active(a.player) || !C.nearby(a.player, a.object, 48)) {
      s.value = 1; active.delete(s); sync({ player: a.player });
    } else if (s.value === 2 && H.tick >= a.due) {
      s.value = 3 + C.roll(0, a.def.items.length - 1);
      sync({ player: a.player });
    }
  }
}

module.exports = { ATTRIBUTE, initialize, build, bait, empty, use, cut, login, sync, cleanup, process, bases, species, states };
