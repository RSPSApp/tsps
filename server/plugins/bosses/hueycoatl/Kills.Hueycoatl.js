/**
 * Hits on the Hueycoatl, the kill and its loot.
 *
 * Hits (Wiki): the shielded head takes nothing, nor the tail while it sinks or rises; the tail
 * takes at most 4 a hit (9 when the attacker's crush bonus is their highest) and a miss
 * still deals 1; lit braziers add 30% to every player's hit.
 *
 * The kill, as captured (rsprox 3399, 3400, 4052): on the knockout's tick each player gets
 * "Your Hueycoatl kill count is: N." (varp total_huey_kills through Combat Achievements) and
 * the fight's duration, timed from when they reached the arena (or the set's first tick); the
 * loot lands on one tile in front of the head with the loot beam (vfx_huey_loot_beam).
 *
 * Loot (Wiki): a player qualifies with 25 body damage and 75 head and tail damage (teams of five
 * or fewer), or with either 25 body or 75 in all (six or more). Quantities scale with the
 * share of the fight's 4,050 hitpoints dealt (solo is the full table); under 25 body damage
 * they are cut to 5% (at least 1), with the warning. Each player rolls the uniques on their own,
 * as likely as their share; the pet too; Big bones go to the MVP.
 */
const Shared = require("./Shared.Hueycoatl");
const Pillars = require("./Pillars.Hueycoatl");
const Hud = require("./Hud.Hueycoatl");
const CombatAchievements = require("./CombatAchievements.Hueycoatl");

const BODY_QUALIFY = 25;
const BOSS_NAME = "Hueycoatl";
const HEAD_TAIL_QUALIFY = 75;
const TOTAL_QUALIFY = 75;
const SMALL_TEAM = 5;
const FEWER_REWARDS_SCALE = 0.05;
const BIG_BONES = 532;
const PET = 30152; // Huberte
/** BonusManager.ATTACK_CRUSH: stab, slash, crush, magic, ranged come first in the bonuses. */
const ATTACK_CRUSH = 2;
const ATTACK_BONUSES = 5;
const DROP_COLOUR = "ff289d";
const BROADCAST_COLOUR = "005f00";

let api = null;
let core = null;
/** Server-wide numbers since startup, for the scoreboard. */
const world = { kills: 0, best: 0 };

const now = () => core.World.getProcessCycle();

function damageOf(fight, player) {
  if (!fight.damage.has(player)) fight.damage.set(player, { body: 0, head: 0, tail: 0 });
  return fight.damage.get(player);
}

function total(damage) {
  return damage.body + damage.head + damage.tail;
}

/** True when the attacker's crush attack bonus is their highest. */
function crushHighest(player) {
  const bonuses = player.getBonusManager().getAttackBonus();
  const crush = bonuses[ATTACK_CRUSH];
  return bonuses.slice(0, ATTACK_BONUSES).every((bonus) => crush >= bonus);
}

function setAll(hit, damageOf) {
  for (const part of hit.getHits()) part.setDamage(damageOf(part.getDamage()));
  hit.updateTotalDamage();
}

function modifyHit({ npc, hit }) {
  if (!Shared.isFighter(npc.getId()) && npc.getId() !== Shared.NPC.RUBBLE && npc.getId() !== Shared.NPC.TAIL_BROKEN
    && npc.getId() !== Shared.NPC.HEAD_DEFEATED) return;
  const session = Shared.sessionOfNpc(npc);
  if (!session?.fight) return;
  const { fight } = session;
  const id = npc.getId();
  if (id === Shared.NPC.HEAD_SHIELDED || id === Shared.NPC.HEAD_DEFEATED || id === Shared.NPC.RUBBLE
    || id === Shared.NPC.TAIL_BROKEN || (id === Shared.NPC.TAIL && !fight.tailUp)) {
    setAll(hit, () => 0);
    return;
  }
  const attacker = hit.getAttacker();
  if (!attacker?.isPlayer()) return;
  const boost = Pillars.damageBoost(session);
  if (boost !== 1) setAll(hit, (damage) => Math.floor(damage * boost));
  if (id === Shared.NPC.TAIL) {
    const cap = crushHighest(attacker.getAsPlayer()) ? Shared.TAIL_CAP_CRUSH : Shared.TAIL_CAP;
    setAll(hit, (damage) => (damage <= 0 ? 1 : Math.min(damage, cap)));
  }
}

/** Every landed player hit on a part counts towards their share and moves their bar. */
function hitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer() || !target?.isNpc()) return;
  const npc = target.getAsNpc();
  const session = Shared.sessionOfNpc(npc);
  if (!session?.fight) return;
  const id = npc.getId();
  if (!Shared.isFighter(id)) return;
  const player = attacker.getAsPlayer();
  const amount = hit.getTotalDamage();
  if (amount > 0) {
    const dealt = damageOf(session.fight, player);
    if (id === Shared.NPC.BODY) dealt.body += amount;
    else if (id === Shared.NPC.TAIL) dealt.tail += amount;
    else dealt.head += amount;
    CombatAchievements.damaged(player, hit);
  }
  Hud.hitPart(session, player, npc);
}

function qualifies(damage, team) {
  if (team <= SMALL_TEAM) return damage.body >= BODY_QUALIFY && damage.head + damage.tail >= HEAD_TAIL_QUALIFY;
  return damage.body >= BODY_QUALIFY || total(damage) >= TOTAL_QUALIFY;
}

function roll(player, npc, entryFilter) {
  const request = { player, npc, npcId: Shared.NPC.HEAD, drops: [], entryFilter };
  api.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops;
}

const isUnique = (entry) => entry.section === "Unique";
const isTertiary = (entry) => entry.section === "Tertiary";
const isMain = (entry) => !isUnique(entry) && !isTertiary(entry) && entry.always !== true;

function scaled(drops, scale) {
  return drops.map((drop) => ({ ...drop, amount: Math.max(1, Math.floor(drop.amount * scale)) }));
}

/** One player's loot: the main roll scaled, uniques and the pet as likely as their share. */
function lootFor(player, npc, damage, team, mvp) {
  const share = Math.min(1, total(damage) / Shared.TOTAL_HITPOINTS);
  const scale = damage.body < BODY_QUALIFY ? share * FEWER_REWARDS_SCALE : share;
  const main = scaled(roll(player, npc, isMain), scale);
  const uniques = roll(player, npc, isUnique).filter(() => Math.random() < share);
  const tertiary = roll(player, npc, isTertiary).filter((drop) => drop.itemId !== PET || Math.random() < share);
  const drops = [...main, ...uniques, ...tertiary];
  if (mvp) drops.unshift({ itemId: BIG_BONES, amount: 1 });
  return { drops, main, uniques };
}

function itemName(id) {
  return core.ItemDefinition.forId(id)?.getName?.() ?? "item";
}

function describe(drop) {
  return drop.amount > 1 ? `${drop.amount.toLocaleString("en-US")} x ${itemName(drop.itemId)}` : itemName(drop.itemId);
}

/** On the floor for the player only (inside the fight's instance, for a private one). */
function placeDrops(player, session, drops, location) {
  const { Item, ItemDefinition } = core;
  const manager = api.getItemOnGroundManager();
  for (const drop of drops) {
    if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
    const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
    const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
    if (ItemDefinition.forId(itemId).isStackable()) {
      manager.registerLocation(player, new Item(itemId, drop.amount), location, session.area);
    } else {
      for (let index = 0; index < drop.amount; index++) manager.registerLocation(player, new Item(itemId, 1), location, session.area);
    }
  }
}

function announceKill(player, kills, ticks) {
  player.sendMessage(`Your Hueycoatl kill count is: <col=ff0000>${kills}</col>.`);
  const best = Shared.counter(player, Shared.BEST_TICKS_ATTRIBUTE);
  if (!best || ticks < best) {
    player.setAttribute(Shared.BEST_TICKS_ATTRIBUTE, ticks);
    api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
    player.sendMessage(`Fight duration: <col=ff0000>${Shared.formatTicks(ticks)}</col> (new personal best)`);
  } else {
    player.sendMessage(`Fight duration: <col=ff0000>${Shared.formatTicks(ticks)}</col>. Personal best: ${Shared.formatTicks(best)}`);
  }
}

function recordKill(player, ticks) {
  const own = Shared.counter(player, Shared.KILLS_ATTRIBUTE) + 1;
  const request = { player, monster: Shared.MONSTER, count: own, announce: (kills) => announceKill(player, kills, ticks) };
  api.emitCustomEvent("combat-achievements:kill", request);
  player.setAttribute(Shared.KILLS_ATTRIBUTE, Math.max(own, request.total ?? 0));
  if (request.total == null) announceKill(player, own, ticks);
}

/** The head is beaten: kill counts, durations and each player's loot. */
function killed(session) {
  const { fight } = session;
  const t = now();
  const team = session.arenaPlayers();
  const fighters = team.filter((player) => total(damageOf(fight, player)) > 0);
  if (fighters.length === 0) return;
  const mvp = fighters.reduce((best, player) => (total(damageOf(fight, player)) > total(damageOf(fight, best)) ? player : best));
  const lootTile = [Shared.randomBetween(Shared.LOOT_TILES.minX, Shared.LOOT_TILES.maxX), Shared.randomBetween(Shared.LOOT_TILES.minY, Shared.LOOT_TILES.maxY)];
  const location = session.tile(lootTile);
  world.kills += 1;
  for (const player of fighters) {
    const damage = damageOf(fight, player);
    const ticks = Math.max(0, t - Math.max(fight.spawnedAt + 1, fight.joinedAt.get(player) ?? 0));
    if (world.best <= 0 || ticks < world.best) world.best = ticks;
    if (damage.body < BODY_QUALIFY) player.sendMessage(Shared.MESSAGE.FEWER_REWARDS);
    recordKill(player, ticks);
    CombatAchievements.killed(player, session, ticks, team.length);
    if (!qualifies(damage, team.length)) continue;
    const { drops, main, uniques } = lootFor(player, fight.head, damage, team.length, player === mvp);
    // Collection log, Ironman and saves hear each share as the player's own roll.
    api.emitCustomEvent("npc-drops:roll", { player, npc: fight.head, npcId: Shared.NPC.HEAD, drops, damagers: fighters });
    placeDrops(player, session, drops, location);
    session.graphic(lootTile, Shared.GFX.LOOT_BEAM, 0, [player]);
    for (const drop of main) player.sendMessage(`<col=${DROP_COLOUR}>The Hueycoatl dropped: ${describe(drop)}</col>`);
    for (const drop of uniques.filter((entry) => drops.includes(entry))) {
      for (const other of team) other.sendMessage(`<col=${BROADCAST_COLOUR}>${player.getUsername()} received a drop: ${describe(drop)}</col>`);
    }
  }
}

function personalBest(request) {
  if (request.monster !== Shared.MONSTER || !request.player) return;
  const best = Shared.counter(request.player, Shared.BEST_TICKS_ATTRIBUTE);
  if (best > 0) request.best = best;
}

function killCounts(request) {
  if (!request.player) return;
  const kills = Shared.counter(request.player, Shared.KILLS_ATTRIBUTE);
  if (kills > 0) request.counts[Shared.MONSTER] = kills;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.persistAttribute(Shared.KILLS_ATTRIBUTE, 0);
  pluginApi.persistAttribute(Shared.BEST_TICKS_ATTRIBUTE, 0);
  pluginApi.onNpcHitModify(modifyHit);
  pluginApi.onCombatHitResolved(hitResolved);
  pluginApi.onCustomEvent("combat-achievements:personal-best", personalBest);
  pluginApi.onCustomEvent("combat-achievements:kill-count", killCounts);
}

module.exports = {
  attach, killed, world,
  _test: { qualifies, lootFor, scaled, crushHighest, isMain, isUnique, isTertiary },
};
