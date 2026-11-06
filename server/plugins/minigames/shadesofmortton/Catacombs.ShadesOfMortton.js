/**
 * The Shade Catacombs, as recorded (rsprox 227/01858 [15240]-[15298]; shades-of-mortton.json
 * `catacombs`, `chests`):
 * - the hillside's wooden doors: "You use your Shade key to unlock the door.", they swing open and
 *   the player is inside 2 ticks later; the key is kept;
 * - a tomb door of a metal opens to a key of that metal or better ("You open the ominous tomb
 *   door."; back the other way needs none: "You walk back through the ominous door."), else "You
 *   need a key to open this door.";
 * - a chest opens to its own key (metal and trim): the key dissolves, the treasure and coins, then
 *   "You find N doses of swamp paste at the bottom of the chest."; the chest stands open 4 ticks.
 *   With another key: "You don't have the correct key. You need a <metal> key with a <colour>
 *   trim to open this chest."
 * Wiki: the chests' loot (the red-key tables: one roll, then coins for what the roll left), coins
 * of (roll - the loot's value) / 3.
 */
const Common = require("./Common.ShadesOfMortton");

const COINS = 995;
const SWAMP_PASTE = "swamppaste";
/** A wall's facing to the step through it: west, north, east, south. */
const THROUGH = [[-1, 0], [0, 1], [1, 0], [0, -1]];

const cat = () => Common.data.catacombs;
const sound = (player, id) => player.getPacketSender().sendSound?.(id, 100, 0);

function swap(object, toName, ticks) {
  const { GameObject, ObjectManager } = Common.core;
  const open = new GameObject(Common.locId(toName), object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null);
  // A loc registered over another of its type on the tile replaces it, and back again.
  ObjectManager.register(open, true);
  Common.later(ticks, () => ObjectManager.register(object, true));
}

// ---------------------------------------------------------------- the entrance

function entrance({ player, object }) {
  const names = cat().entranceDoors;
  const name = names.find((n) => Common.locId(n) === object?.getId?.());
  if (!name) return false;
  if (!Common.bestKey(player)) {
    player.sendMessage(Common.message("needKey"));
    sound(player, cat().sounds.locked);
    return true;
  }
  player.sendMessage(Common.message("keyUnlock"));
  player.performAnimation?.(new Common.core.Animation(cat().unlockAnimation));
  sound(player, cat().sounds.locked);
  Common.later(1, () => swap(object, cat().openDoors[name], 2));
  Common.later(2, () => player.moveTo(new Common.core.Location(...cat().inside)));
  return true;
}

// ---------------------------------------------------------------- the tomb doors

function tombDoor({ player, object }) {
  const name = object?.getDefinition?.()?.getName?.() ?? "";
  const metal = cat().doors[name];
  if (!metal) return false;
  const door = object.getLocation();
  const [dx, dy] = THROUGH[object.getFace() & 3];
  const here = player.getLocation();
  const beyond = here.getX() === door.getX() + dx && here.getY() === door.getY() + dy;
  if (beyond) {
    // Coming back the other way needs no key.
    player.sendMessage(Common.message("tombDoorBack"));
    sound(player, cat().sounds.door);
    player.moveTo(new Common.core.Location(door.getX(), door.getY(), door.getZ()));
    return true;
  }
  const key = Common.bestKey(player);
  if (!key || Common.tier(key.metal) < Common.tier(metal)) {
    player.sendMessage(Common.message("needKey"));
    return true;
  }
  player.sendMessage(Common.message("tombDoor"));
  sound(player, cat().sounds.door);
  player.moveTo(new Common.core.Location(door.getX() + dx, door.getY() + dy, door.getZ()));
  return true;
}

// ---------------------------------------------------------------- the chests

function chestOf(object) {
  const name = Common.core.CacheDefinitions.getLocNames().get(object?.getId?.()) ?? "";
  const match = /^shadechest_([a-z]+)_([a-z]+)$/.exec(name);
  return match ? { metal: match[1], colour: match[2] } : null;
}

function openChestName({ metal, colour }) {
  return Common.locId(`shadechestopen_${metal}_${colour}`) != null ? `shadechestopen_${metal}_${colour}` : "shadelairchestopen";
}

const value = (id) => Number(Common.core.CacheDefinitions.getItem(id)?.price) || 0;

/** One roll on the metal's table (its weights over the page's denominator), or nothing. */
function rollLoot(metal) {
  const { denominator, items } = Common.data.chests.loot[metal];
  let roll = Math.random() * denominator;
  for (const [id, min, max, weight] of items) {
    if (roll < weight) return { id, amount: Common.randomInt(min, max) };
    roll -= weight;
  }
  return null;
}

/** Wiki: coins are what the roll leaves over the loot's value, a third of it. */
function coinsFor(metal, loot) {
  const [low, high] = Common.data.chests.coinRolls[metal];
  const roll = Common.randomInt(low, high);
  const worth = loot ? value(loot.id) * loot.amount : 0;
  return worth >= roll ? 0 : Math.floor((roll - worth) / Common.data.chests.coinDivisor);
}

function give(player, id, amount) {
  const inventory = player.getInventory();
  const stacks = Common.core.ItemDefinition.forId(id)?.isStackable?.() === true;
  if (stacks || amount === 1) inventory.add(new Common.core.Item(id, amount));
  else for (let i = 0; i < amount; i++) inventory.add(new Common.core.Item(id, 1));
}

/**
 * Whether every reward fits: the new slots against the free ones, and a stack the inventory
 * already holds against its cap (add() would clamp the surplus away, after the key is gone).
 */
function fits(inventory, rewards) {
  // Keys don't stack, so the one that dissolves always frees exactly one slot, spares or not.
  let room = inventory.getFreeSlots() + 1;
  for (const [id, amount] of rewards) {
    const stacks = Common.core.ItemDefinition.forId(id)?.isStackable?.() === true;
    if (!stacks) {
      room -= amount;
    } else if (inventory.getAmount(id) > 0) {
      if (inventory.getAddableAmount(new Common.core.Item(id, amount)) < amount) return false;
    } else {
      room -= 1;
    }
  }
  return room >= 0;
}

/** Zealots still standing, by the player who raised them (server hygiene: removed at logout). */
const zealots = new Map();

/**
 * Wiki: a chest opened in the catacombs raises an Undead Zealot 1 time in 20, fought by the
 * opener alone (an owner, so anyone else is refused; not hidden from others, nor made multi-combat).
 */
function raiseZealot(player, object) {
  const { npc, chance } = Common.data.zealot;
  if (Math.random() >= chance) return;
  const at = object.getLocation();
  const raised = Common.api.spawnNpc({ id: Common.npcId(npc), x: at.getX(), y: at.getY(), z: at.getZ(), owner: player, wanderRadius: 0 });
  if (!raised) return;
  const standing = (zealots.get(player) ?? []).filter((z) => z.isRegistered?.());
  zealots.set(player, [...standing, raised]);
}

/** A zealot left alive when its opener logs out would stay in the world for good, unreachable. */
function forgetZealots({ player }) {
  for (const zealot of zealots.get(player) ?? []) Common.api.removeNpc(zealot);
  zealots.delete(player);
}

function talk(player, pages) {
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = Common.core;
  const manager = player.getDialogueManager();
  const chain = new DialogueChainBuilder();
  pages.forEach(([text, itemId], index) => chain.add(new ItemStatementDialogue(index, itemId, text)));
  chain.add(new ActionDialogue(pages.length, { execute: () => { manager.reset(); player.getPacketSender().sendInterfaceRemoval(); } }));
  manager.startDialogues(chain);
}

function chest({ player, object }) {
  const found = chestOf(object);
  if (!found) return false;
  const keyId = Common.objId(`shadekey_${found.metal}_${found.colour}`);
  const inventory = player.getInventory();
  if (keyId == null || inventory.getAmount(keyId) <= 0) {
    const colour = Common.data.keyColours[found.colour] ?? found.colour;
    player.sendMessage(Common.message("wrongKey", { metal: found.metal, colour }));
    sound(player, cat().sounds.locked);
    return true;
  }
  const loot = rollLoot(found.metal);
  const coins = coinsFor(found.metal, loot);
  const [pasteLow, pasteHigh] = Common.data.chests.swampPaste[found.metal];
  const paste = Common.randomInt(pasteLow, pasteHigh);
  const rewards = [loot && [loot.id, loot.amount], coins > 0 && [COINS, coins], [Common.objId(SWAMP_PASTE), paste]].filter(Boolean);
  if (!fits(inventory, rewards)) {
    player.sendMessage(Common.message("noRoom"));
    return true;
  }
  inventory.delete(keyId, 1);
  if (loot) give(player, loot.id, loot.amount);
  if (coins > 0) give(player, COINS, coins);
  give(player, Common.objId(SWAMP_PASTE), paste);
  inventory.refreshItems?.();
  sound(player, cat().sounds.chest);
  swap(object, openChestName(found), Common.data.chests.openTicks);
  raiseZealot(player, object);
  const treasure = coins > 0 ? Common.message("treasure", { coins }) : Common.message("noTreasureCoins");
  talk(player, [[treasure, loot?.id ?? COINS], [Common.message("swampPaste", { paste }), Common.objId(SWAMP_PASTE)]]);
  return true;
}

/**
 * Wiki: bleached bones offered on the Altar of the Damned restore full Prayer (no experience; the
 * bone is read as consumed). Only the effect is established: no animation, sound or line was
 * recorded, so none is made up. The bones must still be held on arrival (the walk can outlast a
 * drop), and at full Prayer the event is left to the engine, which consumes nothing.
 */
function bonesOnAltar(event) {
  const { player, object, itemId } = event;
  const { altar, bones } = Common.data.zealot;
  if ((object?.getId?.() ?? event.objectId) !== Common.locId(altar) || itemId !== Common.objId(bones)) return;
  const inventory = player.getInventory();
  if (inventory.getAmount(itemId) < 1) return;
  const skills = player.getSkillManager();
  const { Skill } = Common.core;
  if (skills.getCurrentLevel(Skill.PRAYER) >= skills.getMaxLevel(Skill.PRAYER)) return;
  event.handled = true;
  inventory.delete(itemId, 1);
  inventory.refreshItems?.();
  skills.setCurrentLevels(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER));
  skills.updateSkill(Skill.PRAYER);
}

function attachCatacombs(api) {
  api.onItemOnObject(bonesOnAltar);
  api.onPlayerLogout(forgetZealots);
  api.onObjectInteraction("Wooden doors", { Open: entrance });
  for (const name of Object.keys(Common.data.catacombs.doors)) api.onObjectInteraction(name, { Open: tombDoor });
  for (const metal of Common.data.keyMetals) {
    api.onObjectInteraction(`${metal.charAt(0).toUpperCase()}${metal.slice(1)} Chest`, { Open: chest });
  }
}

module.exports = { attachCatacombs, bonesOnAltar, raiseZealot, forgetZealots, entrance, tombDoor, chest, rollLoot, coinsFor, chestOf };
