/**
 * The Flowering Bush, as recorded (rsprox 227/00083, 01850, 237/01104 and 01108;
 * forestry.json `flowering`):
 * - eight bushes, each its own colour, and two bees appear by the tree;
 * - two bushes at a time are in flower, as a pair; a pair closes every 70 ticks from the spawn
 *   with sound 818 at both its bushes, and the next opens;
 * - Tend-to without pollen collects it (the pickup seq, synth 2581, "Bees are very active on this
 *   bush and there are pollen-rich flowers. You carefully collect some Strange pollen."); with
 *   pollen, from this pair or an earlier one, it pollinates over two ticks: the seq, synth 2427 and
 *   the pollen gone, then the seq again, synth 2581, the pollen back and the bark. The long
 *   "...there are unpollinated flowers. You carefully apply your pollen..." comes on the first
 *   apply to each bush of each pair (not on the bush the pollen was collected from);
 * - the refusals: "You took the pollen from this bush..." (checked first), the item box "The bush
 *   is already fruiting...", and the message boxes "This bush has finished flowering...", "There
 *   are no open, unpollinated flowers on this bush yet." and "The flowers on this bush have not
 *   yet opened enough to harvest pollen.";
 * - either bush of a closing pair may fruit; its helpers get "A bush has started producing fruit,
 *   well done!" (or "Some bushes..." when both of the pair do) and synth 7014. A fruiting bush goes
 *   15 ticks later (map_anim 2369) and one of its colour grows on another tile 10 ticks after that;
 * - at 299 ticks the bushes go (map_anim 2369); the tick after "The bushes become dormant and the
 *   bees move on...", "You discard your left over pollen." and the bees go; the lump the tick
 *   after that.
 * Wiki: 1-2 bark an exchange; the lump is 0.75-0.85 x the bark collected, with 1-8 strange fruit.
 * Inferred: which bushes pair up (no packet shows it), the first pair opening with the event, and
 * the pair still open at the end counting its exchanges. Calibrated: the XP and the fruiting
 * chance (forestry.json `flowering.xp`, `fruitChancePerApply`).
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");

const F = () => Common.data.flowering;
/** Flowering bush events now on the map. */
const events = new Set();
/** Players carrying pollen -> { event, from }. */
const pollen = new Map();

function start(site) {
  const flowering = F();
  const tiles = Common.freeTiles(site, site.location, flowering.range, site.size);
  if (tiles.length < flowering.bushes.length) return null;
  const event = { site, bushes: [], bees: [], elapsed: 0, pair: null, fruited: 0, bark: new Map(), over: false };
  flowering.bushes.forEach((_, colour) => event.bushes.push(newBush(colour, tiles[colour])));
  for (let i = 0; i < 2; i++) event.bees.push(Common.spawnNpc(flowering.bees, tiles[flowering.bushes.length + i] ?? tiles[i]));
  events.add(event);
  openPair(event, []);
  Common.every(() => tick(event));
  return event;
}

function newBush(colour, at) {
  return { npc: Common.spawnNpc(F().bushes[colour][0], at, F().spawnGraphic), colour, fruited: false, finished: false };
}

/** Two bushes come into flower, neither fruiting nor in the pair that just closed. */
function openPair(event, closed) {
  const open = event.bushes.filter((b) => !b.fruited && !closed.includes(b));
  if (open.length < 2) return;
  const first = open.splice(Common.randomInt(0, open.length - 1), 1)[0];
  const second = Common.pick(open);
  for (const bush of [first, second]) bush.finished = false;
  event.pair = { bushes: [first, second], applies: new Map(), helpers: new Set(), told: new Map() };
}

/** The more pollen a bush of the pair took, the likelier it fruits. */
function fruits(applies) {
  return applies > 0 && Math.random() < 1 - (1 - F().fruitChancePerApply) ** applies;
}

/** The pair closes: each bush fruits or finishes flowering (`quiet`: at the end, with no sound). */
function closePair(event, quiet = false) {
  const { pair } = event;
  if (!pair) return;
  event.pair = null;
  const { bushes, sounds } = F();
  const fruiting = pair.bushes.filter((bush) => fruits(pair.applies.get(bush) ?? 0));
  if (fruiting.length > 0) {
    for (const player of pair.helpers) {
      player.sendMessage(Common.message(fruiting.length > 1 ? "fruitSome" : "fruitOne"));
      Common.sound(player, sounds.fruit);
    }
  }
  for (const bush of pair.bushes) {
    if (!quiet) Common.areaSound(bush.npc.getLocation(), sounds.close, sounds.closeRange);
    if (!fruiting.includes(bush)) {
      bush.finished = true;
      continue;
    }
    bush.fruited = true;
    event.fruited++;
    bush.npc.setNpcTransformationId?.(bushes[bush.colour][1]);
    if (!quiet) Common.later(F().fruitRemoveTicks, () => replace(event, bush));
  }
}

/** A fruiting bush goes, and one of its colour grows elsewhere a little later. */
function replace(event, bush) {
  if (event.over) return;
  const at = bush.npc.getLocation().clone();
  Common.tileGraphic(at, F().spawnGraphic);
  Common.removeNpc(bush.npc);
  event.bushes.splice(event.bushes.indexOf(bush), 1);
  Common.later(F().regrowTicks, () => regrow(event, bush.colour, at));
}

function regrow(event, colour, was) {
  if (event.over) return;
  const taken = (tile) => tile.equals(was) || event.bushes.some((b) => b.npc.getLocation().equals(tile));
  const at = Common.freeTiles(event.site, event.site.location, F().range, event.site.size).find((tile) => !taken(tile)) ?? was;
  event.bushes.push(newBush(colour, at));
}

function tick(event) {
  if (event.over) return false;
  event.elapsed++;
  const { lifeTicks, pairTicks } = F();
  if (event.elapsed >= lifeTicks) {
    end(event);
    return false;
  }
  if (event.elapsed % pairTicks === 0) {
    const closed = event.pair?.bushes ?? [];
    closePair(event);
    openPair(event, closed);
  }
  return true;
}

function dropPollen(player) {
  pollen.delete(player);
  const amount = player.getInventory().getAmount(F().pollen);
  if (amount > 0) player.getInventory().delete(F().pollen, amount);
  return amount > 0;
}

function end(event) {
  // The pair still open closes with the event.
  closePair(event, true);
  event.over = true;
  events.delete(event);
  const flowering = F();
  for (const bush of event.bushes) {
    Common.tileGraphic(bush.npc.getLocation(), flowering.spawnGraphic);
    Common.removeNpc(bush.npc);
  }
  Common.later(1, () => {
    for (const bee of event.bees) Common.removeNpc(bee);
    const holders = [...pollen].filter(([, held]) => held.event === event).map(([p]) => p);
    for (const player of new Set([...event.site.participants, ...event.bark.keys(), ...holders])) {
      if (event.bark.has(player)) player.sendMessage(Common.message("dormant"));
      if (dropPollen(player)) player.sendMessage(Common.message("discardPollen"));
    }
  });
  if (event.fruited > 0) Common.later(2, () => gifts(event, event.fruited));
  Spawns.ended(event);
}

/** A share of the bark collected, strange fruit and XP for the fruiting bushes. */
function gifts(event, fruiting) {
  const flowering = F();
  for (const [player, collected] of event.bark) {
    if (!player.isRegistered?.()) continue;
    const [low, high] = flowering.lumpShare;
    Common.bark(player, Math.max(1, Math.round(collected * (low + Math.random() * (high - low)))), true);
    Common.give(player, flowering.fruit, Common.randomInt(...flowering.fruitAmount));
    Common.xp(player, "WOODCUTTING", flowering.xp.fruitPerLevel * Common.level(player, "WOODCUTTING") * fruiting);
  }
}

function bushOf(npc) {
  for (const event of events) {
    const bush = event.bushes.find((b) => b.npc === npc);
    if (bush) return { event, bush };
  }
  return null;
}

/** Whether this is the player's first look at the bush in this pair. */
function firstLook(pair, player, bush) {
  const seen = pair.told.get(player) ?? new Set();
  pair.told.set(player, seen);
  if (seen.has(bush)) return false;
  seen.add(bush);
  return true;
}

function collect(event, player, bush) {
  const flowering = F();
  if (player.getInventory().getFreeSlots() <= 0 && !player.getInventory().contains(flowering.pollen)) {
    player.getInventory().full?.();
    return;
  }
  Common.animate(player, flowering.pickup);
  Common.sound(player, flowering.sounds.collect);
  if (!player.getInventory().contains(flowering.pollen)) player.getInventory().add(new Common.core.Item(flowering.pollen, 1), true);
  pollen.set(player, { event, from: bush });
  firstLook(event.pair, player, bush);
  player.sendMessage(Common.message("pollenRich"));
}

/** The pollen goes on the bush, and the tick after some comes back from it, with the bark. */
function pollinate(event, player, bush) {
  const flowering = F();
  const { pair } = event;
  Common.animate(player, flowering.pickup);
  Common.sound(player, flowering.sounds.apply);
  dropPollen(player);
  pair.applies.set(bush, (pair.applies.get(bush) ?? 0) + 1);
  pair.helpers.add(player);
  if (firstLook(pair, player, bush)) player.sendMessage(Common.message("unpollinated"));
  Common.later(1, () => extract(event, player, bush));
}

function extract(event, player, bush) {
  if (event.over || !player.isRegistered?.()) return;
  const flowering = F();
  Common.animate(player, flowering.pickup);
  Common.sound(player, flowering.sounds.collect);
  player.getInventory().add(new Common.core.Item(flowering.pollen, 1), true);
  pollen.set(player, { event, from: bush });
  if (!Spawns.eligible(event, player)) {
    Common.xp(player, "WOODCUTTING", 1);
    return;
  }
  const amount = Common.randomInt(...flowering.bark);
  event.bark.set(player, (event.bark.get(player) ?? 0) + amount);
  Common.bark(player, amount);
  Common.xp(player, "WOODCUTTING", flowering.xp.perLevel * Common.level(player, "WOODCUTTING") + flowering.xp.plus);
}

function tend({ player, npc }) {
  const found = bushOf(npc);
  if (!found) return false;
  const { event, bush } = found;
  if (Common.busy(player, F().actionTicks)) return true;
  const held = pollen.get(player);
  const holding = held?.event === event && player.getInventory().contains(F().pollen);
  if (holding && held.from === bush) {
    Common.messageBox(player, Common.message("sameBush"));
    return true;
  }
  if (bush.fruited) {
    Common.objectBox(player, F().fruit, Common.message("fruiting"));
    return true;
  }
  if (!event.pair?.bushes.includes(bush)) {
    Common.messageBox(player, Common.message(bush.finished ? "finished" : holding ? "noUnpollinated" : "notOpen"));
    return true;
  }
  if (holding) pollinate(event, player, bush);
  else collect(event, player, bush);
  return true;
}

function forget({ player }) {
  dropPollen(player);
}

function attachFlowering(api) {
  Spawns.registerEvent("flowering", { start });
  for (const colour of Common.data.flowering.names) {
    api.onNpcInteraction(`<col=00ffff>Flowering bush (${colour})</col>`, { "Tend-to": tend });
    api.onNpcInteraction(`<col=00ffff>Strange bush (${colour})</col>`, { "Tend-to": tend });
  }
  api.onPlayerLogout(forget);
}

module.exports = { attachFlowering, start, tend, closePair, openPair, events, pollen };
