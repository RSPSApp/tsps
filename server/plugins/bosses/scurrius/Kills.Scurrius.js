/**
 * A Scurrius kill: the kill count and the loot (Wiki: Scurrius; captured, docs/scurrius.md).
 * - Everyone who damaged him gets a kill ("Your Scurrius kill count is: N.", counted by Combat
 *   Achievements, varp 4079 total_rat_boss_kills), as he is a group boss.
 * - The loot lands on his middle tile. In a private instance the player rolls the MVP table; in
 *   the public lair whoever dealt the most damage rolls the MVP table and everyone else who
 *   helped rolls the non-MVP one, each seeing only their own.
 * - Wiki: only one player gets a spine per kill, and Ironmen in a group kill get nothing but
 *   medium clues (the Ironman plugin's shared-kill rule, which keeps what this answers).
 */
const Common = require("./Common.Scurrius");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

const MONSTER = "Scurrius";
/** data/definitions/npc-drops.json: the MVP (solo) and non-MVP tables, by the NPC whose first table they are. */
const MVP_TABLE_NPC = Common.SOLO_ID;
const NON_MVP_TABLE_NPC = Common.PUBLIC_ID;

let api = null;
let core = null;

/** Each player who helped, the killer first. */
function participants(killer, damagers) {
  const players = [killer, ...(damagers ?? [])].filter((player) => player?.isPlayer?.() && player.isRegistered?.() !== false);
  return [...new Set(players)];
}

function middle(npc) {
  return core.Projectile.centreOf(npc).clone();
}

function countKill(player) {
  api.emitCustomEvent("combat-achievements:kill", {
    player,
    monster: MONSTER,
    announce: (total) => sendBossKillCount(player, `Your Scurrius kill count is: <col=ff0000>${total}</col>.`),
  });
}

function onDeath({ npc, killer, damagers }) {
  if (!Common.isScurrius(npc)) return;
  for (const player of participants(killer, damagers)) countKill(player);
}

function roll(player, npcId) {
  const request = { player, npcId, drops: [] };
  api.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops;
}

/** Wiki: only one player may receive a spine per kill; the first roll that has one keeps it. */
function oneSpine(rolls) {
  const spine = core.ItemIdentifiers.SCURRIUS_SPINE;
  let given = false;
  for (const drops of rolls) {
    for (let i = drops.length - 1; i >= 0; i--) {
      if (drops[i].itemId !== spine) continue;
      if (given) drops.splice(i, 1);
      given = true;
    }
  }
}

function dropFor(player, drops, location) {
  const { Item, ItemDefinition } = core;
  const manager = api.getItemOnGroundManager();
  for (const drop of drops) {
    if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
    const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
    const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
    if (ItemDefinition.forId(itemId).isStackable()) manager.registerLocation(player, new Item(itemId, drop.amount), location);
    else for (let i = 0; i < drop.amount; i++) manager.registerLocation(player, new Item(itemId, 1), location);
  }
}

/**
 * The public kill: the killer (most damage) rolls the MVP table, the rest the non-MVP one. Each
 * helper's share goes through "npc-drops:roll" too, so the Ironman rule and the collection log
 * see it as they see the killer's. Plugins load in path order, so this runs before the Ironman
 * rule (plugins/modes/) trims the killer's roll.
 */
function onRoll(event) {
  if (event.helperShare || event.npcId !== Common.PUBLIC_ID || !Common.isPublic(event.npc)) return;
  event.drops.splice(0, event.drops.length, ...roll(event.player, MVP_TABLE_NPC));
  const shares = participants(event.player, event.damagers)
    .filter((player) => player !== event.player)
    .map((player) => ({ player, drops: roll(player, NON_MVP_TABLE_NPC) }));
  oneSpine([event.drops, ...shares.map((share) => share.drops)]);
  const location = middle(event.npc);
  for (const { player, drops } of shares) {
    api.emitCustomEvent("npc-drops:roll", { player, npc: event.npc, npcId: event.npcId, drops, damagers: event.damagers, helperShare: true });
    dropFor(player, drops, location);
  }
}

/** Wiki: Ironmen get medium clues from group kills, and nothing else. */
function ironmanKeeps(request) {
  if (Common.isScurrius(request.npc)) request.keep.push(core.ItemIdentifiers.CLUE_SCROLL_MEDIUM_);
}

function onLocation(where) {
  if (Common.isScurrius(where.npc)) where.location = middle(where.npc);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onNpcDeath(onDeath);
  pluginApi.onCustomEvent("npc-drops:roll", onRoll);
  pluginApi.onCustomEvent("npc-drops:location", onLocation);
  pluginApi.onCustomEvent("ironman:shared-kill-keeps", ironmanKeeps);
}

module.exports = { attach, _test: { participants, onDeath, onRoll, onLocation, oneSpine, ironmanKeeps, MVP_TABLE_NPC, NON_MVP_TABLE_NPC } };
