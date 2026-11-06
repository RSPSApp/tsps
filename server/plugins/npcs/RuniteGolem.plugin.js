/**
 * Runite Golems in the Resource Area (https://oldschool.runescape.wiki/w/Runite_Golem): "When one is killed,
 * its head becomes a runite rock, which can be mined by anyone with 85 Mining for 1 minute before despawning.
 * The golem will respawn 5 minutes afterward."
 *
 * No capture shows a death or the rock: 1444 and 3886 have golem 6600 walking and leaving view, and NPC search
 * finds neither 6601 nor 7722. So all of this is the Wiki, and these are ours:
 * - One ore per rock, then it turns into the cache's no-ore form 7722 ("Rocks") for what is left of the minute.
 *   Supported, not stated: the Wiki's 14 October 2026 change speaks of "successfully mining" and of receiving "at
 *   least one Runite Ore from a Runite Golem before it respawns", and the cache has that form.
 * - The chance per swing is the Runite rocks chart: the golem's Mining info gives only level 85 and 125 XP. That
 *   same change says the chance "has been increased", with no number, so this may understate it.
 * - One ore each time. The Wiki gives diary tiers a "chance" of 2, 3 and 4 total ores with no rate.
 * - The rock stays where the golem died: the death task's movement block is never lifted on this NPC.
 * - A second miner's session stops silently when the rock is spent, and clicking the spent rock does nothing.
 * Not built: Mining's effect on melee against the golem, Varrock armour 4's doubling, Expert Mining Gloves' chance
 * to prevent depletion (same change), the dark bow bug.
 */
const GOLEM_ID = 6600; // wilderness_rune_golem
const ROCK_ID = 6601; // wilderness_golem_rune_rock, op1 Mine
const NO_ORE_ID = 7722; // golem_rune_rock_no_ore
const ROCK_TICKS = 100; // Wiki: 1 minute
const RESPAWN_TICKS = 500; // Wiki: 5 minutes afterward

let api;
/** Who killed each golem, by name: the diary task wants the player who killed it. */
const killers = new WeakMap();

const isGolem = (npc) => npc?.getRealId?.() === GOLEM_ID;

function golemDied(event) {
  const { npc } = event;
  if (!isGolem(npc)) return;
  event.remains = { ticks: ROCK_TICKS, respawnTicks: RESPAWN_TICKS };
  killers.set(npc, event.killer?.getUsername?.() ?? null);
  // Nothing walks to a 0 HP NPC, so the rock couldn't be mined; the same as the other remains (Araxxor's corpse).
  npc.setHitpoints(1);
  // Nothing can re-kill the rock, which would queue a second respawn, and it doesn't regenerate. Poison would still
  // show its splat on a locked NPC, so the death cures it. The respawn is a new NPC, with neither.
  npc.setHitpointsLocked(true);
  npc.setPoisonDamage(0);
  npc.setNpcTransformationId(ROCK_ID);
}

/** Which golem a rock came from: there are two, and each keeps its spawn tile. */
function golemKey(npc) {
  const spawn = npc.getSpawnPosition();
  return `${spawn.getX()},${spawn.getY()}`;
}

function mineRock(event) {
  const { npc, player } = event;
  if (!isGolem(npc) || npc.getNpcTransformationId() !== ROCK_ID || event.clickType !== 1) return;
  event.handled = true;
  api.emitCustomEvent("mining:mine-npc-rock", {
    player, npc, rockName: "Runite rocks",
    stands: () => npc.isRegistered() && npc.getNpcTransformationId() === ROCK_ID,
  });
}

function rockMined({ player, npc }) {
  if (!isGolem(npc)) return;
  npc.setNpcTransformationId(NO_ORE_ID);
  api.emitCustomEvent("runite-golem:mined", {
    player, golem: golemKey(npc), killedIt: killers.get(npc) === player.getUsername(),
  });
}

module.exports = {
  name: "RuniteGolem",
  members: true,
  dependsOn: ["Mining"],
  register(pluginApi) {
    api = pluginApi;
    api.onNpcDeath(golemDied);
    api.onNpcInteraction(mineRock);
    api.onCustomEvent("mining:npc-rock-mined", rockMined);
  },
};
