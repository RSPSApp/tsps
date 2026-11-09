/**
 * The Beehive, as recorded (rsprox 227/01855, 00075, 237/01104, 01098; forestry.json `beehive`):
 * - the bee keeper ("Oh, Bees!"), an unfinished beehive, the wild hive and bees appear by the
 *   tree, the keeper and the box each in a puff of smoke (map_anim 1180, sound 1930), sound 7529
 *   at the wild hive;
 * - Build asks "How many logs would you like to add?" (skillmulti, the first log type carried and
 *   how many). The pickup seq plays on the choice; the logs go the tick after and every two ticks
 *   after that, each with its bark and synth 7543, 7548 or 7554, the seq again before every log
 *   but the last. They fill the box's bar (headbar 17); at 60% it changes form;
 * - on the last log the box is complete (sound 7536, and 3046 after 50) and the keeper says one of
 *   "Come with me little bees I'll keep you safe.", "I'll find a nice new home for those bees." and
 *   "Another new hive."; the tick after, "Well done, you've completed a beehive. The bees can now be
 *   safely rehomed.", sometimes sturdy beehive parts ("The temporary beehive was made so well you
 *   take some parts for building a permanent hive." and synth 2655), and a new unfinished box in a
 *   puff of smoke within three tiles; the bark the tick after that; the old box goes in smoke 5
 *   ticks after the last log;
 * - with no logs: the item box "You have no logs to build this beehive."; on a complete hive "The
 *   hive is complete and won't benefit from any more wood.";
 * - Talk-to: "Hello, what's going on?", "Hello, it seems you've found a wild beehive. I'll pay you
 *   to help me rehome them.", then "I'm not interested." / "How can I help?"; the second has him
 *   explain ("It's easy, simply add logs to the unfinished bee boxes I create...", "Once a bee box
 *   is completed I will start a new one...");
 * - at 247 ticks "Well, I must be getting on now."; at 249 he goes in smoke (sound 7531); at 250
 *   all else is gone.
 * Wiki: 5 logs a player (at most 50) a hive; bark and XP a log by its tier; 25-30 bark and
 * 5.45x - 0.02x^2 Woodcutting XP a hive; parts 2/3 of the time. Inferred: the chatmenu's first
 * option said back by the player (its reply isn't recorded).
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");

const B = () => Common.data.beehive;
/** Beehive events now on the map. */
const events = new Set();
/** Players building -> { event, box, logId, left, next, from }. */
const sessions = new Map();

let cycle = 0;
/** When each player may next add a log, so choosing again can't hurry it. */
const nextLog = new WeakMap();

/** A puff of smoke and its sound on a tile, as the keeper and the boxes come and go. */
function smoke(location, range) {
  const { smoke: graphic, smokeHeight, sounds } = B();
  for (const player of Common.nearbyPlayers(location, 15)) {
    player.getPacketSender().sendGraphic(new Common.core.Graphic(graphic, 0, smokeHeight), location);
  }
  Common.areaSound(location, sounds.smoke, range);
}

function start(site) {
  const beehive = B();
  const tiles = Common.freeTiles(site, site.location, beehive.range, site.size);
  if (tiles.length < 4) return null;
  const { sounds } = beehive;
  const event = { site, elapsed: 0, needed: Math.min(beehive.maxLogs, beehive.logsPerPlayer * Math.max(1, site.participants.size)), oldBoxes: new Set(), over: false };
  event.wild = Common.spawnNpc(beehive.npcs.wild, tiles[1]);
  event.bees = [Common.spawnNpc(beehive.npcs.bees, tiles[1]), Common.spawnNpc(beehive.npcs.bees, tiles[1])];
  Common.areaSound(tiles[1], sounds.wild, sounds.boxRange);
  event.keeper = Common.spawnNpc(beehive.npcs.keeper, tiles[0]);
  event.keeper.forceChat?.(beehive.lines.start);
  smoke(tiles[0], sounds.keeperRange);
  event.box = newBox(event, tiles[2]);
  events.add(event);
  Common.every(() => tick(event));
  return event;
}

function newBox(event, at) {
  const box = { npc: Common.spawnNpc(B().npcs.boxes[0], at), logs: 0, builders: new Set(), done: false };
  showFill(event, box);
  smoke(at, B().sounds.boxRange);
  return box;
}

function showFill(event, box) {
  const { id, width } = B().headbar;
  box.npc.showHeadbar?.(id, { fill: Math.round((width * box.logs) / event.needed) });
}

function tick(event) {
  if (event.over) return false;
  event.elapsed++;
  const { lifeTicks, byeAt, keeperLeaves, lines } = B();
  if (event.elapsed === byeAt) event.keeper.forceChat?.(lines.bye);
  if (event.elapsed === keeperLeaves) keeperGoes(event);
  if (event.elapsed >= lifeTicks) {
    end(event);
    return false;
  }
  return true;
}

/** The keeper leaves a tick before the rest, in smoke. */
function keeperGoes(event) {
  const { sounds } = B();
  const at = event.keeper.getLocation().clone();
  Common.removeNpc(event.keeper);
  event.keeperGone = true;
  smoke(at, sounds.keeperRange);
  Common.areaSound(at, sounds.leave, sounds.leaveRange);
}

function end(event) {
  event.over = true;
  events.delete(event);
  for (const [player, session] of sessions) if (session.event === event) sessions.delete(player);
  if (!event.keeperGone) Common.removeNpc(event.keeper);
  for (const npc of [event.wild, ...event.bees, event.box.npc, ...[...event.oldBoxes].map((box) => box.npc)]) Common.removeNpc(npc);
  Spawns.ended(event);
}

/** The tier a log belongs to. */
function tierOf(id) {
  const { tiers } = B();
  return Object.values(tiers).find((tier) => tier.logs.includes(id)) ?? null;
}

/** The first logs in the pack Build takes. */
function logsIn(player) {
  const { tiers } = B();
  for (const tier of ["normal", "oak", "better"]) {
    for (const id of tiers[tier].logs) if (player.getInventory().contains(id)) return id;
  }
  return null;
}

function boxOf(npc) {
  for (const event of events) {
    if (event.box.npc === npc) return { event, box: event.box };
    for (const box of event.oldBoxes) if (box.npc === npc) return { event, box };
  }
  return null;
}

/** Build: the recorded how-many menu for the first logs carried. */
function build({ player, npc }) {
  const found = boxOf(npc);
  if (!found) return false;
  const { event, box } = found;
  const beehive = B();
  if (box.done) {
    Common.objectBox(player, beehive.logIcon, Common.message("hiveComplete"));
    return true;
  }
  const logId = logsIn(player);
  if (!logId) {
    Common.objectBox(player, beehive.logIcon, Common.message("noLogs"));
    return true;
  }
  player.setPositionToFace?.(npc.getLocation());
  sessions.delete(player);
  const { CreationMenu } = Common.core;
  player.getPacketSender().sendCreationMenu(new CreationMenu(Common.message("logsMenu"), [logId], {
    execute: (id, amount) => begin(player, event, box, id, amount),
  }, { mode: beehive.menuMode, maxAmount: player.getInventory().getAmount(logId) }));
  return true;
}

/** The choice: the pickup seq now, the first log the tick after. */
function begin(player, event, box, logId, amount) {
  if (event.over || box.done || event.box !== box || !(amount > 0)) return;
  sessions.set(player, { event, box, logId, left: amount, next: Math.max(cycle + 1, nextLog.get(player) ?? 0), from: player.getLocation().clone() });
  Common.animate(player, B().pickup);
}

/** One log into the box; whether the player goes on to another. */
function addLog(player, session) {
  const { event, box, logId } = session;
  if (!player.getInventory().contains(logId)) return false;
  const beehive = B();
  const tier = tierOf(logId);
  player.getInventory().delete(logId, 1);
  Common.sound(player, Common.pick(beehive.sounds.logs));
  session.left--;
  box.logs++;
  box.builders.add(player);
  showFill(event, box);
  if (Spawns.eligible(event, player)) {
    Common.bark(player, Common.randomInt(...tier.bark));
    const [low, high] = tier.woodcutting;
    Common.xp(player, "WOODCUTTING", Common.level(player, "WOODCUTTING") * (low + Math.random() * (high - low)));
    Common.xp(player, "CONSTRUCTION", Common.level(player, "CONSTRUCTION") * tier.construction);
  } else {
    Common.xp(player, "WOODCUTTING", 1);
  }
  if (box.logs >= event.needed) {
    complete(event, box);
    return false;
  }
  if (box.logs / event.needed >= beehive.headbar.secondForm) box.npc.setNpcTransformationId?.(beehive.npcs.boxes[1]);
  const more = session.left > 0 && player.getInventory().contains(logId);
  if (more) Common.animate(player, beehive.pickup);
  return more;
}

/** The hive is done: the keeper's line now, the builders' line, parts and a fresh box the tick after, the lump after that. */
function complete(event, box) {
  const beehive = B();
  const { sounds } = beehive;
  const at = box.npc.getLocation().clone();
  box.done = true;
  box.npc.setNpcTransformationId?.(beehive.npcs.boxes[2]);
  Common.areaSound(at, sounds.complete[0], sounds.boxRange);
  Common.areaSound(at, sounds.complete[1], sounds.boxRange, sounds.completeDelay);
  event.keeper.forceChat?.(Common.pick(beehive.lines.done));
  event.oldBoxes.add(box);
  Common.later(1, () => rehome(event, box, at));
  Common.later(2, () => lump(event, box));
  Common.later(beehive.doneRemoveTicks, () => removeOldBox(event, box));
}

function rehome(event, box, at) {
  if (event.over) return;
  const beehive = B();
  for (const player of box.builders) {
    player.sendMessage(Common.message("hiveDone"));
    if (!player.isRegistered?.() || !event.site.participants.has(player) || Math.random() >= beehive.partsChance) continue;
    player.sendMessage(Common.message("hiveParts"));
    Common.give(player, beehive.parts, 1);
    Common.sound(player, beehive.sounds.parts);
  }
  // No room elsewhere: the next one goes where this one stood.
  const next = Common.freeTiles(event.site, at, beehive.range).find((tile) => !tile.equals(at)) ?? at;
  event.box = newBox(event, next);
}

function lump(event, box) {
  for (const player of box.builders) {
    if (!player.isRegistered?.() || !event.site.participants.has(player)) continue;
    Common.bark(player, Common.randomInt(...B().hiveBark), true);
    const level = Common.level(player, "WOODCUTTING");
    Common.xp(player, "WOODCUTTING", 5.45 * level - 0.02 * level * level);
  }
}

function removeOldBox(event, box) {
  event.oldBoxes.delete(box);
  if (event.over) return;
  smoke(box.npc.getLocation().clone(), B().sounds.boxRange);
  Common.removeNpc(box.npc);
}

/** A log every two ticks while the player stays and the hive needs them. */
function buildTick() {
  cycle++;
  for (const [player, session] of sessions) {
    if (!player.isRegistered?.() || session.event.over || session.box.done || !player.getLocation().equals(session.from)) {
      sessions.delete(player);
      continue;
    }
    if (cycle < session.next) continue;
    session.next = cycle + B().logTicks;
    nextLog.set(player, session.next);
    if (!addLog(player, session)) sessions.delete(player);
  }
}

/** Talk-to: the recorded greeting, the chatmenu and his explanation. */
function talk({ player, npc }) {
  if (![...events].some((event) => event.keeper === npc)) return false;
  const { talk: lines, chatheads, npcs } = B();
  const [hello, intro, no, yes, easy, again] = lines;
  const { chatquiz1, chathap2 } = chatheads;
  Common.chat(player, npcs.keeper, [["player", hello, chatquiz1], ["npc", intro, chathap2]], () => {
    Common.menu(player,
      [no, () => Common.chat(player, npcs.keeper, [["player", no, chatquiz1]])],
      [yes, () => Common.chat(player, npcs.keeper, [["npc", easy, chathap2], ["npc", again, chathap2]])]);
  });
  return true;
}

function forget({ player }) {
  sessions.delete(player);
}

/** Anything else the player clicks ends their building. */
function otherAction({ player, npc }) {
  const session = sessions.get(player);
  if (session && npc !== session.box.npc) sessions.delete(player);
}

function attachBeehive(api) {
  Spawns.registerEvent("beehive", { start });
  api.onNpcInteraction("<col=00ffff>Unfinished Beehive</col>", { Build: build });
  api.onNpcInteraction("<col=00ffff>Complete Beehive</col>", { Build: build });
  api.onNpcInteraction("Bee keeper", { "Talk-to": talk });
  api.onPlayerLogout(forget);
  api.onNpcInteraction(otherAction);
  api.onObjectInteraction(otherAction);
  Common.every(buildTick);
}

module.exports = { attachBeehive, start, build, buildTick, events, sessions };
