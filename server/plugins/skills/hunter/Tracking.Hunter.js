"use strict";

// Trail coordinates/varbits adapted from GregHib/void (BSD-3-Clause).
// See Tracking.LICENSE. Trail generation and handlers are local implementations.
const data = require("./TrackingData.json");
const { H, ANIM, requireLevel, hasTool, nearby, exchange, xp, begin, roll, distance } = require("./Context.Hunter");
const trails = new Map();
const ATTRIBUTE = "hunter.pursuit-charges";

function tile(location) { return [location.getX(), location.getY(), location.getZ()]; }
function same(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
function near(a, b, range) { return a[2] === b[2] && Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= range; }

function initialize() {
  for (const segment of data.segments) {
    if (!H.core.CacheDefinitions.getVarbit(segment.varbit)) throw new Error(`Missing Hunter trail varbit ${segment.varbit}`);
  }
}

function clear({ player }) {
  const state = trails.get(player);
  if (!state) return;
  for (const segment of state.path) player.getPacketSender().sendVarbit(segment.varbit, 0);
  trails.delete(player);
}

function generate(first) {
  const def = data.creatures[first.kebbit];
  const original = data.segments.filter(s => s.kebbit === first.kebbit && (!s.burrow || first.kebbit === "polar_kebbit"));
  const pool = original.concat(original.map(s => ({ ...s, start: s.end, end: s.start, inverted: !s.inverted, burrow: false })));
  const path = [first];
  let finalPath = def.finals.some(f => same(f, first.end)) ? path.slice() : null;
  for (let i = 0; i < 12; i++) {
    const previous = path[path.length - 1];
    const possible = pool.filter(s => !path.some(p => p.varbit === s.varbit)
      && (previous.tunnel ? s.tunnel && near(s.start, previous.end, 5) && !same(s.start, previous.end) : same(s.start, previous.end)));
    if (!possible.length) break;
    path.push(possible[roll(0, possible.length - 1)]);
    if (def.finals.some(f => same(f, path[path.length - 1].end))) {
      finalPath = path.slice();
      if (path.length >= def.limit + 1) break;
    }
  }
  return finalPath;
}

function inspect({ player, object, definition }) {
  const position = tile(object.getLocation());
  const name = definition?.getName() ?? object.getDefinition().getName();
  if (name === "Burrow") {
    const starts = data.segments.filter(s => s.burrow && near(s.start, position, 2));
    if (!starts.length) return false;
    if (!nearby(player, object) || !requireLevel(player, data.creatures[starts[0].kebbit].level)) return true;
    clear({ player });
    let path = null;
    for (let i = 0; i < 10 && !path; i++) path = generate(starts[roll(0, starts.length - 1)]);
    if (!path) { player.sendMessage("You find no tracks here."); return true; }
    trails.set(player, { path, step: 0, area: player.getPrivateArea(), origin: object.getLocation().clone(), due: H.tick + 300 });
    H.players.add(player);
    player.getPacketSender().sendVarbit(path[0].varbit, path[0].inverted ? 5 : 4);
    pursuit(player, trails.get(player));
    player.sendMessage("You discover tracks. Search along the trail to follow them.");
    return true;
  }
  const state = trails.get(player);
  if (!state || !nearby(player, object)) return false;
  pursuit(player, state);
  const next = state.path[state.step + 1];
  if (next && (same(next.trigger ?? next.end, position) || same(next.end, position))) {
    state.step++;
    state.due = H.tick + 300;
    player.getPacketSender().sendVarbit(next.varbit, next.inverted ? 5 : 4);
    player.sendMessage(state.step === state.path.length - 1 ? "Something is moving here. Use your noose wand to catch it." : "You find more tracks.");
  } else player.sendMessage("You find no new tracks here.");
  return true;
}

function catchPrey({ player, object }) {
  const state = trails.get(player);
  if (!state) return false;
  if (!nearby(player, object)) return true;
  const last = state.path[state.path.length - 1];
  if (!hasTool(player, H.core.ItemIdentifiers.NOOSE_WAND)) { player.sendMessage("You need a noose wand."); return true; }
  if (state.step !== state.path.length - 1 || !same(last.end, tile(object.getLocation()))) { player.sendMessage("You fail to find the creature here."); return true; }
  const def = data.creatures[last.kebbit], rewards = def.loot.map(key => [H.core.ItemIdentifiers[key], 1]);
  if (!requireLevel(player, def.level)) return true;
  if (!exchange(player, [], rewards, false)) { player.getInventory().full(); return true; }
  begin(player, 2, ANIM.NOOSE, () => {
    if (trails.get(player) !== state || !requireLevel(player, def.level) || !hasTool(player, H.core.ItemIdentifiers.NOOSE_WAND) || !exchange(player, [], rewards)) return;
    clear({ player }); xp(player, def.xp, "tracking", H.core.NpcIdentifiers[last.kebbit.toUpperCase()], { creature: last.kebbit.toUpperCase() });
    player.sendMessage(`You catch a ${last.kebbit.replaceAll("_", " ")}!`);
  });
  return true;
}

function charges(player) { const n = Number(player.getAttribute(ATTRIBUTE)); return Number.isInteger(n) && n > 0 && n <= 10 ? n : 10; }
function pursuit(player, state) {
  if (state.revealed || player.getEquipment().get(H.core.Equipment.RING_SLOT).getId() !== H.core.ItemIdentifiers.RING_OF_PURSUIT) return;
  state.revealed = true; state.step = state.path.length - 1;
  for (const segment of state.path) player.getPacketSender().sendVarbit(segment.varbit, segment.inverted ? 5 : 4);
  const left = charges(player) - 1;
  player.setAttribute(ATTRIBUTE, left || 10);
  if (!left) { player.getEquipment().set(H.core.Equipment.RING_SLOT, new H.core.Item(-1, 0)); player.getEquipment().refreshItems(); player.getUpdateFlag().flag(H.core.Flag.APPEARANCE); player.sendMessage("Your ring of pursuit crumbles to dust."); }
  else player.sendMessage(`Your ring reveals the entire trail. It has ${left} charges remaining.`);
}
function checkRing({ player }) { player.sendMessage(`Your ring of pursuit has ${charges(player)} charges remaining.`); return true; }
function breakRing({ player, itemId }) {
  if (exchange(player, [[itemId, 1]], [])) { player.setAttribute(ATTRIBUTE, 10); player.sendMessage("You break the ring of pursuit."); }
  return true;
}
function process() {
  for (const [player, state] of trails) if (H.tick >= state.due || state.area !== player.getPrivateArea() || distance(state.origin, player.getLocation()) > 64) clear({ player });
}

module.exports = { ATTRIBUTE, checkRing, breakRing, charges, initialize, inspect, catchPrey, clear, process, generate, data };
