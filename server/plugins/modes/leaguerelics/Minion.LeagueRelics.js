/**
 * Minion (https://oldschool.runescape.wiki/w/Minion_(Demonic_Pacts_League)), Demonic Pacts' tier 8
 * relic: the Minion whistle's Blow summons the minion (the cache's league_guardian) beside its
 * owner for 30 minutes, with the melee spawn the recordings show; Banish sends it away. It follows
 * its owner and fights the NPC its owner fights, never a player, Yama or the Gemstone Crab (Wiki),
 * every 3 ticks (1.8 s) in the style the target is weakest to (the lowest of its melee, ranged and
 * magic defence rolls; a change of style shows the style's spotanim and takes its look), with an
 * attack roll of 45,000 against the target's defence roll for that style, hitting 3 up to 10 plus
 * 2 for each unique Zamorak item fed to the whistle (up to five, used on it unnoted; the Wiki's
 * list, by the items' own ids). Hits count as its owner's, as a thrall's do. The varbit
 * league_guardian_active runs the client's 30-minute buff timer against map_clock.
 *
 * Its looks are server-only cache columns, so each style's bas, body models, attack, projectile
 * and change spotanim are as the Leagues VI recordings show other players' minions
 * (data/league-minion.json). The pursuit is the Arceuus thralls' (core ArceuusThralls), with
 * their reach: 1 tile in melee, 6 at range (ours: the minion's reach is in no source).
 *
 * Not here, and why: the AoE in multicombat (no source gives its reach: the recordings show up to
 * five targets 0 to 7 tiles apart), the automatic looting and its threshold and noted settings
 * (the whistle's Rules and Check, where they are set, are unrecorded, as is where the loot goes),
 * and every message (no recording of the whistle in use on a Demonic Pacts world; Grid Master's
 * guardian lines name another relic).
 */
const Common = require("./Common.LeagueRelics");
const DATA = require("../data/league-minion.json");

const ITEMS_ATTRIBUTE = "league:minion-items";
const MELEE_REACH = 1;
const RANGED_REACH = 6;
const PURSUIT_ATTRIBUTE = "league:minion-pursuit";

let api;
let core;
let effect;
/** Each player's minion: { npc, ticksLeft, style, attackIn }. */
const minions = new Map();
const zamorakIds = new Set(Object.values(DATA.zamorakItems));

function active(player) {
  return Common.effectActive(player, effect);
}

function given(player) {
  const saved = player.getAttribute(ITEMS_ATTRIBUTE);
  return Array.isArray(saved) ? saved : [];
}

function maxHit(player) {
  return DATA.maxHit + DATA.maxHitPerItem * Math.min(DATA.maxItems, given(player).length);
}

function seq(name) {
  return core.CacheDefinitions.getSeqId(name);
}

function spotanim(name) {
  return core.CacheDefinitions.getSpotanimId(name);
}

function sendActive(player, on) {
  player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(DATA.activeVarbit), on ? 1 : 0);
}

/** Takes on a style's look: its body models and bas, and with `shown` the change spotanim. */
function setStyle(minion, style, shown) {
  const look = DATA.styles[style];
  minion.style = style;
  minion.npc.setModelCustomisation(DATA.modelSlots.map((slot, index) => ({ slot, modelId: look.models[index] })));
  const idle = seq(look.idle);
  minion.npc.setBaseAnimations({ idle, walk: seq(look.walk), turnLeft: idle, turnRight: idle });
  if (shown) minion.npc.performGraphic(new core.Graphic(spotanim(look.change), 0, 0));
}

/** The style the target is weakest to: the lowest of its defence rolls (melee: its weakest of stab, slash and crush). */
function weakestStyle(target) {
  const { AccuracyFormulasDpsCalc: Formulas, BonusManager } = core;
  const rolls = {
    melee: Math.min(...[BonusManager.ATTACK_STAB, BonusManager.ATTACK_SLASH, BonusManager.ATTACK_CRUSH].map((type) => Formulas.defenseMeleeRoll(target, type))),
    ranged: Formulas.defenseRangedRoll(target, "standard"),
    magic: Formulas.defenseMagicRoll(target),
  };
  return Object.entries(rolls).sort(([, a], [, b]) => a - b)[0][0];
}

function defenceRoll(target, style) {
  const { AccuracyFormulasDpsCalc: Formulas, BonusManager } = core;
  if (style === "ranged") return Formulas.defenseRangedRoll(target, "standard");
  if (style === "magic") return Formulas.defenseMagicRoll(target);
  return Math.min(...[BonusManager.ATTACK_STAB, BonusManager.ATTACK_SLASH, BonusManager.ATTACK_CRUSH].map((type) => Formulas.defenseMeleeRoll(target, type)));
}

/** OSRS's hit chance for an attack roll against a defence roll. */
function hitChance(attack, defence) {
  return attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1));
}

/** One attack at the target: the style's animation, projectile and a hit 3 to the max, landing as the projectile does. */
function attack(player, minion, target) {
  const look = DATA.styles[minion.style];
  const npc = minion.npc;
  npc.performAnimation(new core.Animation(seq(look.attack)));
  if (look.projectile) {
    const shot = look.projectile;
    core.Projectile.createProjectile(npc, target, spotanim(shot.id), shot.delay, shot.end, shot.startHeight, shot.endHeight)
      .withAngle(shot.angle).sendProjectile();
  }
  const accurate = Math.random() < hitChance(DATA.attackRoll, defenceRoll(target, minion.style));
  const max = maxHit(player);
  const damage = accurate ? DATA.minHit + Math.floor(Math.random() * (max - DATA.minHit + 1)) : 0;
  const land = () => {
    if (!target.isRegistered?.() || target.getHitpoints() <= 0) return;
    const hit = new core.HitDamage(damage, damage > 0 ? core.HitMask.RED : core.HitMask.BLUE).setSource(player)
      .onApplied((dealt) => target.getCombat().addDamage(player, dealt));
    target.getCombat().getHitQueue().addPendingDamage([hit]);
  };
  if (look.hitDelayTicks <= 1) land();
  else core.TaskManager.submit(new core.CountdownTask(npc, look.hitDelayTicks - 1, land));
}

/**
 * The NPC its owner fights, when the minion may fight it too: only one the owner may attack now
 * (core's attack permission, which spends nothing). Combat keeps a refused target to retry it
 * (a second NPC clicked while another holds the owner in single combat), so the target alone
 * is no leave to hit it.
 */
function targetOf(player) {
  const target = player.getCombat().getTarget();
  if (!target?.isNpc?.() || !target.isRegistered?.() || target.isUntargetable?.() || target.getHitpoints() <= 0) return null;
  if (DATA.spared.includes(target.getDefinition?.()?.getName?.())) return null;
  if (core.CombatFactory.canAttackPermission(player, target) !== core.CanAttackResponse.CAN_ATTACK) return null;
  return target;
}

function follow(minion, player) {
  const npc = minion.npc;
  if (npc.getFollowing() === player) return;
  npc.getMovementQueue().reset();
  npc.setAttribute(PURSUIT_ATTRIBUTE, null);
  npc.setFollowing(player);
}

/** Into reach of the target as a thrall goes (core ArceuusThralls); true once it may attack. */
function approach(minion, target) {
  const { CombatRange, PathFinder } = core;
  const npc = minion.npc;
  if (npc.getInteractingMobile() !== target) npc.setMobileInteraction(target);
  if (CombatRange.overlapsEntities(npc, target)) {
    npc.setFollowing(null);
    npc.setAttribute(PURSUIT_ATTRIBUTE, null);
    npc.getMovementQueue().setPursuitCheckpoint(PathFinder.naiveEntityDestination(npc, target));
    return false;
  }
  const reach = minion.style === "melee" ? MELEE_REACH : RANGED_REACH;
  if (npc.calculateDistance(target) > reach) {
    npc.setFollowing(null);
    const destination = CombatRange.rangedDestination(npc, target, reach);
    if (!npc.getAttribute(PURSUIT_ATTRIBUTE)?.equals?.(destination)) {
      PathFinder.calculateGroundItemRoute(npc, destination);
      npc.setAttribute(PURSUIT_ATTRIBUTE, destination);
    }
    return false;
  }
  if (npc.getFollowing() != null || npc.getAttribute(PURSUIT_ATTRIBUTE) != null) {
    npc.setFollowing(null);
    npc.getMovementQueue().reset();
    npc.setAttribute(PURSUIT_ATTRIBUTE, null);
  }
  return true;
}

/** A tick of the minion's life: away when time is up, else follow or fight. */
function tick(player, minion) {
  if (minions.get(player) !== minion) return false;
  if (!player.isRegistered?.() || --minion.ticksLeft <= 0 || !minion.npc.isRegistered?.()) {
    dismiss(player);
    return false;
  }
  if (minion.attackIn > 0) minion.attackIn--;
  const target = targetOf(player);
  if (!target) {
    follow(minion, player);
    return true;
  }
  const style = weakestStyle(target);
  if (style !== minion.style) setStyle(minion, style, true);
  if (!approach(minion, target) || minion.attackIn > 0) return true;
  attack(player, minion, target);
  minion.attackIn = DATA.attackTicks;
  return true;
}

function dismiss(player) {
  const minion = minions.get(player);
  minions.delete(player);
  if (minion?.npc?.isRegistered?.()) api.removeNpc(minion.npc);
  if (player.isRegistered?.()) sendActive(player, false);
}

function summon(player) {
  dismiss(player);
  const here = player.getLocation();
  const npc = api.spawnNpc({ id: core.CacheDefinitions.getNpcId(DATA.npc), x: here.getX(), y: here.getY(), z: here.getZ(), owner: player, wanderRadius: 0 });
  if (!npc) return;
  npc.setPet(true);
  npc.setUntargetable(true);
  npc.setFollowing(player);
  const minion = { npc, ticksLeft: DATA.durationTicks, style: "melee", attackIn: 0 };
  minions.set(player, minion);
  setStyle(minion, "melee", false);
  npc.performAnimation(new core.Animation(seq(DATA.spawn.animation)));
  npc.performGraphic(new core.Graphic(spotanim(DATA.spawn.graphic), 0, 0));
  sendActive(player, true);
  schedule(player, minion);
}

/** The minion's tick, again each tick while it lives. */
function schedule(player, minion) {
  core.TaskManager.submit(new core.CountdownTask(minion.npc, 1, () => {
    if (tick(player, minion)) schedule(player, minion);
  }));
}

function only(fn) {
  return (event) => {
    if (!active(event.player)) return false;
    event.handled = true;
    fn(event.player);
    return true;
  };
}

/** A unique Zamorak item used on the whistle, unnoted, while there is room under the five: taken. */
function feed(event) {
  const whistleId = core.ItemIdentifiers.MINION_WHISTLE;
  const other = event.usedItemId === whistleId ? event.usedWithItemId : event.usedWithItemId === whistleId ? event.usedItemId : -1;
  const slot = event.usedItemId === whistleId ? event.usedWithItemSlot : event.usedItemSlot;
  if (other < 0 || !zamorakIds.has(other) || !active(event.player)) return;
  event.handled = true;
  const player = event.player;
  const items = given(player);
  if (items.includes(other) || items.length >= DATA.maxItems) return;
  if (player.getInventory().getItems()[slot]?.getId() !== other) return;
  player.getInventory().deleteAtSlot(slot, 1);
  player.setAttribute(ITEMS_ATTRIBUTE, [...items, other]);
}

function login({ player }) {
  if (Common.leagueOf(player) !== null) sendActive(player, false);
}

function logout({ player }) {
  dismiss(player);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  effect = Common.data.effects.minion;
  api.persistAttribute(ITEMS_ATTRIBUTE, null);
  api.onItemAction(DATA.whistle, { Blow: only(summon), Banish: only(dismiss) });
  api.onItemOnItem(feed);
  api.onCustomEvent("league:login", login);
  api.onPlayerLogout(logout);
};

Object.assign(module.exports, { ITEMS_ATTRIBUTE, minions, tick, maxHit, weakestStyle, hitChance, summon, dismiss });
