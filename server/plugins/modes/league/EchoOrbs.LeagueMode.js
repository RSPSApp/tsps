/**
 * Demonic Pacts League echo orbs (data/league-echo-orbs.json;
 * https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Echo_bosses_and_echo_equipment).
 *
 * Drops: each regional boss's kill rolls its region's orb at the Wiki's rate, and the orb is
 * guaranteed once the kills since the last one reach that rate (Wiki: Echo orb). A kill through
 * NpcDrops asks `npc-drops:add` once; another roller (the Gauntlet's reward chest) passes its
 * `source` on `npc-drops:roll`. The orb joins that roll's drops, with the green "received a
 * drop" line.
 *
 * Entry: a boss's own entrance emits `echo-boss:entry` { player, boss, enter, handled } just
 * before it lets the player in, with `enter` doing the usual entry. A character carrying that
 * boss's orb (Wiki: in the inventory, not consumed) is asked "Fight the Echo of …?" instead
 * and the entrance does nothing more (`handled`): No runs `enter`; Yes is `startEchoFight`.
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.LeagueMode");

/** Kills of each boss since its orb last dropped, by the data's boss key. */
const KILLS_ATTRIBUTE = "league:echo-orb-kills";

let data = null;
let api = null;

function load() {
  if (!data) data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "league-echo-orbs.json"), "utf8"));
  return data;
}

function inEchoLeague(player) {
  const type = Common.leagueOf(player);
  return type !== null && load().leagues.includes(type);
}

function orbOf(boss) {
  return load().orbs[boss] ?? null;
}

function orbItemId(orb) {
  return Common.core.ItemIdentifiers[orb.item];
}

/** The boss key whose orb a kill of this NPC (or this roller's source) rolls, or null. */
function bossFor({ npc, npcId, source }) {
  const name = String(npc?.getDefinition?.()?.getName?.() ?? "").toLowerCase();
  const sourceName = String(source ?? "").toLowerCase();
  const ids = Common.core.NpcIdentifiers;
  for (const [boss, orb] of Object.entries(load().orbs)) {
    if (sourceName && (orb.sources ?? []).some((entry) => entry.toLowerCase() === sourceName)) return boss;
    if (!npc) continue;
    if (name && (orb.npcs ?? []).some((entry) => entry.toLowerCase() === name)) return boss;
    if ((orb.npcIds ?? []).some((entry) => ids[entry] === npcId)) return boss;
  }
  return null;
}

/** One kill's orb roll: the Wiki's 1 in rate, certain once the kills since the last orb reach the rate. */
function rollsOrb(player, boss, random = Math.random) {
  const orb = orbOf(boss);
  const counts = { ...(player.getAttribute(KILLS_ATTRIBUTE) ?? {}) };
  const kills = (Number(counts[boss]) || 0) + 1;
  const dropped = kills >= orb.rate || Math.floor(random() * orb.rate) === 0;
  counts[boss] = dropped ? 0 : kills;
  player.setAttribute(KILLS_ATTRIBUTE, counts);
  return dropped;
}

/**
 * Adds the orb to a roll's drops when it lands. Both drop shapes rollers use are filled
 * (NpcDrops' `itemId`, the Gauntlet chest's `id`).
 */
function addOrb(player, boss, drops, random) {
  if (!rollsOrb(player, boss, random)) return false;
  const itemId = orbItemId(orbOf(boss));
  // On the floor it stays the killer's and lies far longer than other loot (data `ground`).
  drops.push({ itemId, id: itemId, amount: 1, ground: { ...load().ground } });
  const name = Common.core.ItemDefinition.forId(itemId)?.getName?.() ?? "";
  // The line the killer sees; who else live shows it to is not known, so only the killer gets it (ours).
  player.sendMessage(load().messages.drop.replace("{player}", player.getDisplayName()).replace("{item}", name));
  return true;
}

/** npc-drops:add { player, npc, npcId, drops }: a regional boss's kill. */
function killDrop(event) {
  const { player, npc, drops } = event ?? {};
  if (!player || !npc || !Array.isArray(drops) || !inEchoLeague(player)) return;
  const boss = bossFor(event);
  if (boss) addOrb(player, boss, drops);
}

/** npc-drops:roll { player, source, drops } from a roller without an NPC (the Gauntlet's reward chest). */
function sourceDrop(event) {
  const { player, npc, source, drops } = event ?? {};
  if (!player || npc || !source || !Array.isArray(drops) || !inEchoLeague(player)) return;
  const boss = bossFor({ source });
  if (boss) addOrb(player, boss, drops);
}

/**
 * The echo fight itself. Ours: echo bosses are not implemented, so this answers false and the
 * player stays outside with "Nothing interesting happens."; an echo fight starts here, and
 * answers true once it has taken the player in.
 */
function startEchoFight(player, boss) {
  void player;
  void boss;
  return false;
}

function answerYes(player, boss) {
  if (startEchoFight(player, boss)) return;
  player.sendMessage(load().messages.placeholder);
}

/** Logged in, alive and on the tile the menu opened on. */
function stillAt(player, origin) {
  if (player.isRegistered?.() === false || player.getHitpoints?.() <= 0) return false;
  const at = player.getLocation();
  return at.getX() === origin.getX() && at.getY() === origin.getY() && at.getZ() === origin.getZ();
}

/** echo-boss:entry { player, boss, enter, handled }: the boss's prompt while its orb is carried. */
function entryPrompt(event) {
  const { player, boss, enter } = event ?? {};
  if (!player || typeof enter !== "function" || event.handled) return;
  const orb = orbOf(boss);
  if (!orb || !inEchoLeague(player) || !player.getInventory().contains(orbItemId(orb))) return;
  const { yes, no } = load().messages;
  const origin = player.getLocation().clone();
  // No: the usual entry, as without an orb (decided; live's answer is not recorded). The entrance's
  // `enter` checks its own rules again; here, the player is still where the menu opened.
  const answerNo = () => {
    if (stillAt(player, origin)) enter();
  };
  const shown = api.sendMultiChatboxPrompt(player, orb.title, yes, () => answerYes(player, boss), no, answerNo);
  if (shown !== false) event.handled = true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  api.persistAttribute(KILLS_ATTRIBUTE, {});
  api.onCustomEvent("npc-drops:add", killDrop);
  api.onCustomEvent("npc-drops:roll", sourceDrop);
  api.onCustomEvent("echo-boss:entry", entryPrompt);
};

module.exports.startEchoFight = startEchoFight;
module.exports._test = { bossFor, rollsOrb, addOrb, killDrop, sourceDrop, entryPrompt, answerYes, KILLS_ATTRIBUTE };
