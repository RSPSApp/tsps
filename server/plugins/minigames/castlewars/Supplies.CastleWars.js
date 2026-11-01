"use strict";

/**
 * Castle Wars supplies: instant table withdrawals, game-only potions and an unlimited rune pouch.
 */

const { boostSkill, restoreSkillToBaseWithFormula } = require("../../items/ConsumableEffects");

const TAKE_FIVE_CLICK = 2;
const POTION_AREA = "castle-wars";

let api;
let core;
let data;
let game;
let suppliedSpells;

function giveSupply(player, itemId, amount, message) {
  if (!game.requirePlaying(player)) return;
  if (itemId === data.RUNE_POUCH && player.getInventory().contains(itemId)) {
    player.sendMessage("You already have a Castle Wars rune pouch.");
    return;
  }
  const count = Math.min(amount, player.getInventory().getFreeSlots());
  if (count <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  player.getInventory().adds(itemId, itemId === data.RUNE_POUCH ? 1 : count);
  player.sendMessage(message);
}

function takeSupply(event) {
  const { player, object, clickType } = event;
  const supply = data.SUPPLY_TABLES[object.getId()];
  if (!supply || !game.inGameBounds(object.getLocation())) {
    return;
  }
  event.handled = true;
  if (!game.requirePlaying(player)) return;
  const [itemId, message] = supply;
  giveSupply(player, itemId, clickType === TAKE_FIVE_CLICK ? 5 : 1, message);
}

function giveStartingPouch({ player }) {
  giveSupply(player, data.RUNE_POUCH, 1, "Your rune pouch supplies unlimited combat runes during Castle Wars.");
}

function supplyCombatRunes(event) {
  if (game.isPlaying(event.player) && event.player.getInventory().contains(data.RUNE_POUCH) && suppliedSpells.get(event.spellbook)?.has(event.spellId)) {
    event.bypass = true;
  }
}

function noFreeMagicExperience(event) {
  if (event.skill === core.Skill.MAGIC && game.isPlaying(event.player) && event.player.getInventory().contains(data.RUNE_POUCH)) {
    event.allow = false;
  }
}

function applyBrew(player) {
  const { Skill } = core;
  for (const skill of Skill.values()) {
    if (skill !== Skill.HITPOINTS) restoreSkillToBaseWithFormula(player, skill, 8, 0.25);
  }
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) boostSkill(player, skill, 5, 0.15);
  boostSkill(player, Skill.RANGED, 4, 0.1);
  boostSkill(player, Skill.MAGIC, 1, 0.1);
  api.emitCustomEvent("potions:apply-stamina", { player });
}

function registerSupplyPotions() {
  api.emitCustomEvent("potions:register", { name: "Castlewars brew", chains: [data.BREW_DOSES], area: POTION_AREA, emptyItemId: null, effect: applyBrew });
}

function allowSupplyPotions(event) {
  if (event.area === POTION_AREA) event.inside = game.isPlaying(event.player);
}

/** A tap is mounted on a wall: use the cardinal tile in front, rather than reaching diagonally. */
function routeToTap(event) {
  if (!game.inGameBounds(event.object.getLocation()) || event.definition?.getName() !== "Tap") return;
  const location = event.object.getLocation();
  const sides = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const candidates = sides.map(([dx, dy]) => new core.Location(location.getX() + dx, location.getY() + dy, location.getZ()))
    .filter((tile) => !core.RegionManager.blocked(tile, event.player.getPrivateArea()));
  candidates.sort((a, b) => Math.abs(a.getX() - event.sourceLocation.x) + Math.abs(a.getY() - event.sourceLocation.y)
    - Math.abs(b.getX() - event.sourceLocation.x) - Math.abs(b.getY() - event.sourceLocation.y));
  const tile = candidates[0];
  if (tile) event.destination = { x: tile.getX(), y: tile.getY(), z: tile.getZ() };
}

module.exports = function attachCastleWarsSupplies(pluginApi, castleWars) {
  api = pluginApi;
  game = castleWars;
  core = api.core;
  data = castleWars.data;
  suppliedSpells = new Map();
  for (const spell of Object.values(core.CombatSpells)) {
    if (typeof spell?.spellId !== "function") continue;
    const book = spell.getSpellbook();
    if (!suppliedSpells.has(book)) suppliedSpells.set(book, new Set());
    suppliedSpells.get(book).add(spell.spellId());
  }
  api.onObjectInteraction(takeSupply);
  api.onObjectRoute(routeToTap);
  api.onSpellRuneBypass(supplyCombatRunes);
  api.onCanGainExperience(noFreeMagicExperience);
  api.onServerStartup(registerSupplyPotions);
  api.onCustomEvent("castlewars:started-player", giveStartingPouch);
  api.onCustomEvent("potions:area", allowSupplyPotions);
};
