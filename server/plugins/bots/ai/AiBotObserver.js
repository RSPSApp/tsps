"use strict";

const { describeItems } = require("./AiBotTrade");

/**
 * What an AI bot can see, gathered for its situation: where it is, what it's doing, its
 * stats and items, who's around, the chat it heard. Names only, never ids.
 */
const NEARBY_TILES = 15;

const distance = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
const plainName = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Players within `radius` tiles of `player` on its plane, nearest first (the player excluded). */
function playersNear(core, player, radius = NEARBY_TILES) {
  const here = player.getLocation();
  return core.World.getNearbyPlayersForUpdate(player)
    .filter((other) => other && other !== player && other.isRegistered?.() !== false)
    .filter((other) => other.getLocation().getZ() === here.getZ() && distance(other.getLocation(), here) <= radius)
    .sort((a, b) => distance(a.getLocation(), here) - distance(b.getLocation(), here));
}

/** A nearby player by name, however it's typed ("lazy fish", "LazyFish", "lazy_fish"). */
function findPlayerNear(core, player, name, radius = NEARBY_TILES) {
  const wanted = plainName(name);
  return playersNear(core, player, radius).find((other) => plainName(other.getUsername()) === wanted) ?? null;
}

function nearestPlace(places, location) {
  let best = null;
  for (const place of places) {
    const tiles = Math.max(Math.abs(place.x - location.getX()), Math.abs(place.y - location.getY()));
    if (!best || tiles < best.tiles) best = { place, tiles };
  }
  return best;
}

function describeWhere(places, location) {
  const near = nearestPlace(places, location);
  if (!near) return `at ${location.getX()}, ${location.getY()}`;
  if (near.tiles <= 30) return `in ${near.place.name}`;
  return `about ${near.tiles} tiles from ${near.place.name}`;
}

function describeSkills(core, player) {
  const manager = player.getSkillManager();
  return core.Skill.values()
    .map((skill) => ({ name: skill.getName(), level: manager.getMaxLevel(skill) }))
    .filter((entry) => entry.level > 1)
    .map((entry) => `${entry.name} ${entry.level}`)
    .join(", ");
}

function describeEquipment(player) {
  const names = player.getEquipment().getValidItems().map((item) => item.getDefinition().getName());
  return names.length > 0 ? names.join(", ") : "nothing";
}

function describeInventory(player) {
  const inventory = player.getInventory();
  return `${describeItems(inventory)} (${inventory.getFreeSlots()} free slots)`;
}

/** The view AiBotPrompt.buildSituation turns into text. */
function observe(mind, ask, nowMs = Date.now()) {
  const { bot, profile, services } = mind;
  const { core, places, catalog } = services;
  const location = bot.getLocation();
  const available = [];
  const unavailable = [];
  for (const entry of catalog) {
    (entry.activity.requires.every((condition) => condition.check({ player: bot })) ? available : unavailable).push(entry.id);
  }
  const nearby = playersNear(core, bot).slice(0, 10).map((other) => {
    const tiles = distance(other.getLocation(), location);
    return `${other.getUsername()} (combat ${other.getSkillManager().getCombatLevel()}, ${tiles} tile${tiles === 1 ? "" : "s"} away)`;
  });
  return {
    now: nowMs,
    name: bot.getUsername(),
    persona: profile.persona,
    notes: profile.notes ?? [],
    where: describeWhere([...places.values()], location),
    doing: mind.describeDoing(nowMs),
    combatLevel: bot.getSkillManager().getCombatLevel(),
    skills: describeSkills(core, bot),
    inventory: describeInventory(bot),
    equipment: describeEquipment(bot),
    available,
    unavailable,
    nearby,
    trade: mind.trade.describe(),
    chat: mind.chat,
    events: mind.events,
    ask,
  };
}

module.exports = { NEARBY_TILES, distance, findPlayerNear, observe, plainName, playersNear };
