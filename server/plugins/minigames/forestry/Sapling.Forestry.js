/**
 * Struggling Sapling, as recorded (rsprox 227/00083, 01723 and 01850: successes; 237/01098: the
 * failure; forestry.json `sapling`):
 * - the sapling (2x2 or 3x3, by the tree) takes the tree's place, with an npc carrying its
 *   400-tick timer (headbar 6) and progress (headbar 17), and five ingredient piles within four
 *   tiles;
 * - Collect builds mulch from three ingredients ("You create some mulch using droppings as the
 *   first ingredient.", "...as the second ingredient.", "...third..."); a fourth is refused;
 * - Add-mulch scores it against the sapling's recipe of one ingredient per slot, then gives:
 *   - the reach (pickup seq) and sound 2427, then sound 7004 (7009 below 70%) with the
 *     nutrition line, and the hitsplat of 0.6 x the nutrition; "It seems to love it!" (100%) is
 *     spam when the player's last feed was also loved, a game message otherwise;
 *   - a hint, with sound 7012, for each right slot not hinted to the player before (a perfect
 *     mulch can give two); "The sapling seems to love this combination of ingredients!" the first
 *     time the player gets all three;
 *   - bark the next tick, and Woodcutting and Farming XP;
 * - saved: "Well done, you've saved the sapling and allowed it to flourish! It appears to have a
 *   gift for you...", the thriving sapling, then bark, leaves and bonus XP the next tick; the tree
 *   comes back 14 ticks later;
 * - not saved in 400 ticks: "The sapling withers due to lack of nutrients."
 * Wiki: 900 HP a player (at most 9,000), bark 1-12 a feed, the bonus bark by average nutrition,
 * 15-20 leaves. Inferred: the nutrition is 10 + 30 for each right slot + 10 for each right
 * ingredient in the wrong slot (it gives every value recorded: 10, 20, 40, 50, 60, 70, 100), and the
 * hint names the first right slot.
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");

const S = () => Common.data.sapling;
/** Saplings now on the map. */
const saplings = new Set();
/** Ingredient indexes put in each player's mulch, in order. */
const MULCH_ATTRIBUTE = "forestry:mulch";

function sizeOf(site) {
  return site.size >= 3 ? 3 : 2;
}

/** Tiles around the tree, outside it, where a pile can go. */
function pileTiles(site, size) {
  const { ingredientRange: range } = S();
  const [x0, y0, z] = [site.location.getX(), site.location.getY(), site.location.getZ()];
  const tiles = [];
  for (let x = x0 - range; x < x0 + size + range; x++) {
    for (let y = y0 - range; y < y0 + size + range; y++) {
      const inside = x >= x0 && x < x0 + size && y >= y0 && y < y0 + size;
      if (!inside && Common.walkable(x, y, z)) tiles.push(new Common.core.Location(x, y, z));
    }
  }
  return tiles;
}

function start(site) {
  const sapling = S();
  const size = sizeOf(site);
  const tiles = pileTiles(site, size);
  if (tiles.length < sapling.ingredients.length) return null;
  const event = {
    site,
    size,
    loc: Common.placeLoc(sapling.locs[size], site.location, site.tree.getFace?.() ?? 0),
    piles: [],
    recipe: Array.from({ length: 3 }, () => Common.randomInt(0, sapling.ingredients.length - 1)),
    progress: 0,
    target: Math.min(sapling.hpCap, sapling.hpPerPlayer * Math.max(1, site.participants.size)),
    elapsed: 0,
    fed: new Map(),
    collectors: new Set(),
    over: false,
  };
  sapling.ingredients.forEach((ingredient, index) => {
    const at = tiles.splice(Common.randomInt(0, tiles.length - 1), 1)[0];
    const id = Array.isArray(ingredient.loc) ? Common.pick(ingredient.loc) : ingredient.loc;
    event.piles.push({ index, object: Common.placeLoc(id, at) });
  });
  event.npc = spawnMeter(event, site.location);
  Common.tileGraphic(site.location, sapling.spawnGraphic);
  for (const id of sapling.sounds.spawn) Common.areaSound(site.location, id);
  saplings.add(event);
  Common.every(() => tick(event));
  return event;
}

/** The npc that carries the sapling's bars (it has no options). */
function spawnMeter(event, location) {
  const { NPC, World } = Common.core;
  const npc = NPC.create(S().npcs[event.size], location.clone());
  npc.__skipDefaultRespawn = true;
  npc.getMovementCoordinator?.().setRadius?.(0);
  World.getAddNPCQueue().push(npc);
  showTimer(event, npc);
  npc.showHeadbar(S().headbars.progress, { fill: 1 });
  return npc;
}

/** Headbar 6 runs down to the end; it is resent every five ticks, as recorded. */
function showTimer(event, npc = event.npc) {
  const { lifeTicks, headbars } = S();
  const left = Math.max(0, lifeTicks - event.elapsed);
  npc.showHeadbar(headbars.timer, { fill: Math.round((headbars.width * left) / lifeTicks), endFill: 0, duration: left * 30 });
}

function tick(event) {
  if (event.over) return false;
  event.elapsed++;
  if (event.elapsed >= S().lifeTicks) {
    finish(event, false);
    return false;
  }
  if (event.elapsed % S().timerResendTicks === 0) showTimer(event);
  return true;
}

function eventAt(object) {
  const at = object.getLocation();
  for (const event of saplings) {
    if (event.loc.getLocation().equals(at) || event.piles.some((pile) => pile.object.getLocation().equals(at))) return event;
  }
  return null;
}

function mulchStage(player) {
  const [one, two, three] = Common.data.items.mulch;
  const inventory = player.getInventory();
  if (inventory.contains(three)) return 3;
  if (inventory.contains(two)) return 2;
  if (inventory.contains(one)) return 1;
  return 0;
}

function mulchOf(player) {
  const mulch = player.getAttribute(MULCH_ATTRIBUTE);
  return Array.isArray(mulch) && mulch.length === mulchStage(player) ? mulch : [];
}

function collect({ player, object }) {
  const event = eventAt(object);
  const pile = event?.piles.find((p) => p.object.getLocation().equals(object.getLocation()));
  if (!pile) return false;
  const { mulch: ids } = Common.data.items;
  const stage = mulchStage(player);
  if (stage === 3) {
    player.sendMessage(Common.message("mulchFull"));
    return true;
  }
  const inventory = player.getInventory();
  if (stage === 0 && inventory.getFreeSlots() <= 0) {
    inventory.full?.();
    return true;
  }
  const mulch = [...mulchOf(player), pile.index];
  const name = S().ingredients[pile.index].name;
  player.performAnimation(new Common.core.Animation(S().pickup));
  Common.sound(player, S().sounds.collect);
  if (stage > 0) inventory.delete(ids[stage - 1], 1);
  inventory.add(new Common.core.Item(ids[mulch.length - 1], 1), true);
  player.setAttribute(MULCH_ATTRIBUTE, mulch);
  event.collectors.add(player);
  Common.spam(player, mulch.length === 1
    ? Common.message("mulchFirst", { ingredient: name })
    : Common.message("mulchNext", { ingredient: name, ordinal: Common.ORDINALS[mulch.length - 1] }));
  return true;
}

/** 10, +30 for each slot that's right, +10 for each other ingredient the recipe has. */
function nutrition(recipe, mulch) {
  let value = 10;
  const left = [];
  const wrong = [];
  mulch.forEach((index, slot) => {
    if (recipe[slot] === index) value += 30;
    else {
      left.push(recipe[slot]);
      wrong.push(index);
    }
  });
  for (const index of wrong) {
    const at = left.indexOf(index);
    if (at >= 0) {
      value += 10;
      left.splice(at, 1);
    }
  }
  return value;
}

function units(percent) {
  return S().units[String(percent)] ?? Math.max(1, Math.round(percent / 10));
}

function addMulch({ player, object }) {
  const event = eventAt(object);
  if (!event || event.over || !event.loc.getLocation().equals(object.getLocation())) return false;
  const stage = mulchStage(player);
  if (stage === 0) {
    player.sendMessage(Common.message("noMulch"));
    return true;
  }
  if (stage < 3) {
    player.sendMessage(Common.message("mulchShort"));
    return true;
  }
  const mulch = mulchOf(player);
  player.getInventory().delete(Common.data.items.mulch[2], 1);
  player.setAttribute(MULCH_ATTRIBUTE, null);
  const percent = nutrition(event.recipe, mulch);
  feed(event, player, mulch, percent);
  return true;
}

/** Per player: the slots already hinted, whether the last feed was loved, and whether they've had the perfect box. */
function feedback(event, player) {
  event.feedback ??= new Map();
  if (!event.feedback.has(player)) event.feedback.set(player, { hinted: new Set(), loved: false, perfect: false });
  return event.feedback.get(player);
}

function feed(event, player, mulch, percent) {
  const { sounds } = S();
  const seen = feedback(event, player);
  player.performAnimation(new Common.core.Animation(S().pickup));
  Common.sound(player, sounds.addMulch);
  Common.spam(player, Common.message("addMulch"));
  Common.sound(player, percent >= 70 ? sounds.liked : sounds.accepted);
  const line = Common.message(percent >= 100 ? "love" : percent >= 50 ? "like" : "accept", { percent });
  if (percent >= 100 && seen.loved) Common.spam(player, line);
  else player.sendMessage(line);
  seen.loved = percent >= 100;
  mulch.forEach((index, slot) => {
    if (event.recipe[slot] !== index || seen.hinted.has(slot)) return;
    seen.hinted.add(slot);
    Common.sound(player, sounds.hint);
    player.sendMessage(Common.message("hint", { ingredient: S().ingredients[index].name, ordinal: Common.ORDINALS[slot] }));
  });
  if (percent >= 100 && !seen.perfect) {
    seen.perfect = true;
    player.sendMessage(Common.message("perfect"));
    const { DialogueChainBuilder, EndDialogue, ItemStatementDialogue } = Common.core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new ItemStatementDialogue(0, Common.data.items.mulch[2], Common.message("perfectBox")))
      .add(new EndDialogue(1)));
  }
  const heal = Math.round(0.6 * percent);
  event.progress = Math.min(event.target, event.progress + heal);
  event.npc.showHitsplat(heal, { mine: S().hitsplat, others: S().hitsplat }, {
    current: event.progress, max: event.target, bar: { id: S().headbars.progress, width: S().headbars.width },
  });
  reward(event, player, percent);
  if (event.progress >= event.target) finish(event, true);
}

function reward(event, player, percent) {
  if (!Spawns.eligible(event, player)) {
    Common.xp(player, "WOODCUTTING", 1);
    return;
  }
  const share = units(percent) / 12;
  const { woodcutting, farming } = S().xpAtFull;
  const roll = ([low, high]) => low + Math.random() * (high - low);
  Common.xp(player, "WOODCUTTING", Common.level(player, "WOODCUTTING") * roll(woodcutting) * share);
  Common.xp(player, "FARMING", Common.level(player, "FARMING") * roll(farming) * share);
  const fed = event.fed.get(player) ?? [];
  fed.push(percent);
  event.fed.set(player, fed);
  const amount = Math.max(1, units(percent) - Common.randomInt(0, 1));
  Common.later(1, () => Common.bark(player, amount));
}

function lumpBark(average) {
  const [, low, high] = S().lump.find(([from]) => average >= from);
  return Common.randomInt(low, high);
}

function finish(event, saved) {
  if (event.over) return;
  event.over = true;
  saplings.delete(event);
  const sapling = S();
  const location = event.site.location;
  Common.core.World.getRemoveNPCQueue().push(event.npc);
  for (const pile of event.piles) Common.removeLoc(pile.object);
  const nearby = Common.nearbyPlayers(location, 15);
  for (const player of new Set([...nearby, ...event.collectors])) clearMulch(player);
  if (saved) {
    event.loc = Common.placeLoc(sapling.saved[event.size], location, event.loc.getFace());
    Common.areaSound(location, sapling.sounds.success);
    for (const player of event.fed.keys()) player.sendMessage(Common.message("saved"));
    Common.later(1, () => gifts(event));
  } else {
    for (const player of new Set([...event.site.participants, ...nearby])) player.sendMessage(Common.message("withered"));
  }
  Spawns.ended(event);
  Common.later(sapling.treeBackTicks, () => {
    Common.removeLoc(event.loc);
    Common.core.ObjectManager.register(event.site.tree, true);
    Spawns.releaseTree(location);
  });
}

/** Inferred: what's left of the mulch goes with the sapling (or, logged out meanwhile, at login). */
function clearMulch(player) {
  const inventory = player.getInventory();
  for (const id of Common.data.items.mulch) {
    const amount = inventory.getAmount(id);
    if (amount > 0) inventory.delete(id, amount);
  }
  player.setAttribute(MULCH_ATTRIBUTE, null);
}

/** The next tick: bark by average nutrition, the tree's leaves, and bonus XP. */
function gifts(event) {
  const sapling = S();
  for (const [player, fed] of event.fed) {
    if (!player.isRegistered?.()) continue;
    const average = fed.reduce((sum, value) => sum + value, 0) / fed.length;
    Common.bark(player, lumpBark(average), true);
    const leaves = Common.data.trees[event.site.name] ?? "Leaves";
    const amount = Common.randomInt(...sapling.leaves);
    Common.award(player, Common.data.leaves[leaves], amount);
    player.sendMessage(Common.message("leaves", { amount, leaves }));
    Common.xp(player, "WOODCUTTING", Common.level(player, "WOODCUTTING") * sapling.bonusXpPerLevel * (average / 100));
  }
}

/** Mulch from a sapling that's gone (logged out while it stood). */
function loggedIn({ player }) {
  if (mulchStage(player) === 0) return;
  const here = player.getLocation();
  if (![...saplings].some((event) => Common.distance(event.site.location, here) <= 15)) clearMulch(player);
}

function attachSapling(api) {
  api.persistAttribute(MULCH_ATTRIBUTE);
  api.onPlayerLogin(loggedIn);
  Spawns.registerEvent("sapling", { start, takesTree: true });
  for (const ingredient of ["Rotting leaves", "Green leaves", "Droppings", "Wild mushrooms", "Splintered bark"]) {
    api.onObjectInteraction(ingredient, { Collect: collect });
  }
  api.onObjectInteraction("Struggling sapling", { "Add-mulch": addMulch });
}

module.exports = { attachSapling, start, collect, addMulch, nutrition, finish, saplings, MULCH_ATTRIBUTE };
