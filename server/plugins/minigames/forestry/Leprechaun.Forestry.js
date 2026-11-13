/**
 * The Woodcutting Leprechaun, as recorded (rsprox 227/01850, 00083, 01723, 01855, 237/01104 and
 * 01098; forestry.json `leprechaun`):
 * - he appears on a clover by the tree in a puff of smoke (map_anim 1180, sound_area 1930):
 *   "It be yer lucky day, Foresters!";
 * - an End of Rainbow comes within 1-9 tiles every 37 ticks, at a random rotation, with sound_area
 *   7545; 17 ticks on it plays its despawn anim and 7544, and is gone at 20;
 * - standing in it: "You feel more in touch with the trees after standing in the rainbow.",
 *   spotanim 2580 and synth 7551, and 12 more luck (varbit 15344: 0->12, 2->14 in 237/01104);
 *   varbit 15343 is 6 from the player's first contact with him, then 6 minus the rainbow's number;
 * - each log then spends 5 luck on 22-23 bark the tick after: "You use your leprechaun's luck to
 *   gather some Anima-infused bark." (spam), or, leaving under 5, "You use the last of your
 *   leprechaun's luck..." (a game message);
 * - the luck outlives him: logs spend it after he has gone (01850 t8912, t8923) and it is kept
 *   across logins (237/01104 logs in with 2);
 * - Talk-to, and Deposit: "Bank all the items in your inventory?" (all of it, only woodcutting
 *   resources, nothing, or the deposit box); the first two play no animation;
 * - "I'll have to go shortly..." at 186 ticks, "Well, I must be getting on now." at 223, gone in
 *   smoke at 224.
 * Wiki: six rainbows; a luck log's XP is about 1.33 x level + 38.7 more [confirmation needed]; he
 * banks everything for those who were chopping, else only woodcutting resources.
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");
const Woodcutting = require("../../skills/Woodcutting.plugin");

/** The player's leprechaun luck (varbit 15344): it outlives the leprechaun that gave it. */
const LUCK_ATTRIBUTE = "forestry:leprechaun-luck";

const L = () => Common.data.leprechaun;
/** Leprechauns now on the map. */
const events = new Set();
/** How near him the Deposit menu still works. */
const BANK_RANGE = 3;

/** His puff of smoke and its sound, as he comes and goes. */
function smoke(location) {
  const { spotanims, smokeHeight, sounds, soundRange } = L();
  for (const player of Common.nearbyPlayers(location, 15)) {
    player.getPacketSender().sendGraphic(new Common.core.Graphic(spotanims.smoke, 0, smokeHeight), location);
  }
  Common.areaSound(location, sounds.smoke, soundRange.smoke);
}

function start(site) {
  const lep = L();
  const tiles = Common.freeTiles(site, site.location, 3, site.size);
  if (tiles.length < 1) return null;
  const event = { site, elapsed: 0, rainbows: [], made: 0, met: new Set(), over: false };
  event.npc = Common.spawnNpc(lep.npc, tiles[0]);
  event.npc.forceChat?.(lep.lines.start);
  smoke(tiles[0]);
  event.clover = Common.placeLoc(lep.locs.clover, tiles[0]);
  events.add(event);
  Common.every(() => tick(event));
  return event;
}

function luckOf(player) {
  return Number(player.getAttribute(LUCK_ATTRIBUTE) ?? 0) || 0;
}

function setLuck(player, value) {
  const luck = Math.max(0, Math.min(255, value));
  player.setAttribute(LUCK_ATTRIBUTE, luck);
  player.getPacketSender().sendVarbit?.(L().varbits.luck, luck);
}

function setSlot(player, value) {
  player.getPacketSender().sendVarbit?.(L().varbits.slot, value);
}

/** The player's first contact with this leprechaun (a rainbow, Talk-to or Deposit) resets the slot to 6. */
function meet(event, player) {
  if (event.met.has(player)) return;
  event.met.add(player);
  setSlot(player, L().rainbows);
}

function rainbow(event) {
  const lep = L();
  const [near, far] = lep.rainbowRange;
  const here = event.npc.getLocation();
  const at = Common.freeTiles(event.site, here, far).find((tile) => Common.distance(tile, here) >= near);
  if (!at) return;
  event.made++;
  const object = Common.placeLoc(lep.locs.rainbow, at, Common.randomInt(0, 3));
  Common.areaSound(at, lep.sounds.rainbow, lep.soundRange.rainbow);
  event.rainbows.push({ object, at, slot: event.made, bornAt: event.elapsed, stood: new Set() });
}

/** Whoever stands in a rainbow gets its luck, once. */
function standIn(event) {
  const lep = L();
  for (const bow of event.rainbows) {
    const players = new Set([...event.site.participants, ...Common.nearbyPlayers(bow.at, 0)]);
    for (const player of players) {
      if (bow.stood.has(player) || !player.getLocation().equals(bow.at)) continue;
      bow.stood.add(player);
      if (!Spawns.eligible(event, player)) continue;
      meet(event, player);
      setSlot(player, lep.rainbows - bow.slot);
      setLuck(player, luckOf(player) + lep.luckPerRainbow);
      player.sendMessage(Common.message("rainbow"));
      player.performGraphic?.(new Common.core.Graphic(lep.spotanims.rainbowPower));
      Common.sound(player, lep.sounds.rainbowPower);
    }
  }
}

function tick(event) {
  if (event.over) return false;
  event.elapsed++;
  const lep = L();
  if (event.elapsed === lep.warnAt) event.npc.forceChat?.(lep.lines.warn);
  if (event.elapsed === lep.byeAt) event.npc.forceChat?.(lep.lines.bye);
  if (event.elapsed >= lep.lifeTicks) {
    end(event);
    return false;
  }
  if (event.made < lep.rainbows && (event.elapsed - 1) % lep.rainbowEvery === 0) rainbow(event);
  for (const bow of [...event.rainbows]) {
    const age = event.elapsed - bow.bornAt;
    if (age === lep.rainbowFade) {
      Common.locAnim(bow.object, lep.seqs.rainbowGone);
      Common.areaSound(bow.at, lep.sounds.rainbowGone, lep.soundRange.rainbow);
    }
    if (age >= lep.rainbowLife) {
      Common.removeLoc(bow.object);
      event.rainbows.splice(event.rainbows.indexOf(bow), 1);
    }
  }
  standIn(event);
  return true;
}

/** He goes in smoke; the luck he gave stays with the players. */
function end(event) {
  event.over = true;
  events.delete(event);
  for (const bow of event.rainbows) Common.removeLoc(bow.object);
  event.rainbows = [];
  smoke(event.npc.getLocation());
  Common.removeLoc(event.clover);
  Common.removeNpc(event.npc);
  Spawns.ended(event);
}

/** A log with luck to spend: bark the tick after, and the extra XP. */
function logChopped({ player }) {
  const lep = L();
  const left = luckOf(player);
  if (left < lep.luckPerLog) return;
  const record = Spawns.choppers.get(player);
  if (!record || !Spawns.eligibleTree(record.name)) return;
  const after = left - lep.luckPerLog;
  setLuck(player, after);
  if (after < lep.luckPerLog) player.sendMessage(Common.message("lastLuck"));
  else Common.spam(player, Common.message("luck"));
  Common.later(1, () => Common.bark(player, Common.randomInt(...lep.bark)));
  Common.xp(player, "WOODCUTTING", lep.xp.perLevel * Common.level(player, "WOODCUTTING") + lep.xp.plus);
}

/** The luck's varbit at login. */
function loggedIn({ player }) {
  const luck = luckOf(player);
  if (luck > 0) player.getPacketSender().sendVarbit?.(L().varbits.luck, luck);
}

function eventOf(npc) {
  for (const event of events) if (event.npc === npc) return event;
  return null;
}

function talk({ player, npc }) {
  const event = eventOf(npc);
  if (!event) return false;
  meet(event, player);
  const lines = [["npc", L().lines.talk]];
  if (event.site.participants.has(player)) lines.push(["npc", L().lines.talkBank]);
  Common.chat(player, L().npc, lines);
  return true;
}

function woodcuttingResource(id) {
  return Woodcutting.TREES.some((tree) => tree.logId === id) || Object.values(Common.data.leaves).includes(id) || id === Common.data.items.bark;
}

/** Banks what he will: all of it for those who were chopping, else woodcutting resources. */
function nearHim(player, event) {
  return !event.over && Common.distance(player.getLocation(), event.npc.getLocation()) <= BANK_RANGE;
}

function bankItems(player, event, onlyResources) {
  if (!nearHim(player, event)) return;
  const { Bank } = Common.core;
  if (Common.api.emitCanBank?.(player, "forestry-leprechaun") === false) return;
  const everything = !onlyResources && event.site.participants.has(player);
  const inventory = player.getInventory();
  let refused = false;
  // Wiki (Woodcutting Leprechaun): for those chopping he is "a bank deposit box for all items in the inventory and log
  // basket": a carried or worn basket's logs go first, then the inventory (the basket with it).
  if (everything) {
    const basket = { player, key: "log-basket", moved: 0, left: 0 };
    Common.api.emitCustomEvent("storage:empty-to-bank", basket);
    if (basket.left > 0) refused = true;
  }
  inventory.getItems().forEach((item, slot) => {
    if (!item || item.getId() <= 0) return;
    if (!everything && !woodcuttingResource(item.getId())) return;
    const before = inventory.getAmount(item.getId());
    Bank.deposit(player, item.getId(), slot, item.getAmount(), true);
    if (inventory.getAmount(item.getId()) >= before) refused = true;
  });
  inventory.refreshItems?.();
  if (refused) player.sendMessage(Common.message("cantBank"));
}

function deposit({ player, npc }) {
  const event = eventOf(npc);
  if (!event) return false;
  meet(event, player);
  const [title, all, resources, none, box] = L().bankMenu;
  Common.api.sendMultiChatboxPrompt(player, title,
    all, () => bankItems(player, event, false),
    resources, () => bankItems(player, event, true),
    none, () => {},
    box, () => {
      if (nearHim(player, event)) Common.api.emitCustomEvent("bank:open-deposit-box", { player });
    });
  return true;
}

function attachLeprechaun(api) {
  Spawns.registerEvent("leprechaun", { start });
  api.onCustomEvent("woodcutting:success", logChopped);
  api.onNpcInteraction("Woodcutting Leprechaun", { "Talk-to": talk, Deposit: deposit });
  api.persistAttribute(LUCK_ATTRIBUTE, 0);
  api.onPlayerLogin(loggedIn);
}

module.exports = { attachLeprechaun, start, logChopped, deposit, events, luckOf, LUCK_ATTRIBUTE };
