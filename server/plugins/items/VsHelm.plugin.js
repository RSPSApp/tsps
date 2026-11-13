/**
 * V's helm (https://oldschool.runescape.wiki/w/V%27s_helm), a Leagues VI (Demonic Pacts) echo item
 * whose effects are a Leagues VI character's only (Wiki):
 * - It counts as an imbued slayer helmet (`slayer:helmet`: the on-task melee, Ranged and Magic
 *   boosts, SlayerHelmet.plugin.js's, and the Slayer helmet's monster protection, Equipment.Slayer's).
 * - When hit directly for 1 or more, a 5% chance to reduce that damage to 0 (`onPlayerHitModify`,
 *   after protection prayers; the whole attack's hitsplats). It then says "V's helmet fills you with
 *   energy." and the next special attack within 60 seconds costs no energy (`combat-special:cost`:
 *   free when energy is checked and when it is drained, the drain using it up). No cooldown, and it
 *   does not stack: a proc while one is stored keeps the stored one and its time.
 * - While stored, the special orb shows its icon (varbit league_v_helm_special_active).
 * Ours: the zeroed hitsplat is the blocked (blue) one; the stored special is used whether or not the helm is still worn (the Wiki ties it to the
 * proc only), and it is not kept over a logout.
 */
const FREE_SPECIAL_ATTRIBUTE = "vs-helm:free-special-until";
const ORB_VARBIT_NAME = "league_v_helm_special_active";
const CHANCE = 0.05;
/** 60 seconds. */
const FREE_SPECIAL_TICKS = 100;
const MESSAGE = "V's helmet fills you with energy.";

let core;
let pluginApi;

/** Leagues VI (Demonic Pacts) item: its effects are a Leagues VI character's only (LeagueMode's `league:profile`). */
const LEAGUE_VI = 6;
function inLeagueSix(player) {
  const query = { player, league: null };
  pluginApi.emitCustomEvent("league:profile", query);
  return Number(query.league) === LEAGUE_VI;
}

function wearingHelm(player) {
  const { Equipment, ItemIdentifiers } = core;
  return player.getEquipment?.()?.get?.(Equipment.HEAD_SLOT)?.getId?.() === ItemIdentifiers.VS_HELM && inLeagueSix(player);
}

function cycle() {
  return core.World.getProcessCycle();
}

function freeSpecialStored(player) {
  return Number(player.getAttribute?.(FREE_SPECIAL_ATTRIBUTE) ?? 0) > cycle();
}

function showOrbIcon(player, shown) {
  const varbit = core.CacheDefinitions.getVarbitId(ORB_VARBIT_NAME);
  if (varbit !== null) player.getPacketSender().sendVarbit(varbit, shown ? 1 : 0);
}

function clearFreeSpecial(player) {
  player.setAttribute(FREE_SPECIAL_ATTRIBUTE, 0);
  showOrbIcon(player, false);
}

/** The stored special's 60 seconds run out: the orb icon goes, unless a newer one is stored. */
function expireLater(player, until) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(FREE_SPECIAL_TICKS); }
    execute() {
      this.stop();
      if (Number(player.getAttribute?.(FREE_SPECIAL_ATTRIBUTE) ?? 0) === until) clearFreeSpecial(player);
    }
  })());
}

function storeFreeSpecial(player) {
  if (freeSpecialStored(player)) return;
  const until = cycle() + FREE_SPECIAL_TICKS;
  player.setAttribute(FREE_SPECIAL_ATTRIBUTE, until);
  showOrbIcon(player, true);
  expireLater(player, until);
}

/** A direct hit of 1 or more: 5% of the time it deals 0 and stores a free special. */
function hitModify({ player, hit }) {
  if (!player || !hit || !wearingHelm(player) || hit.getTotalDamage() < 1) return;
  if (Math.random() >= CHANCE) return;
  for (const splat of hit.getHits()) {
    splat.setDamage(0);
    splat.setHitmask(core.HitMask.BLUE);
  }
  hit.updateTotalDamage();
  player.sendMessage(MESSAGE);
  storeFreeSpecial(player);
}

/** `combat-special:cost`: the stored special is free; its drain uses it up. */
function specialCost(request) {
  const player = request?.player;
  if (!player?.isPlayer?.() || !freeSpecialStored(player)) return;
  request.cost = 0;
  if (request.phase === "drain") clearFreeSpecial(player);
}

/** `slayer:helmet`: worn, the helm is a Slayer helmet (i). */
function slayerHelmet(request) {
  if (request?.player && wearingHelm(request.player)) request.worn = "imbued";
}

module.exports = {
  name: "VsHelm",
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onPlayerHitModify(hitModify);
    api.onCustomEvent("combat-special:cost", specialCost);
    api.onCustomEvent("slayer:helmet", slayerHelmet);
  },
  _test: { hitModify, specialCost, slayerHelmet, freeSpecialStored, FREE_SPECIAL_ATTRIBUTE, FREE_SPECIAL_TICKS },
};
