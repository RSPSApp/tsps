/**
 * The Creature Graveyard (Wiki: Mage_Training_Arena/Creature_Graveyard, Bones_(Creature_Graveyard),
 * Animals'_bones, Food_chute, Graveyard_Guardian, Bones_to_Bananas, Bones_to_Peaches):
 * - Bones to Bananas (Magic 15) to go in;
 * - the bone piles give animals' bones; each pile type gives the next kind after every four taken
 *   from it (kept per player), kinds 1 to 4 turning into that many fruit;
 * - Bones to Bananas turns every animals' bone carried into bananas, Bones to Peaches (once
 *   unlocked from the Rewards Guardian) into peaches, a cast's runes and XP at a time;
 * - the food chute takes all the fruit: 1 Graveyard Pizazz Point per 16 (a peach counts as 2, the
 *   rest a chance of one more), at most 3 points a deposit, 5 Magic XP a banana and 10 a peach for
 *   all of it; every point earns a water, earth, nature, death or blood rune, given on leaving;
 * - fruit and the bones the spells turn into fruit can't be taken in;
 * - the room's bones and fruit never leave it; logging out keeps them (since 8 May 2024).
 * - the falling bones: every 10 ticks 40 open-floor tiles show a bone (graphics 520-523) and a
 *   player still on one 3 ticks later takes 2 damage; they can be stepped away from (Wiki, rsprox 1757).
 * Sounds, animations and the bones are as captured (rsprox 1757, rev 227; see the graveyard data).
 * Not here: Bones to Bananas' sound (no cast of it is captured), protection from the bones, the
 * hit's sound, and the room's 10-point death cost (Wiki).
 */
const Common = require("./Common.MageTrainingArena");

const { PEACHES_UNLOCKED_ATTRIBUTE } = Common;
const PILE_COUNT_ATTRIBUTE = (pile) => `mage-training-arena:bone-pile-${pile}`;
const RUNES_OWED_ATTRIBUTE = "mage-training-arena:graveyard-runes";
const BONES = ["bones1", "bones2", "bones3", "bones4"];

const graveyard = { area: null };
/** Each player's repeating bones task, and the room's open tiles (read once from the map). */
const rains = new Map();
let openTiles = [];

const inGraveyard = (location) => Common.inBox(location, Common.data.graveyard.bounds);

// --- The piles

/** The bone pile type (1-4) of a loc, or 0. */
function pileOf(objectId) {
  const { locs } = Common.ids;
  return [locs.bonePile1, locs.bonePile2, locs.bonePile3, locs.bonePile4].indexOf(objectId) + 1;
}

/** What this pile type gives the player next: its own kind, moving on every 4 taken. */
function nextBone(player, pile) {
  const taken = Number(player.getAttribute(PILE_COUNT_ATTRIBUTE(pile))) || 0;
  return BONES[(pile - 1 + Math.floor(taken / Common.data.graveyard.bonesPerChange)) % BONES.length];
}

function grab({ player, objectId }) {
  const pile = pileOf(objectId);
  if (!pile) return false;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() === 0) {
    player.sendMessage(Common.message("inventoryFull"));
    return true;
  }
  inventory.adds(Common.ids.items[nextBone(player, pile)], 1);
  const key = PILE_COUNT_ATTRIBUTE(pile);
  player.setAttribute(key, ((Number(player.getAttribute(key)) || 0) + 1) % (BONES.length * Common.data.graveyard.bonesPerChange));
  return true;
}

// --- The spells

let spells = null;

/** The two bones spells as Spells, so their runes, staves and level checks are the engine's. */
function defineSpells() {
  const { Spell, Item, CacheDefinitions } = Common.core;
  const out = {};
  for (const [name, data] of Object.entries(Common.data.graveyard.spells)) {
    const widget = CacheDefinitions.getSpellByName(name);
    out[name] = new (class extends Spell {
      spellId() { return widget?.widgetId ?? -1; }
      levelRequired() { return data.level; }
      baseExperience() { return data.xp; }
      itemsRequired() { return data.runes.map(([rune, amount]) => new Item(Common.ids.items[rune], amount)); }
      equipmentRequired() { return []; }
      startCast() {}
    })();
    out[name].data = data;
  }
  return out;
}

/** The fruit animals' bones of each kind turn into: kind n gives n. */
function fruitFor(player) {
  const inventory = player.getInventory();
  return BONES.reduce((sum, key, i) => sum + inventory.getAmount(Common.ids.items[key]) * (i + 1), 0);
}

/** "spell:cast" (emitSpellCast): the bones spells in the room work on the animals' bones. */
function castBonesSpell(event) {
  const { player, spellName } = event;
  if (!inGraveyard(player.getLocation())) return;
  spells ??= defineSpells();
  const spell = spells[spellName];
  if (!spell) return;
  event.handled = true;
  if (spell.data.unlock && player.getAttribute(PEACHES_UNLOCKED_ATTRIBUTE) !== true) {
    player.sendMessage(Common.message("peachesLocked"));
    return;
  }
  const fruit = fruitFor(player);
  if (fruit <= 0) {
    player.sendMessage(Common.message("noBones"));
    return;
  }
  const inventory = player.getInventory();
  const fruitId = Common.ids.items[spell.data.fruit];
  if (!spell.canCast(player, true)) return;
  // Room for the fruit (after the runes, which may free a slot): the bones' own slots and any
  // free ones; what doesn't fit is lost, as in OSRS.
  const bones = BONES.reduce((sum, key) => sum + inventory.getAmount(Common.ids.items[key]), 0);
  const made = Math.min(fruit, bones + inventory.getFreeSlots());
  for (const key of BONES) {
    const id = Common.ids.items[key];
    const amount = inventory.getAmount(id);
    if (amount > 0) inventory.deleteNumber(id, amount);
  }
  inventory.adds(fruitId, made);
  const { Animation, Graphic, GraphicHeight, Skill } = Common.core;
  player.performAnimation(new Animation(722));
  player.performGraphic(new Graphic(141, 0, GraphicHeight.MIDDLE));
  player.getSkillManager().addExperiences(Skill.MAGIC, spell.baseExperience());
  if (spell.data.sound) player.getPacketSender().sendSoundEffect(spell.data.sound, 1, 0, 255);
}

// --- The food chute

/** All the fruit goes in, for its XP; only 48 of it (3 points) counts for points (Wiki). */
function depositFruit(player, random = Math.random) {
  const { graveyard: room } = Common.data;
  const { items } = Common.ids;
  const inventory = player.getInventory();
  const peaches = inventory.getAmount(items.peach);
  const bananas = inventory.getAmount(items.banana);
  const fruit = peaches * 2 + bananas;
  if (fruit <= 0) return null;
  if (peaches > 0) inventory.deleteNumber(items.peach, peaches);
  if (bananas > 0) inventory.deleteNumber(items.banana, bananas);
  const counted = Math.min(fruit, room.fruitPerPoint * room.maxPoints);
  const whole = Math.floor(counted / room.fruitPerPoint);
  const points = Math.min(room.maxPoints, whole + (random() < (counted % room.fruitPerPoint) / room.fruitPerPoint ? 1 : 0));
  Common.awardPoints(player, "graveyard", points);
  player.getSkillManager().addExperiences(Common.core.Skill.MAGIC, bananas * room.bananaXp + peaches * room.peachXp);
  player.setAttribute(RUNES_OWED_ATTRIBUTE, (Number(player.getAttribute(RUNES_OWED_ATTRIBUTE)) || 0) + points);
  player.sendMessage(Common.message("fruitDeposited", { fruit, points, s: points === 1 ? "" : "s" }));
  player.performAnimation(new Common.core.Animation(room.depositAnimation));
  player.getPacketSender().sendSoundEffect(room.depositSound, 1, 0, 255);
  updateOverlay(player);
  return { fruit, points };
}

function chute({ player, objectId }) {
  if (objectId !== Common.ids.locs.foodChute) return false;
  if (!depositFruit(player)) player.sendMessage(Common.message("noFruit"));
  return true;
}

/** On leaving: a water, earth, nature, death or blood rune for every point earned (Wiki). */
function payRunes(player, random = Math.random) {
  const owed = Number(player.getAttribute(RUNES_OWED_ATTRIBUTE)) || 0;
  player.setAttribute(RUNES_OWED_ATTRIBUTE, 0);
  const given = {};
  const runes = Common.data.graveyard.rewardRunes;
  for (let i = 0; i < owed; i++) {
    const rune = runes[Math.floor(random() * runes.length)];
    given[rune] = (given[rune] ?? 0) + 1;
  }
  const { Item, ItemOnGroundManager } = Common.core;
  for (const [rune, amount] of Object.entries(given)) {
    const id = Common.ids.items[rune];
    const inventory = player.getInventory();
    if (inventory.contains(id) || inventory.getFreeSlots() > 0) inventory.adds(id, amount);
    else ItemOnGroundManager.registerLocation(player, new Item(id, amount), player.getLocation().clone());
    player.sendMessage(Common.message("runesForFruit", { amount, rune: `${rune} rune${amount === 1 ? "" : "s"}` }));
  }
  return given;
}

/** The room's bones and fruit stay in the room. */
function removeRoomItems(player) {
  const { items } = Common.ids;
  let removed = 0;
  for (const id of [...BONES.map((key) => items[key]), items.banana, items.peach]) {
    const amount = player.getInventory().getAmount(id);
    if (amount > 0) {
      player.getInventory().deleteNumber(id, amount);
      removed += amount;
    }
  }
  return removed;
}

// --- The falling bones

/** The room's open-floor tiles: the 580 tiles captured for a bone are all unblocked (rsprox 1757). */
function boneTiles() {
  const { RegionManager, Location } = Common.core;
  const [minX, maxX, minY, maxY] = Common.data.graveyard.bones.tiles;
  const z = Common.data.graveyard.bounds[4];
  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) if (!RegionManager.blocked(new Location(x, y, z), null)) tiles.push([x, y]);
  }
  return tiles;
}

/** One burst for a player in the room: bones on distinct open tiles and the four area sounds; the tiles. */
function rain(player, random = Math.random) {
  const { Graphic, Location } = Common.core;
  const { bones } = Common.data.graveyard;
  const z = Common.data.graveyard.bounds[4];
  const sender = player.getPacketSender();
  openTiles = openTiles.length > 0 ? openTiles : boneTiles();
  const pool = openTiles.slice();
  const hit = [];
  for (let i = 0; i < bones.graphicCount && pool.length > 0; i++) {
    const pick = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[pick]] = [pool[pick], pool[i]];
    const [x, y] = pool[i];
    const id = bones.graphics[Math.floor(random() * bones.graphics.length)];
    sender.sendGraphic(new Graphic(id, bones.graphicDelay), new Location(x, y, z));
    hit.push(`${x},${y}`);
  }
  for (const [x, y] of bones.soundPoints) {
    sender.sendAreaSound(bones.sound, x, y, z, 1, 0, bones.soundRadius, bones.soundAttenuation);
  }
  Common.later(bones.landingTicks, () => land(player, hit));
}

/** The bones land: a player still on one of their tiles takes the hit. */
function land(player, tiles) {
  const { HitDamage, HitMask } = Common.core;
  if (player.isRegistered?.() === false || !inGraveyard(player.getLocation())) return;
  const here = player.getLocation();
  if (!tiles.includes(`${here.getX()},${here.getY()}`)) return;
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(Common.data.graveyard.bones.damage, HitMask.RED)]);
}

/** Starts the player's repeating bones; it ends itself once they are out of the room. */
function startRain(player) {
  stopRain(player);
  const { Task, TaskManager } = Common.core;
  const task = new (class extends Task {
    constructor() {
      super(Common.data.graveyard.bones.period, null, false);
    }
    execute() {
      if (rains.get(player) !== this || player.isRegistered?.() === false || !inGraveyard(player.getLocation())) {
        this.stop();
        return;
      }
      rain(player);
    }
  })();
  rains.set(player, task);
  TaskManager.submit(task);
}

function stopRain(player) {
  rains.get(player)?.stop?.();
  rains.delete(player);
}

function updateOverlay(player) {
  player.getPacketSender().sendString(Common.points(player, "graveyard").toLocaleString("en-GB"), Common.ids.components.graveyardPoints);
}

/**
 * The Graveyard Teleport: Bones to Bananas (Magic 15, boostable). Bananas, peaches and the bones
 * the spells turn into fruit can't be taken in (Wiki).
 */
function enter({ player, objectId }) {
  if (objectId !== Common.ids.locs.graveyardPortal) return false;
  const { level, arrive } = Common.data.graveyard;
  if (player.getSkillManager().getCurrentLevel(Common.core.Skill.MAGIC) < level) {
    player.sendMessage(Common.message("level", { level, room: "Creature Graveyard" }));
    return true;
  }
  const { items } = Common.ids;
  if ([items.banana, items.peach, items.bones, items.bigBones].some((id) => player.getInventory().contains(id))) {
    player.sendMessage(Common.message("noFruitIn"));
    return true;
  }
  player.moveTo(Common.toLocation(arrive));
  return true;
}

function defineArea() {
  const { Area, Boundary } = Common.core;
  const [minX, maxX, minY, maxY, z] = Common.data.graveyard.bounds;
  return class CreatureGraveyard extends Area {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, z)]);
    }

    getName() {
      return "Creature Graveyard";
    }

    postEnter(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      Common.sendOverlay(player, Common.ids.interfaces.graveyard);
      updateOverlay(player);
      startRain(player);
    }

    postLeave(mobile, logout) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      Common.closeOverlay(player);
      stopRain(player);
      if (logout) return;
      if (removeRoomItems(player) > 0) player.sendMessage(Common.message("itemsTaken"));
      payRunes(player);
    }
  };
}

function attach(api) {
  api.persistAttribute(PEACHES_UNLOCKED_ATTRIBUTE, false);
  api.persistAttribute(RUNES_OWED_ATTRIBUTE, 0);
  for (let pile = 1; pile <= BONES.length; pile++) api.persistAttribute(PILE_COUNT_ATTRIBUTE(pile), 0);
  graveyard.area = new (defineArea())();
  Common.registerRoom("graveyard", graveyard.area);
  api.onObjectInteraction("Graveyard Teleport", { Enter: enter });
  api.onObjectInteraction("Bones", { Grab: grab });
  api.onObjectInteraction("Food chute", { Deposit: chute });
  api.onSpellCast(castBonesSpell);
}

module.exports = {
  attach, graveyard, inGraveyard, pileOf, nextBone, grab, fruitFor, castBonesSpell, depositFruit, payRunes, rain, boneTiles,
  removeRoomItems, enter, defineArea, PEACHES_UNLOCKED_ATTRIBUTE, RUNES_OWED_ATTRIBUTE,
};
