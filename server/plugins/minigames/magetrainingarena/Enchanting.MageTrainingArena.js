/**
 * The Enchanting Chamber (Wiki: Mage_Training_Arena/Enchanting_Chamber, Hole_(Enchanting_Chamber),
 * Dragonstone_(Mage_Training_Arena), Cube_Pile and the other piles, Enchantment_Guardian):
 * - Magic 7 (Lvl-1 Enchant) to go in;
 * - the piles give their shape (1 in 32 a dragonstone instead); six dragonstones also lie about the
 *   room (the world's ground items);
 * - any Lvl-1 to Lvl-7 Enchant turns a shape or dragonstone into an orb, with the spell's own
 *   runes and XP: Enchantment Pizazz Points equal to the spell's level, doubled on every 10th
 *   shape, +2 for the bonus shape (after doubling), and twice the level for a dragonstone;
 * - the bonus shape changes every 24 seconds, announced by the guardian and shown on the
 *   overlay;
 * - the hole takes the orbs: 20 Magic XP each, and every 20 earn 3 blood, death or cosmic runes,
 *   given on leaving;
 * - the room's shapes, orbs and dragonstones never leave it - by the exit, a teleport or death;
 *   logging out keeps them and the orbs counted so far (since 8 May 2024).
 */
const Common = require("./Common.MageTrainingArena");

const ENCHANTED_ATTRIBUTE = "mage-training-arena:shapes-enchanted";
/** Orbs deposited this visit, towards the runes given on leaving (kept over a logout). */
const ORBS_ATTRIBUTE = "mage-training-arena:orbs-deposited";
const SHAPES = ["cube", "cylinder", "pentamid", "icosahedron"];
const PILE_SHAPE = { cubePile: "cube", cylinderPile: "cylinder", icosahedronPile: "icosahedron", pentamidPile: "pentamid" };
const BONUS_COMPONENT = { cube: "bonusCube", cylinder: "bonusCylinder", pentamid: "bonusPentamid", icosahedron: "bonusIcosahedron" };

const chamber = {
  area: null,
  bonus: "cube",
  task: null,
  tickCount: 0,
};

const inChamber = (location) => Common.inBox(location, Common.data.enchanting.bounds);
const shapeOf = (itemId) => SHAPES.find((shape) => Common.ids.items[shape] === itemId) ?? null;

// --- The overlay

function sendOverlay(player) {
  const { interfaces, components } = Common.ids;
  Common.sendOverlay(player, interfaces.enchanting);
  updateOverlay(player);
}

function updateOverlay(player) {
  const { components } = Common.ids;
  const sender = player.getPacketSender();
  sender.sendString(Common.points(player, "enchantment").toLocaleString("en-GB"), components.enchantPoints);
  for (const shape of SHAPES) sender.sendInterfaceDisplayState(components[BONUS_COMPONENT[shape]], shape !== chamber.bonus);
}

// --- The bonus shape

function players() {
  return chamber.area ? chamber.area.getPlayers().filter((player) => player?.isRegistered?.() !== false) : [];
}

/** A different shape, announced by the Enchantment Guardian. */
function rotateBonus(random = Math.random) {
  const others = SHAPES.filter((shape) => shape !== chamber.bonus);
  chamber.bonus = others[Math.floor(random() * others.length)];
  const guardian = guardianNpc();
  guardian?.forceChat?.(Common.message("bonusShape", { shape: chamber.bonus }));
  for (const player of players()) updateOverlay(player);
}

function guardianNpc() {
  const id = Common.ids.npcs.enchantmentGuardian;
  return Common.core.World.getNpcs().search((npc) => npc?.getId?.() === id && inChamber(npc.getLocation())) ?? null;
}

function tick() {
  chamber.tickCount += 1;
  if (players().length === 0) {
    chamber.task?.stop?.();
    chamber.task = null;
    return;
  }
  if (chamber.tickCount % Common.data.enchant.bonusTicks === 0) rotateBonus();
}

function ensureRunning() {
  if (chamber.task) return;
  const { Task, TaskManager } = Common.core;
  chamber.task = new (class extends Task {
    constructor() {
      super(1, "mage-training-arena:enchanting", false);
    }
    execute() {
      tick();
    }
  })();
  TaskManager.submit(chamber.task);
}

// --- The piles

function takeFromPile({ player, objectId }, random = Math.random) {
  const key = Object.keys(PILE_SHAPE).find((pile) => Common.ids.locs[pile] === objectId);
  if (!key) return false;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() === 0) {
    player.sendMessage(Common.message("inventoryFull"));
    return true;
  }
  const { items } = Common.ids;
  inventory.adds(random() < 1 / Common.data.enchant.dragonstoneChance ? items.dragonstone : items[PILE_SHAPE[key]], 1);
  return true;
}

// --- Enchanting

/** Points for one enchant: the spell's level, doubled on every 10th shape, +2 on the bonus shape. */
function enchantPoints(spellLevel, { dragonstone, count, bonus }) {
  const { enchant } = Common.data;
  if (dragonstone) return spellLevel * 2;
  let points = count % enchant.every === 0 ? spellLevel * 2 : spellLevel;
  if (bonus) points += enchant.bonus;
  return points;
}

/** "magic:enchant-item" from Spells.EnchantJewellery.js: a shape or dragonstone in the chamber. */
function enchantShape(event) {
  const { player, spell, spellName, itemId, slot } = event;
  const { items } = Common.ids;
  const shape = shapeOf(itemId);
  const dragonstone = itemId === items.dragonstone;
  if ((!shape && !dragonstone) || !inChamber(player.getLocation())) return;
  const spellLevel = Common.data.enchant.spells[spellName];
  if (!spellLevel) return;
  event.handled = true;
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId() !== itemId || !spell.canCast(player, true)) return;
  const { core } = Common;
  player.performAnimation(new core.Animation(spell.data.animation));
  player.performGraphic(new core.Graphic(spell.data.graphic, 0, core.GraphicHeight.HIGH));
  player.getPacketSender().sendSound?.(spell.data.sound);
  inventory.deleteNumber(itemId, 1);
  inventory.adds(items.orb, 1);
  player.getSkillManager().addExperiences(core.Skill.MAGIC, spell.baseExperience());
  let count = 0;
  if (!dragonstone) {
    count = (Number(player.getAttribute(ENCHANTED_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(ENCHANTED_ATTRIBUTE, count);
  }
  Common.addPoints(player, "enchantment", enchantPoints(spellLevel, { dragonstone, count, bonus: shape === chamber.bonus }));
  updateOverlay(player);
}

// --- The hole

function deposit({ player, objectId }) {
  if (objectId !== Common.ids.locs.hole) return false;
  const { enchant } = Common.data;
  const orbs = player.getInventory().getAmount(Common.ids.items.orb);
  if (orbs <= 0) return true;
  player.getInventory().deleteNumber(Common.ids.items.orb, orbs);
  player.getSkillManager().addExperiences(Common.core.Skill.MAGIC, orbs * enchant.orbXp);
  player.setAttribute(ORBS_ATTRIBUTE, Math.min(enchant.orbCap, (Number(player.getAttribute(ORBS_ATTRIBUTE)) || 0) + orbs));
  player.sendMessage(Common.message("orbsDeposited", { count: orbs, s: orbs === 1 ? "" : "s" }));
  return true;
}

/** On leaving: 3 blood, death or cosmic runes for every 20 orbs deposited (Wiki). */
function payRunes(player, random = Math.random) {
  const { enchant } = Common.data;
  const orbs = Number(player.getAttribute(ORBS_ATTRIBUTE)) || 0;
  player.setAttribute(ORBS_ATTRIBUTE, 0);
  const rewards = Math.floor(orbs / enchant.orbsPerReward);
  const given = {};
  for (let i = 0; i < rewards; i++) {
    const rune = ["blood", "death", "cosmic"][Math.floor(random() * 3)];
    given[rune] = (given[rune] ?? 0) + enchant.rewardRunes;
  }
  const { Item, ItemOnGroundManager } = Common.core;
  for (const [rune, amount] of Object.entries(given)) {
    const id = Common.ids.items[rune];
    const inventory = player.getInventory();
    // No room: they go on the floor rather than vanishing.
    if (inventory.contains(id) || inventory.getFreeSlots() > 0) inventory.adds(id, amount);
    else ItemOnGroundManager.registerLocation(player, new Item(id, amount), player.getLocation().clone());
    player.sendMessage(Common.message("runesForOrbs", { amount, rune: `${rune} runes` }));
  }
  return given;
}

/** The room's items stay in the room. */
function removeRoomItems(player) {
  const { items } = Common.ids;
  let removed = 0;
  for (const id of [...SHAPES.map((shape) => items[shape]), items.orb, items.dragonstone]) {
    const amount = player.getInventory().getAmount(id);
    if (amount > 0) {
      player.getInventory().deleteNumber(id, amount);
      removed += amount;
    }
  }
  return removed;
}

// --- The area

function defineArea() {
  const { Area, Boundary } = Common.core;
  const [minX, maxX, minY, maxY, z] = Common.data.enchanting.bounds;
  return class EnchantingChamber extends Area {
    constructor() {
      super([new Boundary(minX, maxX, minY, maxY, z)]);
    }

    getName() {
      return "Enchanting Chamber";
    }

    postEnter(mobile) {
      if (!mobile?.isPlayer?.()) return;
      sendOverlay(mobile.getAsPlayer());
      ensureRunning();
    }

    postLeave(mobile, logout) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      Common.closeOverlay(player);
      if (logout) return;
      // The room's items first: the runes may need the space they took.
      if (removeRoomItems(player) > 0) player.sendMessage(Common.message("itemsTaken"));
      payRunes(player);
    }
  };
}

function attach(api) {
  api.persistAttribute(ENCHANTED_ATTRIBUTE, 0);
  api.persistAttribute(ORBS_ATTRIBUTE, 0);
  chamber.area = new (defineArea())();
  api.registerArea(chamber.area);
  api.onObjectInteraction("Cube Pile", { "Take-from": takeFromPile });
  api.onObjectInteraction("Cylinder Pile", { "Take-from": takeFromPile });
  api.onObjectInteraction("Icosahedron Pile", { "Take-from": takeFromPile });
  api.onObjectInteraction("Pentamid Pile", { "Take-from": takeFromPile });
  api.onObjectInteraction("Hole", { Deposit: deposit });
  api.onCustomEvent("magic:enchant-item", enchantShape);
}

module.exports = {
  attach, chamber, inChamber, shapeOf, takeFromPile, enchantPoints, enchantShape, deposit, payRunes,
  removeRoomItems, rotateBonus, updateOverlay, defineArea, SHAPES, ENCHANTED_ATTRIBUTE, ORBS_ATTRIBUTE,
};
