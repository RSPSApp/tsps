/**
 * Pheasant Control, as recorded (rsprox 227/00083, 01855, 237/01104; forestry.json `pheasant`):
 * - the Freaky Forester, three pheasants and four nests appear by the tree;
 * - a pheasant flies from its nest to the empty one every 8 or 12 ticks, in turn;
 * - Retrieve-egg on the empty nest gives "You collect a pheasant egg." (half the time "...and find
 *   a feather too."), one egg at a time;
 * - the forester takes it ("I have an egg for you.") for bark and Woodcutting and Thieving XP;
 * - at 181 ticks: "These pheasants will be finding new nesting grounds soon."; at 200 all is gone.
 * - the reach (pickup seq) comes first and the egg, its line and sound 7542 the tick after;
 * - a pheasant landing on the nest an egg was just taken from attacks: the block seq, the stun
 *   graphic at height 124, sound 2727 twice, "The nest's inhabitant attacks you, causing you to
 *   drop all your pheasant eggs." (no eggs: "The nest's inhabitant attacks you."), then "You've
 *   been stunned!" (spam) the tick after;
 * - clicking while stunned: "You're stunned!" (spam).
 * Inferred: the occupied nest is the nest01 form; reaching into it, or into the nest a pheasant is
 * flying to, brings the attack and a 5-tick stun. Wiki: 8-9 bark an egg, Woodcutting 1.0-1.2 x
 * level and Thieving 0.5 x level.
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");

const P = () => Common.data.pheasant;
/** Pheasant events now on the map. */
const events = new Set();

function start(site) {
  const pheasant = P();
  const tiles = Common.freeTiles(site.location, pheasant.range, site.size);
  if (tiles.length < 5) return null;
  const event = { site, nests: [], pheasants: [], elapsed: 0, nextFlight: pheasant.cycle[0], flights: 0, eggTakers: new Set(), over: false };
  event.forester = Common.spawnNpc(pheasant.npcs.forester, tiles[0]);
  for (let i = 0; i < 4; i++) {
    const at = tiles[i + 1];
    const occupied = i < 3;
    const nest = { at, object: Common.placeLoc(occupied ? pheasant.nests.occupied : pheasant.nests.empty, at), occupied, incoming: false, takers: new Set() };
    Common.tileGraphic(at, pheasant.graphics.spawn);
    event.nests.push(nest);
    if (occupied) event.pheasants.push({ npc: Common.spawnNpc(pheasant.npcs.pheasant, at), nest });
  }
  events.add(event);
  Common.every(() => tick(event));
  return event;
}

function setNest(nest, occupied) {
  nest.occupied = occupied;
  nest.object = Common.placeLoc(occupied ? P().nests.occupied : P().nests.empty, nest.at);
}

/** One pheasant takes off for the empty nest; it lands two ticks later. */
function flight(event) {
  const target = event.nests.find((nest) => !nest.occupied && !nest.incoming);
  if (!target) return;
  const bird = Common.pick(event.pheasants);
  const { seqs, graphics, flightTicks } = P();
  Common.animate(bird.npc, seqs.launch);
  setNest(bird.nest, false);
  target.incoming = true;
  Common.later(flightTicks, () => {
    if (event.over) return;
    target.incoming = false;
    setNest(target, true);
    bird.nest = target;
    bird.npc.moveTo?.(target.at.clone());
    Common.animate(bird.npc, seqs.land);
    bird.npc.performGraphic?.(new Common.core.Graphic(graphics.land));
    for (const player of target.takers) attacked(player);
    target.takers.clear();
  });
}

function tick(event) {
  if (event.over) return false;
  event.elapsed++;
  const { lifeTicks, warnAt, cycle } = P();
  if (event.elapsed === warnAt) event.forester.forceChat?.(Common.message("pheasantsLeaving"));
  if (event.elapsed >= lifeTicks) {
    end(event);
    return false;
  }
  if (event.elapsed >= event.nextFlight) {
    flight(event);
    event.flights++;
    event.nextFlight = event.elapsed + cycle[event.flights % cycle.length];
  }
  return true;
}

function end(event) {
  event.over = true;
  events.delete(event);
  Common.removeNpc(event.forester);
  for (const bird of event.pheasants) Common.removeNpc(bird.npc);
  for (const nest of event.nests) {
    Common.removeLoc(nest.object);
    Common.tileGraphic(nest.at, P().graphics.spawn);
  }
  for (const player of new Set([...event.site.participants, ...event.eggTakers, ...Common.nearbyPlayers(event.site.location, 15)])) dropEggs(player);
  Spawns.ended(event);
}

/** Inferred: eggs left over go with the pheasants. */
function dropEggs(player) {
  const inventory = player.getInventory();
  const eggs = inventory.getAmount(P().items.egg);
  if (eggs > 0) inventory.delete(P().items.egg, eggs);
  return eggs;
}

function nestAt(object) {
  for (const event of events) {
    const nest = event.nests.find((n) => n.at.equals(object.getLocation()));
    if (nest) return { event, nest };
  }
  return null;
}

function attacked(player) {
  const { seqs, graphics, sounds, stunTicks } = P();
  const hadEggs = dropEggs(player) > 0;
  player.sendMessage(Common.message(hadEggs ? "attackedEggs" : "attacked"));
  Common.animate(player, seqs.block);
  player.performGraphic?.(new Common.core.Graphic(graphics.stun, 0, graphics.stunHeight));
  for (const id of sounds.attack) Common.sound(player, id);
  player.getMovementQueue?.().reset?.();
  player.getTimers?.().registers?.(Common.core.TimerKey.STUN, stunTicks);
  Common.later(1, () => Common.spam(player, Common.message("stunned")));
}

/** Live refuses every event click while stunned. */
function stunned(player) {
  if (!player.getTimers?.().has?.(Common.core.TimerKey.STUN)) return false;
  Common.spam(player, Common.message("stunRefused"));
  return true;
}

function retrieve({ player, object }) {
  const found = nestAt(object);
  if (!found) return false;
  const { nest } = found;
  if (stunned(player) || Common.busy(player, 1)) return true;
  const { items, seqs } = P();
  if (player.getInventory().contains(items.egg)) {
    player.sendMessage(Common.message("oneEgg"));
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.getInventory().full?.();
    return true;
  }
  Common.animate(player, seqs.pickup);
  Common.later(1, () => takeEgg(found.event, nest, player));
  return true;
}

/** The tick after the reach: the egg, or the bird's attack when the nest is taken. */
function takeEgg(event, nest, player) {
  if (event.over || !player.isRegistered?.()) return;
  if (nest.occupied) {
    attacked(player);
    return;
  }
  const { items, sounds, featherChance } = P();
  const inventory = player.getInventory();
  if (inventory.contains(items.egg) || inventory.getFreeSlots() <= 0) return;
  inventory.add(new Common.core.Item(items.egg, 1), true);
  Common.sound(player, sounds.egg);
  event.eggTakers.add(player);
  if (nest.incoming) nest.takers.add(player);
  if (Math.random() < featherChance) {
    Common.give(player, items.feathers, 1);
    Common.spam(player, Common.message("eggFeather"));
  } else {
    Common.spam(player, Common.message("egg"));
  }
}

function eventOf(npc) {
  for (const event of events) if (event.forester === npc) return event;
  return null;
}

function eggBark() {
  const roll = Math.random();
  return P().bark.find(([upTo]) => roll < upTo)[1];
}

function handIn(event, player) {
  const { items, xp } = P();
  Common.chat(player, P().npcs.forester, [["player", Common.message("handIn")]]);
  player.getInventory().delete(items.egg, 1);
  if (!Spawns.eligible(event, player)) {
    Common.xp(player, "WOODCUTTING", 1);
    return;
  }
  const [low, high] = xp.woodcutting;
  Common.xp(player, "WOODCUTTING", Common.level(player, "WOODCUTTING") * (low + Math.random() * (high - low)));
  Common.xp(player, "THIEVING", Common.level(player, "THIEVING") * xp.thieving);
  Common.bark(player, eggBark());
}

/** Recorded: his greeting and the menu, or the hand-in when the player has an egg. */
function talk({ player, npc }) {
  const event = eventOf(npc);
  if (!event) return false;
  if (stunned(player)) return true;
  if (player.getInventory().contains(P().items.egg) && event.eggTakers.has(player)) {
    handIn(event, player);
    return true;
  }
  const [hello, ask, yes, no, explain] = Common.data.messages.forester;
  const id = P().npcs.forester;
  Common.chat(player, id, [["player", hello], ["npc", ask.replace("{name}", player.getDisplayName())]], () => {
    Common.menu(player,
      [yes, () => Common.chat(player, id, [["player", yes], ["npc", explain]])],
      [no, () => Common.chat(player, id, [["player", no]])]);
  });
  return true;
}

/** An egg from pheasants that are gone (logged out while they nested). */
function loggedIn({ player }) {
  if (![...events].some((event) => event.eggTakers.has(player))) dropEggs(player);
}

/** Logging out drops what eggs are carried, as the pheasants won't wait. */
function loggedOut({ player }) {
  for (const event of events) event.eggTakers.delete(player);
  dropEggs(player);
}

function attachPheasant(api) {
  api.onPlayerLogin(loggedIn);
  api.onPlayerLogout(loggedOut);
  Spawns.registerEvent("pheasant", { start });
  api.onObjectInteraction("Pheasant Nest", { "Retrieve-egg": retrieve });
  api.onNpcInteraction("Freaky Forester", { "Talk-to": talk });
}

module.exports = { attachPheasant, start, retrieve, talk, events, flight };
