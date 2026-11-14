/**
 * Stealing valuables (House Robbery) in Civitas illa Fortis: the owners' errands, the locked
 * doors, searching for valuables, the shiny object, the warning whistle and getting caught.
 * Ids, lines, tiles and ticks are in plugins/skills/data/house-robbery.json with their sources
 * (OSRS Wiki: Stealing valuables; rsprox captures); docs/stealing-valuables.md has the timeline.
 * The urchins' house information and Oriana's trade-in are HouseRobberyCrew.Thieving.js.
 *
 * One house is vacant at a time. Its owner says their line, walks out, locks up and goes on an
 * errand; 302-313 ticks later they are back at the door. The house's urchin whistles (a player
 * inside is warned), the owner finds their keys, opens up and steps in. Anyone still inside is
 * thrown out with a tenth of what they took there. The next owner leaves 10-17 ticks later.
 *
 * A player breaks in with a house key on the vacant house's Locked Door, and searches its
 * chests, wardrobe and jewellery case: every 3 ticks a roll for a valuable, until the object's
 * 28-32 rolls run out. Every 43-85 ticks one other object shines for 12 ticks; searching it in
 * time is 14 valuables. The window (LocTeleports) or a logout ends the visit.
 */
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "house-robbery.json"), "utf8"));
/** The house a player broke into, saved so a relog puts them outside (Wiki: logging out "automatically" leaves). */
const INSIDE_ATTRIBUTE = "house-robbery:inside";
/** Valuables stolen in all, the varp the client shows (captures: valuables_lifetime). */
const LIFETIME_ATTRIBUTE = "house-robbery:lifetime";
/** The most valuables taken from one house (captures: most_valuables). */
const MOST_ATTRIBUTE = "house-robbery:most";
const HINT_ARROW_SHOWN = 6;
const NOTHING_INTERESTING = "Nothing interesting happens.";

let core;
let pluginApi;
/** The houses with their owner NPCs, resolved at start-up. */
const houses = [];
/** The owners' cycle: which house is out, and when each step happens (world ticks). */
const cycle = { tick: 0, house: null, next: null, phase: "home", nextLeave: 0, leftAt: 0, whistleAt: 0, last: null, caught: false };
/** Player -> their visit to the vacant house. */
const visits = new Map();

function random(range, rng = Math.random) {
  const [low, high] = range;
  return low + Math.floor(rng() * (high - low + 1));
}

function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

function tile([x, y], z = 0) {
  return new core.Location(x, y, z);
}

function sameTile(location, [x, y]) {
  return location.getX() === x && location.getY() === y && location.getZ() === 0;
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

function varbit(name) {
  return core.CacheDefinitions.getVarbitId(DATA.varbits[name]);
}

function setVarbit(player, name, value) {
  const id = varbit(name);
  if (id !== null) player.getPacketSender().sendVarbit(id, value);
}

function seq(name, delay = 0) {
  const id = core.CacheDefinitions.getSeqId(DATA.seqs[name]);
  return id === null ? null : new core.Animation(id, delay);
}

function animate(mobile, name) {
  const animation = seq(name);
  if (animation && mobile?.isRegistered?.() !== false) mobile.performAnimation(animation);
}

function synth(player, id, delay = 0) {
  player.getPacketSender().sendSoundEffect(id, 1, delay, 255);
}

function areaSound(at, sound) {
  core.Sounds.playAreaSound({ soundId: sound.id, x: at.getX(), y: at.getY(), level: at.getZ(), loops: 1, delay: sound.delay ?? 0, radius: sound.range });
}

function itemId(name) {
  return core.CacheDefinitions.getObjId(DATA.items[name]);
}

function thieving(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
}

function questComplete(player) {
  const request = { player, key: DATA.quest.key, complete: null };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return typeof request.complete === "boolean" ? request.complete : Number(player.getAttribute(`quest.${DATA.quest.key}.stage`)) >= 2;
}

function levelBox(player) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, DATA.messages.level)));
}

/** A timed step on the world clock or for one player. */
function later(ticks, action, key = undefined) {
  core.TaskManager.submit(new core.CountdownTask(key ?? {}, Math.max(1, ticks), action));
}

// ---------------------------------------------------------------- houses and owners

function houseAt(location) {
  return houses.find((house) => sameTile(location, house.door)) ?? null;
}

function houseOfSearchable(location) {
  return houses.find((house) => house.searchables.some((spot) => sameTile(location, spot))) ?? null;
}

function insideHouse(house, location) {
  if (location.getZ() !== 0) return false;
  const x = location.getX();
  const y = location.getY();
  return house.interior.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);
}

function findOwners() {
  const ids = new Map(DATA.houses.map((house) => [core.CacheDefinitions.getNpcId(house.owner), house.key]));
  const found = new Map();
  for (const npc of core.World.getNpcs()) {
    if (npc?.isRegistered?.() && !npc.getPrivateArea?.() && ids.has(npc.getId())) found.set(ids.get(npc.getId()), npc);
  }
  return found;
}

function ownerOf(house) {
  if (!house.npc?.isRegistered?.()) house.npc = findOwners().get(house.key) ?? null;
  return house.npc;
}

function urchinOf(house) {
  const id = core.CacheDefinitions.getNpcId(house.urchin);
  for (const npc of core.World.getNpcs()) if (npc?.isRegistered?.() && !npc.getPrivateArea?.() && npc.getId() === id) return npc;
  return null;
}

/** Swaps the house's door loc for the open or locked one, at the captured rotation. */
function setDoor(house, locked) {
  const at = tile(house.door);
  const openId = core.CacheDefinitions.getLocId(DATA.locs.doorOpen);
  const lockedId = core.CacheDefinitions.getLocId(DATA.locs.doorLocked);
  const from = core.MapObjects.get(locked ? openId : lockedId, at, null);
  const type = from?.getType?.() ?? 0;
  if (from) core.ObjectManager.deregister(from, true);
  const rotation = locked ? house.doorRotation.locked : house.doorRotation.open;
  core.ObjectManager.register(new core.GameObject(locked ? lockedId : openId, at, type, rotation, null), true);
}

function hold(npc) {
  npc.setScriptedMovement(true);
  npc.getMovementQueue().reset();
}

function release(npc) {
  if (npc?.isRegistered?.()) npc.setScriptedMovement(false);
}

function walk(npc, to) {
  if (!npc?.isRegistered?.() || sameTile(npc.getLocation(), to)) return;
  if (!npc.getMovementQueue().hasPendingWork()) core.PathFinder.calculateWalkRoute(npc, to[0], to[1]);
}

/** The vacant house, while its owner is out (from the lock to the door reopening). */
function vacantHouse() {
  return cycle.phase === "away" || cycle.phase === "returning" ? cycle.house : null;
}

/** Whether the owner is out of the door's way: walked off, and not back at it yet. */
function ownerAwayFromDoor(house) {
  if (cycle.phase !== "away" || cycle.house !== house) return false;
  const owner = ownerOf(house);
  return !owner || chebyshev(owner.getLocation(), tile(house.door)) > DATA.cycle.nearDoor;
}

function chooseNext(rng = Math.random) {
  const candidates = houses.filter((house) => house !== cycle.last && ownerOf(house));
  return candidates.length ? pick(candidates, rng) : null;
}

/** Ticks the owners' cycle by one. */
function processCycle(rng = Math.random) {
  const t = cycle.tick++;
  if (cycle.phase === "home") {
    if (!cycle.next) cycle.next = chooseNext(rng);
    if (t < cycle.nextLeave) return;
    const house = cycle.next;
    cycle.next = null;
    if (!house) {
      cycle.nextLeave = t + random(DATA.cycle.nextLeave, rng);
      return;
    }
    cycle.house = house;
    cycle.phase = "leaving";
    cycle.leftAt = t;
    hold(ownerOf(house));
  }
  const house = cycle.house;
  const owner = ownerOf(house);
  if (!owner) {
    endCycle(t, rng);
    return;
  }
  if (cycle.phase === "leaving") leaving(house, owner, t, rng);
  else if (cycle.phase === "away") away(house, owner, t);
  else if (cycle.phase === "returning") returning(house, owner, t, rng);
}

/** Captures: the line each tick on the way out; on the outside tile, next tick, the lock. */
function leaving(house, owner, t, rng) {
  if (!sameTile(owner.getLocation(), house.outside)) {
    owner.forceChat(house.leaveLine);
    walk(owner, house.outside);
    // Ours: an owner blocked for 20 ticks steps out, so the cycle never stalls.
    if (t - cycle.leftAt < 20) return;
    owner.moveTo(tile(house.outside));
    return;
  }
  owner.setPositionToFace(tile(house.door));
  animate(owner, "picklock");
  areaSound(tile(house.outside), DATA.sounds.picklock);
  setDoor(house, true);
  areaSound(tile(house.door), DATA.sounds.lock);
  escortOut(house);
  cycle.phase = "away";
  cycle.lockedAt = t;
  cycle.whistleAt = t + random(DATA.cycle.away, rng) - DATA.cycle.return.unlock;
  owner.getMovementQueue().reset();
  walk(owner, house.errand);
}

function away(house, owner, t) {
  if (t >= cycle.whistleAt - DATA.cycle.walkBack) walk(owner, house.outside);
  else if (!sameTile(owner.getLocation(), house.errand) && !owner.getMovementQueue().hasPendingWork()) walk(owner, house.errand);
  if (t < cycle.whistleAt) return;
  // Ours: an owner who couldn't walk back is put at the door for the return.
  if (!sameTile(owner.getLocation(), house.outside)) owner.moveTo(tile(house.outside));
  owner.setPositionToFace(tile(house.door));
  const urchin = urchinOf(house);
  if (urchin) urchin.forceChat(DATA.lines.whistle);
  for (const [player, visit] of visits) {
    if (visit.house !== house || !insideHouse(house, player.getLocation())) continue;
    visit.warned = true;
    player.sendMessage(DATA.messages.warning);
    synth(player, DATA.sounds.warning);
  }
  cycle.phase = "returning";
}

/** Ticks from the whistle (rsprox 1102, 1104, 1105): keys on 5, unlock on 10, open on 15, in on 16, a line on 18. */
function returning(house, owner, t, rng) {
  const step = t - cycle.whistleAt;
  const at = DATA.cycle.return;
  if (step === at.keys) {
    animate(owner, "grind");
    owner.forceChat(DATA.lines.keysWhere);
    areaSound(tile(house.door), DATA.sounds.keys);
  } else if (step === at.unlock) {
    animate(owner, "picklock");
    owner.forceChat(DATA.lines.keysFound);
    areaSound(tile(house.door), DATA.sounds.picklock);
  } else if (step === at.open) {
    setDoor(house, false);
    areaSound(tile(house.door), DATA.sounds.unlock);
  } else if (step === at.enter) {
    owner.moveTo(tile(house.ownerInside));
    cycle.caught = catchThieves(house);
  } else if (step === at.line) {
    if (cycle.caught) owner.forceChat(pick(DATA.lines.accusations, rng));
    else {
      owner.forceChat(pick(DATA.lines.comments, rng));
      animate(owner, "think");
    }
  } else if (step >= at.followUp) {
    if (cycle.caught) {
      animate(owner, "angry");
      owner.forceChat(pick(DATA.lines.alarms, rng));
    }
    endCycle(t, rng);
  }
}

function endCycle(t, rng) {
  release(cycle.house ? ownerOf(cycle.house) : null);
  cycle.last = cycle.house;
  cycle.house = null;
  cycle.phase = "home";
  cycle.caught = false;
  cycle.nextLeave = t + random(DATA.cycle.nextLeave, rng);
  // The urchins already know who is next ("might be leaving soon", rsprox 1105).
  cycle.next = chooseNext(rng);
}

// ---------------------------------------------------------------- visits

function startVisit(player, house) {
  const visit = { house, stolen: 0, warned: false, object: null, progress: 0, shiny: null, nextShiny: Infinity };
  visits.set(player, visit);
  player.setAttribute(INSIDE_ATTRIBUTE, house.key);
  return visit;
}

function clearShiny(player, visit) {
  if (!visit.shiny) return;
  visit.shiny = null;
  player.getPacketSender().clearHintArrow();
  setVarbit(player, "hintArrow", 0);
}

/** The visit is over (the window, being thrown out, a logout): the house's state is the player's no more. */
function endVisit(player) {
  const visit = visits.get(player);
  visits.delete(player);
  player.setAttribute(INSIDE_ATTRIBUTE, null);
  if (!visit) return;
  core.TaskManager.cancelTasks(player.getIndex());
  clearShiny(player, visit);
  setVarbit(player, "brokeIn", 0);
}

function putOutside(player, house) {
  endVisit(player);
  player.getMovementQueue().reset();
  player.moveTo(tile(house.outside));
}

/** Wiki: inside when the owner locks up, "escorted out". */
function escortOut(house) {
  for (const player of core.World.getPlayers()) {
    if (!player?.isRegistered?.() || !insideHouse(house, player.getLocation())) continue;
    putOutside(player, house);
    player.sendMessage(DATA.messages.escorted);
  }
}

/**
 * Wiki: caught by the returning owner, a thief is thrown out and loses about 90% of what they stole
 * in that house. Ours: no message (none is recorded); the thrown-out tile is the door's outside tile.
 */
function catchThieves(house) {
  let caught = false;
  for (const [player, visit] of [...visits]) {
    if (visit.house !== house || !insideHouse(house, player.getLocation())) continue;
    caught = true;
    const valuable = itemId("valuable");
    const kept = Math.floor(visit.stolen * DATA.search.caughtKeeps);
    const lost = Math.min(player.getInventory().getAmount(valuable), visit.stolen - kept);
    if (lost > 0) player.getInventory().delete(valuable, lost);
    putOutside(player, house);
  }
  return caught;
}

// ---------------------------------------------------------------- the door

function openDoor(event) {
  const { player, object } = event;
  const house = houseAt(object.getLocation());
  if (!house) return false;
  // Already in (a second click queued behind the first): one key, one visit.
  if (visits.has(player)) return true;
  if (vacantHouse() !== house) {
    player.sendMessage(NOTHING_INTERESTING);
    return true;
  }
  if (!questComplete(player)) {
    player.sendMessage(`You need to complete ${DATA.quest.name} before you can do that.`);
    return true;
  }
  // rsprox 1102: base 45, boosted 53 got in, so the door reads the boosted level.
  if (thieving(player) < DATA.level) {
    levelBox(player);
    return true;
  }
  const key = itemId("key");
  if (player.getInventory().getAmount(key) <= 0) {
    player.sendMessage(NOTHING_INTERESTING);
    return true;
  }
  if (!ownerAwayFromDoor(house)) {
    player.sendMessage(DATA.messages.nearDoor);
    return true;
  }
  breakIn(player, house, key);
  return true;
}

/** Captures (1102, 1104, 1105, 3275): the pick, the key and sound on arrival; in, two ticks later. */
function breakIn(player, house, key) {
  player.getMovementQueue().reset();
  player.setPositionToFace(tile(house.door));
  animate(player, "picklock");
  player.getInventory().delete(key, 1);
  synth(player, DATA.sounds.picklock.id, DATA.sounds.picklock.delay);
  setVarbit(player, "brokeIn", 1);
  player.getPacketSender().clearHintArrow();
  setVarbit(player, "hintArrow", 0);
  startVisit(player, house);
  later(2, () => {
    if (!player.isRegistered() || visits.get(player)?.house !== house) return;
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, DATA.messages.enter);
    player.moveTo(tile(house.entry));
    visits.get(player).entered = true;
    player.performAnimation(new core.Animation(-1));
    synth(player, DATA.sounds.enter);
    player.getSkillManager().addExperiences(core.Skill.THIEVING, DATA.search.enterXp);
  });
}

// ---------------------------------------------------------------- searching

function searchableName(objectId) {
  for (const [gameval, name] of Object.entries(DATA.locs.searchables)) {
    if (core.CacheDefinitions.getLocId(gameval) === objectId) return name;
  }
  return null;
}

function successChance(player) {
  const { chanceAt50, alwaysAt } = DATA.search;
  const level = thieving(player);
  if (level >= alwaysAt) return 1;
  return Math.max(0, chanceAt50 + ((1 - chanceAt50) * (level - DATA.level)) / (alwaysAt - DATA.level));
}

function lootTile(location) {
  return [location.getX(), location.getY()];
}

function search(event) {
  const { player, object } = event;
  const name = searchableName(object.getId());
  if (!name) return false;
  const visit = visits.get(player);
  const house = houseOfSearchable(object.getLocation());
  if (!visit || !house || visit.house !== house) {
    player.sendMessage(NOTHING_INTERESTING);
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, DATA.messages.full);
    return true;
  }
  const spot = lootTile(object.getLocation());
  const same = visit.object !== null && visit.object[0] === spot[0] && visit.object[1] === spot[1];
  player.getMovementQueue().reset();
  player.setPositionToFace(object.getLocation());
  if (visit.shiny && sameTile(object.getLocation(), visit.shiny.spot)) grabShiny(player, visit, spot);
  else {
    // Ours: clicking the object already being searched carries on with its rolls; the captures only switch.
    if (!same || visit.progress <= 0) {
      startObject(player, visit, spot);
      player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, DATA.messages.startSearch.replace("{name}", name));
    }
    animate(player, "search");
    if (!same) visit.nextShiny = cycle.tick + random(DATA.search.shinyDelay);
  }
  // A search is the player's action: their next click (keyed by index) ends it.
  core.TaskManager.cancelTasks(player.getIndex());
  core.TaskManager.submit(searchTask(player, visit));
  return true;
}

/** A new object: its rolls start again (captures: 28-32, re-rolled on every switch). */
function startObject(player, visit, spot) {
  visit.object = spot;
  visit.progress = random(DATA.search.progress);
  setVarbit(player, "lootProgress", visit.progress);
}

/** Captures: the bonus on arrival, the rolls re-set, the arrow gone; the object's own rolls go on from 3 ticks later. */
function grabShiny(player, visit, spot) {
  clearShiny(player, visit);
  startObject(player, visit, spot);
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, DATA.messages.grab);
  setVarbit(player, "specialLoc", 1);
  setVarbit(player, "specialLoc", 0);
  animate(player, "grab");
  steal(player, visit, DATA.search.shinyValuables, DATA.search.shinyXp, false);
  synth(player, DATA.sounds.grab);
  visit.nextShiny = cycle.tick + random(DATA.search.shinyDelay);
}

function sendLifetime(player, total) {
  const id = core.CacheDefinitions.getVarpId(DATA.varps.lifetime);
  if (id !== null) player.getPacketSender().sendConfig(id, total);
}

function steal(player, visit, count, xp, line = true) {
  player.getInventory().adds(itemId("valuable"), count);
  visit.stolen += count;
  if (line) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, DATA.messages.found);
    synth(player, DATA.sounds.found);
  }
  const total = (Number(player.getAttribute(LIFETIME_ATTRIBUTE)) || 0) + count;
  player.setAttribute(LIFETIME_ATTRIBUTE, total);
  sendLifetime(player, total);
  const most = Number(player.getAttribute(MOST_ATTRIBUTE)) || 0;
  if (visit.stolen > most) {
    player.setAttribute(MOST_ATTRIBUTE, visit.stolen);
    setVarbit(player, "mostValuables", visit.stolen);
  }
  player.getSkillManager().addExperiences(core.Skill.THIEVING, xp);
}

/** Every 3 ticks: one roll off the object, the animation again, and a valuable on a success. */
function searchTask(player, visit) {
  const task = new (class extends core.Task {
    constructor() {
      super(DATA.search.cycleTicks, player.getIndex(), false);
    }

    execute() {
      if (!player.isRegistered() || visits.get(player) !== visit || visit.progress <= 0) {
        this.stop();
        return;
      }
      // Wiki: at least one free inventory space to steal, as on the first search.
      if (player.getInventory().getFreeSlots() <= 0) {
        player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, DATA.messages.full);
        this.stop();
        return;
      }
      visit.progress -= 1;
      setVarbit(player, "lootProgress", visit.progress);
      animate(player, "search");
      if (Math.random() < successChance(player)) steal(player, visit, DATA.search.valuables, DATA.search.xp);
      if (visit.progress <= 0) this.stop();
    }
  })();
  return task;
}

/** Each tick: a visit's shiny object comes up, or goes again after 12 ticks. */
function processShinies(rng = Math.random) {
  const now = cycle.tick;
  for (const [player, visit] of visits) {
    if (!player.isRegistered()) {
      visits.delete(player);
      continue;
    }
    // Out of the house some other way (a teleport, death, another plugin's move): the visit is over.
    if (visit.entered && !insideHouse(visit.house, player.getLocation())) {
      endVisit(player);
      continue;
    }
    if (visit.shiny && now >= visit.shiny.until) {
      clearShiny(player, visit);
      visit.nextShiny = now + random(DATA.search.shinyDelay, rng);
    }
    if (visit.shiny || now < visit.nextShiny) continue;
    const others = visit.house.searchables.filter((spot) => !visit.object || spot[0] !== visit.object[0] || spot[1] !== visit.object[1]);
    const spot = pick(others, rng);
    visit.shiny = { spot, until: now + DATA.search.shinyTicks };
    setVarbit(player, "hintArrow", HINT_ARROW_SHOWN);
    player.sendMessage(DATA.messages.shiny);
    player.getPacketSender().clearHintArrow();
    player.getPacketSender().sendPositionalHint(tile(spot), 2, DATA.search.hintHeight, 0);
    synth(player, DATA.sounds.shiny);
  }
}

// ---------------------------------------------------------------- the world clock and hooks

function processWorld() {
  processCycle();
  processShinies();
}

function start() {
  houses.length = 0;
  for (const house of DATA.houses) houses.push({ ...house, npc: null });
  cycle.tick = 0;
  cycle.phase = "home";
  cycle.next = null;
  cycle.last = null;
  cycle.nextLeave = random(DATA.cycle.nextLeave);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1);
    }

    execute() {
      processWorld();
    }
  })());
}

/** "loc-teleports:arrived": out of the window, the visit is over. */
function leftByWindow({ player, objectId }) {
  if (objectId === core.CacheDefinitions.getLocId(DATA.locs.window)) endVisit(player);
}

/** "loc-teleports:ask": after the whistle the window goes straight out, with no question (rsprox 1102, 1104, 1105). */
function windowQuestion(question) {
  if (question.objectId !== core.CacheDefinitions.getLocId(DATA.locs.window)) return;
  if (visits.get(question.player)?.warned) question.ask = false;
}

/**
 * Wiki: logging out inside puts the player outside the house. Moved before the save (logout hooks run first), so
 * the saved tile is the door's outside one; the saved key covers a session that ends without this hook.
 */
function onLogout({ player }) {
  const visit = visits.get(player);
  if (visit && insideHouse(visit.house, player.getLocation())) player.setLocation(tile(visit.house.outside));
  endVisit(player);
}

/** A relog inside a house puts the player outside its door; the counters go to the client. */
function onLogin({ player }) {
  const lifetime = Number(player.getAttribute(LIFETIME_ATTRIBUTE)) || 0;
  if (lifetime > 0) sendLifetime(player, lifetime);
  const most = Number(player.getAttribute(MOST_ATTRIBUTE)) || 0;
  if (most > 0) setVarbit(player, "mostValuables", most);
  const key = player.getAttribute(INSIDE_ATTRIBUTE);
  if (!key) return;
  const house = DATA.houses.find((candidate) => candidate.key === key);
  player.setAttribute(INSIDE_ATTRIBUTE, null);
  if (house && insideHouse(house, player.getLocation())) player.moveTo(tile(house.outside));
}

/**
 * "house-robbery:state" { house, status }: what the urchins tell (HouseRobberyCrew). `status` is
 * "leaving-soon" (the next owner is still in, or on the way out), "vacant", or "returning".
 */
function answerState(request) {
  const house = cycle.phase === "home" ? cycle.next : cycle.house;
  request.house = house ? DATA.houses.find((candidate) => candidate.key === house.key) ?? null : null;
  request.status = cycle.phase === "home" || cycle.phase === "leaving" ? "leaving-soon" : cycle.phase === "away" ? "vacant" : "returning";
  if (!request.house) request.status = null;
}

function register(api) {
  core = api.core;
  pluginApi = api;
  api.persistAttribute(INSIDE_ATTRIBUTE, null);
  api.persistAttribute(LIFETIME_ATTRIBUTE, 0);
  api.persistAttribute(MOST_ATTRIBUTE, 0);
  api.onServerStartup(start);
  api.onObjectInteraction("Locked Door", { Open: openDoor });
  api.onObjectInteraction("Chest", { Search: search });
  api.onObjectInteraction("Wardrobe", { Search: search });
  api.onObjectInteraction("Jewellery case", { Search: search });
  api.onCustomEvent("loc-teleports:arrived", leftByWindow);
  api.onCustomEvent("loc-teleports:ask", windowQuestion);
  api.onCustomEvent("house-robbery:state", answerState);
  api.onPlayerLogout(onLogout);
  api.onPlayerLogin(onLogin);
}

module.exports = register;
module.exports.LIFETIME_ATTRIBUTE = LIFETIME_ATTRIBUTE;
module.exports._test = {
  DATA, houses, cycle, visits, start, processCycle, processShinies, openDoor, search, catchThieves, successChance,
  leftByWindow, windowQuestion, onLogin, onLogout, insideHouse, answerState, INSIDE_ATTRIBUTE,
};
