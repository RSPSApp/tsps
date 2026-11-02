/**
 * A Wilderness boss's kill (https://oldschool.runescape.wiki/w/Callisto#Drops and its six
 * pages): the loot is split between the players who damaged it, by damage.
 *
 * - Up to 10 players get drops: each rolls the table, with quantities scaled to their share of
 *   the damage, at least 25% of the solo amount (an Ironman under 7% of the damage: 5%).
 * - Uniques are decided per kill: one roll of the unique table, given to one of those players
 *   chosen by share. The pet is rolled for each of them, as likely as their share.
 * - The top damager gets big bones and the entry fee discount; the others bones.
 * - Everyone rewarded gets the kill and is told the count ("Your Artio kill count is: N.", captured
 *   with the discount message before the drop messages, four ticks into the death).
 *
 * The damage is read before the death clears it (onNpcBeforeDeath), and the kill is taken over
 * from NpcDrops through "npc-drops:claim".
 */
const Common = require("./Common.WildernessBosses");

const MAX_RECIPIENTS = 10;
const MIN_SHARE = 0.25;
const IRONMAN_MIN_DAMAGE = 0.07;
const IRONMAN_MIN_SHARE = 0.05;
const BIG_BONES = 532;
const BONES = 526;
/** The captured drop broadcast's colours. */
const DROP_COLOUR = "005f00";
const BOSS_COLOUR = "106f10";

/** The pets, rolled per recipient by share. */
const PETS = new Set([
  13178, // Callisto cub
  13177, // Venenatis spiderling
  13179, // Vet'ion jr.
]);

let api = null;
let core = null;
/** Caves.addDiscount and Caves.playersIn, handed over at attach. */
let addDiscount = () => {};
let lairPlayersOf = () => [];
/** npc -> [{ player, damage }] captured as it dies. */
const damageAtDeath = new WeakMap();
/** lair key per boss id, for the bosses this unit splits. */
const LAIR_BY_BOSS = new Map(Common.LAIRS.flatMap((lair) => lair.bossIds.map((id) => [id, lair])));

function isUnique(entry) {
  return /^Uniques?$/.test(entry.section ?? "");
}

function isTertiary(entry) {
  return entry.section === "Tertiary";
}

function isPet(entry) {
  return PETS.has(entry.item_id);
}

function isBones(entry) {
  return entry.always === true && (entry.item_id === BIG_BONES || entry.item_id === BONES);
}

function isIron(player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

function roll(player, npc, npcId, entryFilter) {
  const request = { player, npc, npcId, drops: [], entryFilter };
  api.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops;
}

/** The top damagers, most first, with their shares of the damage. */
function recipients(entries) {
  const top = entries.filter(({ damage }) => damage > 0).sort((a, b) => b.damage - a.damage).slice(0, MAX_RECIPIENTS);
  const total = top.reduce((sum, { damage }) => sum + damage, 0);
  return top.map(({ player, damage }) => {
    const share = total > 0 ? damage / total : 0;
    const floor = isIron(player) && share < IRONMAN_MIN_DAMAGE ? IRONMAN_MIN_SHARE : MIN_SHARE;
    return { player, damage, share, scale: Math.min(1, Math.max(floor, share)) };
  });
}

function pickByShare(list) {
  let pick = Math.random();
  for (const entry of list) {
    pick -= entry.share;
    if (pick < 0) return entry;
  }
  return list[0];
}

function scaled(drops, scale) {
  return drops.map((drop) => ({ ...drop, amount: drop.amount > 1 ? Math.max(1, Math.floor(drop.amount * scale)) : drop.amount }));
}

function itemName(id) {
  return core.ItemDefinition.forId(id)?.getName?.() ?? "item";
}

/** The captured broadcast to everyone in the lair: "<name> received a drop: ...". */
function announce(lair, player, drop) {
  const what = drop.amount > 1 ? `${drop.amount.toLocaleString("en-US")} x ${itemName(drop.itemId)}` : itemName(drop.itemId);
  const bones = drop.itemId === BIG_BONES || drop.itemId === BONES;
  const text = `<col=${DROP_COLOUR}>${player.getDisplayName()} received a drop: ${what}</col>${bones ? "" : ` <col=${BOSS_COLOUR}>(${lair.boss})</col>`}`;
  const listeners = lairPlayersOf(lair.key);
  for (const other of listeners.length > 0 ? listeners : [player]) other.sendMessage(text);
}

function tellKillCount(player, lair, kills) {
  player.sendMessage(`Your ${lair.boss} kill count is: <col=ff0000>${kills}</col>.`);
}

/**
 * One more kill for everyone rewarded. The main bosses' counts are Combat Achievements' (which
 * tells the count before any task it finishes); a singles boss keeps its own, and its kill counts
 * for its main boss's Combat Achievements too (Wiki).
 */
function addKill(player, lair) {
  if (!lair.killVarp) {
    api.emitCustomEvent("combat-achievements:kill", {
      player, monster: lair.monster, announce: (kills) => tellKillCount(player, lair, kills),
    });
    return;
  }
  const all = { ...(player.getAttribute(Common.KILLS_ATTRIBUTE) ?? {}) };
  all[lair.key] = (Number(all[lair.key]) || 0) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, all);
  player.getPacketSender().sendConfig(lair.killVarp, all[lair.key]);
  tellKillCount(player, lair, all[lair.key]);
  api.emitCustomEvent("combat-achievements:kill", { player, monster: lair.monster });
}

/** Before the death clears the damage record: who hit it, and how hard. */
function beforeDeath(event) {
  const { npc } = event;
  if (event.preventDeath || !LAIR_BY_BOSS.has(npc?.getId?.())) return;
  damageAtDeath.set(npc, npc.getCombat().getRecentDamagerEntries());
}


/** The kill, split between the players who damaged the boss. */
function claim(event) {
  const { npc, npcId } = event;
  const lair = LAIR_BY_BOSS.get(npc?.getId?.());
  if (!lair) return;
  event.handled = true;
  const list = recipients(damageAtDeath.get(npc) ?? [{ player: event.killer, damage: 1 }]);
  damageAtDeath.delete(npc);
  if (list.length === 0) return;
  const mvp = list[0];
  const location = npc.getLocation().clone();
  const shares = new Map(list.map((entry) => [entry.player, []]));

  const unique = roll(mvp.player, npc, npcId, isUnique);
  if (unique.length > 0) shares.get(pickByShare(list).player).push(...unique.slice(0, 1));

  for (const entry of list) {
    const { player } = entry;
    const bones = { itemId: entry === mvp ? BIG_BONES : BONES, amount: 1 };
    const main = roll(player, npc, npcId, (e) => !isUnique(e) && !isTertiary(e) && !isBones(e));
    const tertiary = roll(player, npc, npcId, (e) => isTertiary(e) && !isPet(e));
    const pet = roll(player, npc, npcId, (e) => isPet(e)).filter(() => Math.random() < entry.share);
    shares.get(player).unshift(bones, ...scaled(main, entry.scale), ...tertiary, ...pet);
  }

  for (const entry of list) {
    const { player } = entry;
    if (!player.isRegistered()) continue;
    addKill(player, lair);
    if (entry === mvp) addDiscount(player);
    const drops = shares.get(player);
    // Collection log, Ironman and saves hear each share as the player's own roll.
    api.emitCustomEvent("npc-drops:roll", { player, npc, npcId, drops, damagers: [player] });
    api.emitCustomEvent("npc-drops:place", { player, drops, location });
    for (const drop of drops) announce(lair, player, drop);
  }
}

function attach(pluginApi, hooks) {
  api = pluginApi;
  core = pluginApi.core;
  addDiscount = hooks.addDiscount;
  lairPlayersOf = hooks.playersIn;
  pluginApi.persistAttribute(Common.KILLS_ATTRIBUTE);
  pluginApi.onNpcBeforeDeath(beforeDeath);
  pluginApi.onCustomEvent("npc-drops:claim", claim);
  pluginApi.onPlayerLogin(sendKillCounts);
}

function sendKillCounts({ player }) {
  const all = player.getAttribute(Common.KILLS_ATTRIBUTE) ?? {};
  for (const lair of Common.LAIRS) {
    if (lair.killVarp && all[lair.key] > 0) player.getPacketSender().sendConfig(lair.killVarp, all[lair.key]);
  }
}

module.exports = { attach, _test: { recipients, scaled, isUnique, isTertiary, isPet, claim, beforeDeath } };
