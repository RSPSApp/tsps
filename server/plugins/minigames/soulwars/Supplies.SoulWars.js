/**
 * Supplies, bones and the activity bar, as recorded (rsprox 227/00079, 234/03277;
 * soul-wars.json `items`, `activity`):
 * - the Bandage and Potion of power tables: Take-1, Take-5, Take-10, and Take-from asking "How many
 *   would you like to take?"; each item its own slot;
 * - a potion boosts Attack, Strength, Defence, Ranged and Magic by 5 + 15% ("You use a potion to
 *   boost yourself."); a bandage heals ("You use a bandage to heal yourself.", "You do not currently
 *   need bandaging." at full health) - Wiki: 1 + 15% of max HP, all run energy, and poison cured;
 * - the activity bar (800) falls 3 a tick from 18 ticks in; actions fill it again.
 * Wiki: buried in the base or a graveyard, bones give the team's avatar 1% strength (a third of
 * that where the team doesn't hold the graveyard); an empty bar removes the player, who must wait
 * 10 minutes before the next game. Unrecorded: the burial and removal lines.
 */
const Common = require("./Common.SoulWars");
const Match = require("./Match.SoulWars");
const Control = require("./Control.SoulWars");
const Avatars = require("./Avatars.SoulWars");

/** When each player (by name) may next join a game, after a removal for inactivity. */
const bannedUntil = new Map();
let clock = 0;

function started(game) {
  game.activity = new Map();
  for (const player of game.players()) game.activity.set(player, Common.data.activity.max);
  game.active = (player) => {
    if (!game.teamOf(player)) return;
    game.activity.set(player, Common.data.activity.max);
    Common.varbit(player, "soul_wars_activity_value", Common.data.activity.max);
  };
}

function tickActivity(game) {
  const { max, drain, from, banTicks } = Common.data.activity;
  if (game.elapsed < from) return;
  for (const player of game.players()) {
    const value = Math.max(0, (game.activity.get(player) ?? max) - drain);
    game.activity.set(player, value);
    Common.varbit(player, "soul_wars_activity_value", value);
    if (value > 0) continue;
    player.sendMessage(Common.message("inactive"));
    bannedUntil.set(player.getUsername(), clock + banTicks);
    game.remove(player);
  }
}

function banned(player) {
  return (bannedUntil.get(player.getUsername()) ?? 0) > clock;
}

function take(player, table, amount) {
  const game = Match.gameOf(player);
  if (!game) return false;
  const name = Common.core.CacheDefinitions.getObject(table.getId())?.name ?? "";
  const id = name.startsWith("Potion") ? Common.data.items.potions[0] : Common.data.items.bandages;
  const inventory = player.getInventory();
  const count = Math.min(amount, inventory.getFreeSlots());
  if (count <= 0) {
    inventory.full?.();
    return true;
  }
  for (let i = 0; i < count; i++) inventory.add(new Common.core.Item(id, 1), false);
  inventory.refreshItems?.();
  return true;
}

const takeN = (amount) => ({ player, object }) => take(player, object, amount);

function takeX({ player, object }) {
  if (!Match.gameOf(player)) return false;
  player.setEnteredAmountAction?.({ execute: (amount) => take(player, object, Math.max(0, Number(amount) || 0)) });
  player.getPacketSender().sendEnterAmountPrompt(Common.message("takeX"));
  return true;
}

function drink({ player, itemId }) {
  const game = Match.gameOf(player);
  const { potions } = Common.data.items;
  const at = potions.indexOf(itemId);
  if (!game || at < 0) return false;
  const inventory = player.getInventory();
  inventory.delete(potions[at], 1);
  if (at + 1 < potions.length) inventory.add(new Common.core.Item(potions[at + 1], 1), true);
  const skills = player.getSkillManager();
  for (const skill of ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC"]) {
    const base = Common.maxLevel(player, skill);
    const boosted = base + 5 + Math.floor(base * 0.15);
    if (Common.level(player, skill) < boosted) skills.setCurrentLevel(Common.core.Skill[skill], boosted, true);
  }
  player.sendMessage(Common.message("potion"));
  game.active(player);
  return true;
}

function heal({ player, itemId }) {
  const game = Match.gameOf(player);
  if (!game || itemId !== Common.data.items.bandages) return false;
  const max = Common.maxLevel(player, "HITPOINTS");
  const hp = player.getHitpoints?.() ?? max;
  if (hp >= max && (player.getRunEnergy?.() ?? 100) >= 100) {
    player.sendMessage(Common.message("noBandage"));
    return true;
  }
  player.getInventory().delete(Common.data.items.bandages, 1);
  player.setHitpoints(Math.min(max, hp + 1 + Math.floor(max * 0.15)));
  player.setRunEnergy?.(100);
  player.setPoisonDamage?.(0);
  player.sendMessage(Common.message("bandage"));
  game.active(player);
  return true;
}

/** Use a Soul Wars bandage on a teammate in the same active arena. */
function healTeammate(event) {
  const { player, target, item, itemId, slot } = event;
  const game = Match.gameOf(player);
  if (!game || itemId !== Common.data.items.bandages) return;
  event.handled = true;
  if (game.over || player === target || Match.gameOf(target) !== game
      || !game.teamOf(player) || !game.teamOf(target)) return;
  const world = Common.core.World;
  if (!player.isRegistered() || !target.isRegistered()
      || world.getPlayers().get(player.getIndex()) !== player || world.getPlayers().get(target.getIndex()) !== target
      || player.getPrivateArea() !== game.area || target.getPrivateArea() !== game.area
      || !game.area.contains(player.getLocation()) || !game.area.contains(target.getLocation())
      || player.getHitpoints() <= 0 || target.getHitpoints() <= 0
      || !player.getLocation().isWithinDistance(target.getLocation(), 1)) return;
  const inventory = player.getInventory();
  if (!Number.isInteger(slot) || slot < 0 || slot >= inventory.capacity()
      || inventory.getItems()[slot] !== item || item.getId() !== itemId || item.getAmount() <= 0) return;
  // TSPS wording, following the server's opposing-team refusal convention.
  if (game.teamOf(player) !== game.teamOf(target)) {
    player.sendMessage("You can't bandage an opposing player.");
    return;
  }
  const max = Common.maxLevel(target, "HITPOINTS");
  const hp = target.getHitpoints();
  // TSPS policy: don't spend a bandage on a teammate with no health, energy or poison to restore.
  if (hp >= max && target.getRunEnergy() >= 100 && target.getPoisonDamage() <= 0) {
    player.sendMessage(`${target.getDisplayName()} does not currently need bandaging.`);
    return;
  }
  inventory.deleteAtSlot(slot, 1);
  if (hp < max) target.setHitpoints(Math.min(max, hp + 1 + Math.floor(max * 0.15)));
  target.setRunEnergy(100);
  target.setPoisonDamage(0);
  target.setVenomed(false);
  // TSPS wording; the live update records the healer name, not its exact line.
  target.sendMessage(`${player.getDisplayName()} uses a bandage on you.`);
  game.active(player);
}

/** Where a team's bones count: its base, or a graveyard (a third where it isn't held). */
function burialWorth(game, player) {
  const team = game.teamOf(player);
  const at = game.area.templateOf(player.getLocation());
  const base = Common.data.bases[team];
  if (Math.abs(at[0] - base[0]) <= 8 && Math.abs(at[1] - base[1]) <= 8) return 1;
  for (const place of ["east", "west"]) {
    const zone = Common.data.control[place].zone;
    if (at[0] >= zone[0] && at[0] <= zone[2] && at[1] >= zone[1] && at[1] <= zone[3]) return Control.holder(game, place) === team ? 1 : 1 / 3;
  }
  return 0;
}

function bury({ player, itemId }) {
  const game = Match.gameOf(player);
  if (!game || itemId !== Common.data.items.bones) return false;
  const worth = burialWorth(game, player);
  if (worth <= 0) {
    player.sendMessage(Common.message("buryWhere"));
    return true;
  }
  const team = game.teamOf(player);
  if (game.avatars[team].strength >= 100) {
    player.sendMessage(Common.message("avatarFull"));
    return true;
  }
  player.getInventory().delete(Common.data.items.bones, 1);
  player.performAnimation(new Common.core.Animation(827));
  Avatars.adjust(game, team, Common.data.boneStrength * worth);
  game.statsOf(player).bones++;
  game.active(player);
  player.sendMessage(Common.message("bury"));
  return true;
}

function tick(game) {
  tickActivity(game);
}

function attachSupplies(api) {
  Match.onStart(started);
  Match.onTick(tick);
  Common.every(() => {
    clock++;
  });
  for (const table of ["Bandage table", "Potion of power table"]) {
    api.onObjectInteraction(table, { "Take-from": takeX, "Take-1": takeN(1), "Take-5": takeN(5), "Take-10": takeN(10) });
  }
  for (let dose = 1; dose <= 4; dose++) api.onItemAction(`Potion of power(${dose})`, { Drink: drink });
  api.onItemAction("Bandages", { Heal: heal });
  api.onItemOnPlayer(healTeammate);
  api.onItemAction("Bones", { Bury: bury });
}

module.exports = { attachSupplies, take, drink, heal, bury, banned, tickActivity };
