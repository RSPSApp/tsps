/**
 * Waking, sleeping and dying around the fight itself (combat lives in Combat.Vorkath.js,
 * specials in Specials.Vorkath.js).
 *
 * Vorkath sleeps as 8059 until poked. As rsprox captures show it: the player pokes (827,
 * sound 2581); a tick later she turns into the no-op 8058 and rises (7950, sounds 1522 and
 * 1518), turns awake (8061) 7 ticks into the rise and attacks 6 ticks after that. No message.
 * Kills respawn her asleep (her NPC is removed 6 ticks after the death animation, as
 * captured). Attacks on the sleeper are denied with a poke-first message (ours).
 *
 * Her loot lands just outside her body, never under it: in rsprox captures (543 kills) always
 * on one of the 8 tiles one step out from her corners and the middles of her sides, mostly
 * the one nearest the player (either of two equally near ones).
 */
const Shared = require("./Shared.Vorkath");
const CombatAchievements = require("./CombatAchievements.Vorkath");
const Specials = require("./Specials.Vorkath");
const Hud = require("./Hud.Vorkath");

const POKE_ANIMATION = 827;
const WAKE_ANIMATION = 7950;
const POKE_SOUND = 2581;
const WAKE_SOUNDS = Object.freeze([[1522, 25], [1518, 115]]);
const POKE_FIRST_MESSAGE = "You need to poke Vorkath awake first.";
/** The loot tiles, relative to her south-west tile (her body is 0-6 on both axes). */
const LOOT_OFFSETS = Object.freeze([[-1, -1], [3, -1], [7, -1], [-1, 3], [7, 3], [-1, 7], [3, 7], [7, 7]]);
/** Blocked-tile flags, as the specials test walkability. */
const WALKABLE_MASK = 0x1280100;

let api = null;
let core = null;

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function alive(entity) {
  return !!entity?.isRegistered?.() && (entity.getHitpoints?.() ?? 1) > 0;
}

function pokeVorkath({ player, npc }) {
  if (!npc || npc.getId() !== Shared.SLEEPING_ID || !alive(npc)) return false;
  if (!alive(player)) return false;
  if (player.getPrivateArea?.() !== npc.getPrivateArea?.()) return false;
  player.performAnimation(new core.Animation(POKE_ANIMATION));
  player.getPacketSender().sendSoundEffect(POKE_SOUND, 1, 15);
  // The no-op form at once, so a second poke can't start a second wake.
  npc.setNpcTransformationId(Shared.WAKING_ID);
  later(1, () => {
    if (!alive(npc) || npc.getId() !== Shared.WAKING_ID) return;
    npc.performAnimation(new core.Animation(WAKE_ANIMATION));
    for (const [sound, delay] of WAKE_SOUNDS) player.getPacketSender().sendSoundEffect(sound, 1, delay);
    const cycle = core.World.getProcessCycle();
    npc.setAttribute(Shared.ATTR_ATTACKS, Shared.FIRST_SPECIAL_HEAD_START);
    npc.setAttribute(Shared.ATTR_NEXT_SPECIAL, Math.random() < 0.5 ? Shared.SPECIAL_ACID : Shared.SPECIAL_SPAWN);
    npc.setAttribute(Shared.ATTR_PHASE, Shared.PHASE_ACTIVE);
    npc.setAttribute(Shared.ATTR_WAKE_UNTIL, cycle + Shared.WAKE_TICKS);
    npc.setAttribute(Shared.ATTR_FIRST_ATTACK_AT, cycle + Shared.FIRST_ATTACK_TICKS);
    CombatAchievements.woke(player);
    later(Shared.WAKE_TICKS, () => {
      if (!alive(npc) || npc.getId() !== Shared.WAKING_ID) return;
      npc.setNpcTransformationId(Shared.AWAKE_ID);
      npc.setHitpoints?.(Shared.MAX_HITPOINTS);
      if (alive(player)) Hud.show(npc, player);
    });
    later(Shared.FIRST_ATTACK_TICKS, () => {
      if (!alive(npc) || npc.getId() !== Shared.AWAKE_ID || !alive(player)) return;
      npc.getCombat?.().attack?.(player);
    });
  });
  return true;
}

function denySleepingAttack(event) {
  const target = event.target;
  if (!target?.isNpc?.() || target.getId() !== Shared.SLEEPING_ID) return;
  event.allow = false;
  if (event.attacker?.isPlayer?.()) {
    event.attacker.sendMessage(POKE_FIRST_MESSAGE);
  }
}

function denyWakeAttack(event) {
  const target = event.target;
  if (!target?.isNpc?.() || target.getId() !== Shared.AWAKE_ID) return;
  const until = target.getAttribute?.(Shared.ATTR_WAKE_UNTIL) ?? 0;
  if (core.World.getProcessCycle() < until) {
    event.allow = false;
  }
}

function vorkathDied({ npc, killer }) {
  if (!npc || npc.getId() !== Shared.AWAKE_ID) return;
  if (killer) CombatAchievements.killed(killer);
  Specials.endFight(npc);
  Hud.killed(npc);
}

/** The nearest walkable loot tile to the player; equally near ones are picked at random. */
function lootTile(base, player, isWalkable, random = Math.random) {
  const at = player?.getLocation?.();
  const candidates = LOOT_OFFSETS
    .map(([dx, dy]) => [base.x + dx, base.y + dy])
    .filter(([x, y]) => isWalkable(x, y));
  if (candidates.length === 0) return null;
  if (!at) return candidates[Math.floor(random() * candidates.length)];
  const distance = ([x, y]) => (x - at.getX()) ** 2 + (y - at.getY()) ** 2;
  const best = Math.min(...candidates.map(distance));
  const nearest = candidates.filter((tile) => distance(tile) === best);
  return nearest[Math.floor(random() * nearest.length)];
}

function placeLoot(where) {
  if (where.npcId !== Shared.AWAKE_ID && where.npc?.getId?.() !== Shared.AWAKE_ID) return;
  const base = where.npc?.getLocation?.();
  if (!base) return;
  const z = base.getZ();
  const tile = lootTile(
    { x: base.getX(), y: base.getY() },
    where.player,
    (x, y) => (core.RegionManager.getClipping(x, y, z, null) & WALKABLE_MASK) === 0,
  );
  if (tile) where.location = new core.Location(tile[0], tile[1], z);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onNpcInteraction("Vorkath", { Poke: pokeVorkath });
  pluginApi.onCanAttack(denySleepingAttack);
  pluginApi.onCanAttack(denyWakeAttack);
  pluginApi.onNpcDeath(vorkathDied);
  pluginApi.onCustomEvent("npc-drops:location", placeLoot);
}

module.exports = { attach, pokeVorkath, denySleepingAttack, denyWakeAttack, vorkathDied, lootTile, placeLoot };
