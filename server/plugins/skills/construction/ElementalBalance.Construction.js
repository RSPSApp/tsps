"use strict";

const { CombatSpells, CountdownTask, PluginManager, Skill, TaskManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Prizes = require("./Prizes.Construction");

// Elemental balance (rsprox captures, Wiki): Activate ("You cannot set up an elemental balance
// while in building mode.") plays sound 227 and puts out the orb NPC unbalanced. Fire is red, water
// blue, earth green and air cyan; fire opposes water and earth opposes air, and the orb shows the
// stronger pair's colour at one of six brightnesses (the poh_elemental_balance_<tier>_<colour><1-6>
// NPCs). Strike, bolt, blast, wave and surge spells move it 1 to 5 shades towards their element;
// the runes must be in the inventory (no staves, no rune pouch). Whoever turns it white wins.
// How unbalanced it starts, the casting range and the win message are this server's.
const ACTIVATE_SOUND = 227;
/** A balance's NPC forms: poh_elemental_balance_<tier> when white, _<tier>_<colour><1-6> otherwise. */
function balanceForms(tier, start) {
  const forms = (colour) => Array.from({ length: 6 }, (_, index) => Ids.npc(`poh_elemental_balance_${tier}_${colour}${index + 1}`));
  return { white: Ids.npc(`poh_elemental_balance_${tier}`), start, red: forms("red"), blue: forms("blue"), green: forms("green"), cyan: forms("cyan") };
}
const TIERS = {
  LESSER_MAGICAL_BALANCE: balanceForms(1, 3),
  MEDIUM_MAGICAL_BALANCE: balanceForms(2, 5),
  GREATER_MAGICAL_BALANCE: balanceForms(3, 6),
};
const ELEMENTS = { FIRE: ["fire", 1], WATER: ["fire", -1], EARTH: ["earth", 1], WIND: ["earth", -1] };
const STRENGTH = { STRIKE: 1, BOLT: 2, BLAST: 3, WAVE: 4, SURGE: 5 };
const MAX_SHADE = 6;
const CAST_RANGE = 10;
const HIT_TICKS = 2;

/** house -> { npc, tier, furniture, fire, earth } */
const balances = new WeakMap();

/** The spell's element and strength: WATER_BLAST -> ["fire", -1, 3]. */
function elementOf(spell) {
  const name = Object.entries(CombatSpells).find(([, value]) => value === spell || value?.getSpell?.() === spell)?.[0] ?? "";
  const [element, kind] = name.split("_");
  return ELEMENTS[element] && STRENGTH[kind] ? [...ELEMENTS[element], STRENGTH[kind]] : null;
}

function shown(balance) {
  const tier = TIERS[balance.tier];
  const { fire, earth } = balance;
  if (!fire && !earth) return tier.white;
  if (Math.abs(fire) >= Math.abs(earth)) return tier[fire > 0 ? "red" : "blue"][Math.abs(fire) - 1];
  return tier[earth > 0 ? "green" : "cyan"][Math.abs(earth) - 1];
}

function activate(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture || !TIERS[furniture.buildableKey]) return false;
  if (house.buildingMode) return player.sendMessage("You cannot set up an elemental balance while in building mode."), true;
  if (balances.has(house)) return true;
  Prizes.offer(player, house, "balance", () => start(player, house, furniture, event.location));
  return true;
}

function start(player, house, furniture, location) {
  if (balances.has(house) || House.houseFor(player) !== house || house.buildingMode) return;
  const tier = TIERS[furniture.buildableKey];
  const roll = () => Math.floor(Math.random() * (2 * tier.start + 1)) - tier.start;
  const balance = { tier: furniture.buildableKey, furniture, fire: roll(), earth: roll() };
  if (!balance.fire && !balance.earth) balance.fire = tier.start;
  const npc = PluginManager.spawnNpc({ id: shown(balance), x: location.x, y: location.y, z: location.z, wanderRadius: 0 });
  if (!npc) return;
  npc.__skipDefaultRespawn = true;
  house.enter(npc);
  house.hideFurniture(furniture);
  balance.npc = npc;
  balances.set(house, balance);
  for (const occupant of house.getPlayers()) occupant.getPacketSender().sendAreaSound(ACTIVATE_SOUND, location.x, location.y, location.z, 1, 0, 5);
}

/** Instance.canCastOnNpc: spells on the orb shift it here instead of hitting it. */
function castOnBalance(player, npc, spell) {
  const house = House.houseFor(player);
  const balance = house && balances.get(house);
  if (!balance || balance.npc !== npc) return null;
  const element = elementOf(spell);
  if (!element) {
    player.sendMessage("Only elemental strike, bolt, blast, wave and surge spells affect the balance.");
    return false;
  }
  if (!player.getLocation().isWithinDistance(npc.getLocation(), CAST_RANGE)) return false;
  if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < spell.levelRequired()) {
    player.sendMessage(`You need a Magic level of ${spell.levelRequired()} to cast this spell.`);
    return false;
  }
  const runes = spell.itemsRequired(player) ?? [];
  if (!runes.every(item => player.getInventory().getAmount(item.getId()) >= item.getAmount())) {
    player.sendMessage("You do not have enough runes in your inventory to cast this spell.");
    return false;
  }
  for (const item of runes) player.getInventory().delete(item.getId(), item.getAmount());
  player.getMovementQueue().reset();
  player.setPositionToFace(npc.getLocation());
  const animation = spell.castAnimationFor(player);
  if (animation) player.performAnimation(animation);
  const graphic = spell.startGraphic();
  if (graphic) player.performGraphic(graphic);
  spell.castProjectile?.(player, npc)?.sendProjectile();
  TaskManager.submit(new CountdownTask(player, HIT_TICKS, () => shift(house, balance, element, spell, player)));
  return false;
}

function shift(house, balance, [axis, sign, amount], spell, caster) {
  if (balances.get(house) !== balance || !balance.npc.isRegistered()) return;
  balance[axis] = Math.max(-MAX_SHADE, Math.min(MAX_SHADE, balance[axis] + sign * amount));
  const impact = spell.endGraphic?.();
  if (impact) balance.npc.performGraphic(impact);
  balance.npc.setNpcTransformationId(shown(balance));
  if (balance.fire || balance.earth) return;
  for (const occupant of house.getPlayers()) occupant.sendMessage(`${caster.getUsername()} has balanced the elements!`);
  Prizes.award(house, "balance", caster);
  TaskManager.submit(new CountdownTask(caster, 3, () => end(house, balance)));
}

function banish(event) {
  const house = House.houseFor(event.player);
  const balance = house && balances.get(house);
  if (!balance || balance.npc !== event.npc) return false;
  end(house, balance);
  return true;
}

function end(house, balance) {
  if (balances.get(house) !== balance) return;
  balances.delete(house);
  Prizes.withdraw(house, "balance");
  if (balance.npc.isRegistered()) {
    house.leave(balance.npc, false);
    PluginManager.removeNpc(balance.npc);
  }
  house.showFurniture(balance.furniture);
}

/** Instance.rebuild in building mode: the orb is put away. */
function resetBalance(house) {
  const balance = balances.get(house);
  if (balance && house.buildingMode) end(house, balance);
}

function attachElementalBalance(api) {
  api.onObjectInteraction("Elemental balance", { Activate: activate });
  api.onNpcInteraction("Elemental balance", { Banish: banish });
}

Object.assign(module.exports, { attachElementalBalance, castOnBalance, resetBalance });
