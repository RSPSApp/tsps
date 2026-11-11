/**
 * Scorpia (https://oldschool.runescape.wiki/w/Scorpia, /Strategies, /w/Scorpia%27s_guardian), in
 * the cave beneath the Scorpion Pit. No live captures exist of her, so this is from the Wiki; the
 * cave's ways in and out pair each pit "Cavern" with the nearest "Crevice" (from the cache), and
 * the crawl (human_longcrawl, a tick) is the Escape Caves' (docs/wilderness-bosses.md).
 *
 * - Her melee (the engine's, from her definition) drains 2 Prayer points when Protect from Melee
 *   is on, hit or miss; she and her offspring poison through their definitions.
 * - The first attack on her once she is at 99 or less calls two guardians next to her. Each heals
 *   her 8 every 3 ticks (a curse) while within 3 tiles of her, despawns after 25 ticks without
 *   healing, and never comes back that fight.
 */
const Common = require("./Common.WildernessBosses");

const SCORPIA = 6615;
const GUARDIAN = 6617;
const CAVERN = 26762; // wilderness_scorpion_entrance
const CREVICE = 26763; // wilderness_scorpion_exit
const LONG_CRAWL = 2796;

/** Each pit cavern and the crevice nearest it: [cavern tile, cave arrival, crevice tile, pit arrival]. */
const WAYS = Object.freeze([
  [[3231, 3936], [3233, 10332], [3233, 10331], [3233, 3938]],
  [[3231, 3951], [3232, 10351], [3232, 10352], [3233, 3950]],
  [[3241, 3949], [3243, 10351], [3243, 10352], [3242, 3948]],
]);

const GUARDIANS_AT = 99;
const GUARDIANS = 2;
const HEAL = 8;
const HEAL_EVERY_TICKS = 3;
const HEAL_RANGE = 3;
const IDLE_TICKS = 25;
const PRAYER_DRAIN = 2;
const CURSE = Object.freeze({ projectile: 109, start: 30, end: 60, startHeight: 40, endHeight: 36 }); // curse_travel

let core = null;
let PrayerHandler = null;
/** Scorpia npc -> { armed, called, guardians: [{ npc, lastHeal }] } */
const fights = new WeakMap();
/** Guardian npc -> the Scorpia it was called to. */
const guardianOwners = new WeakMap();
/** Set on Scorpia once one of her guardians is killed (Wiki task "Guardians No More"). */
const GUARDIAN_KILLED_ATTRIBUTE = "scorpia:guardian-killed";

function fightOf(npc) {
  let fight = fights.get(npc);
  if (!fight) {
    fight = { armed: false, called: false, guardians: [] };
    fights.set(npc, fight);
    // A respawned Scorpia starts a new fight: an earlier fight's guardian kill does not count.
    npc.setAttribute?.(GUARDIAN_KILLED_ATTRIBUTE, false);
  }
  return fight;
}

function tileOf(event) {
  return [event.location.x, event.location.y];
}

function crawl(player, to) {
  player.getMovementQueue().reset();
  player.performAnimation(new core.Animation(LONG_CRAWL));
  Common.later(1, () => player.isRegistered() && player.moveTo(new core.Location(to[0], to[1], 0)), player);
}

function enterCave(event) {
  if (event.objectId !== CAVERN) return false;
  const [x, y] = tileOf(event);
  const way = WAYS.find(([cavern]) => cavern[0] === x && cavern[1] === y);
  if (!way) return false;
  crawl(event.player, way[1]);
  return true;
}

function leaveCave(event) {
  if (event.objectId !== CREVICE) return false;
  const [x, y] = tileOf(event);
  const way = WAYS.find(([, , crevice]) => crevice[0] === x && crevice[1] === y);
  if (!way) return false;
  crawl(event.player, way[3]);
  return true;
}

/** Edge distance from her 5x5 body to a tile. */
function reach(scorpia, location) {
  const base = scorpia.getLocation();
  const size = scorpia.getSize();
  const x = location.getX();
  const y = location.getY();
  const dx = x < base.getX() ? base.getX() - x : x >= base.getX() + size ? x - (base.getX() + size - 1) : 0;
  const dy = y < base.getY() ? base.getY() - y : y >= base.getY() + size ? y - (base.getY() + size - 1) : 0;
  return Math.max(dx, dy);
}

function callGuardians(scorpia, fight) {
  fight.called = true;
  const base = scorpia.getLocation();
  const spots = [[-1, 2], [scorpia.getSize(), 2], [2, -1], [2, scorpia.getSize()]];
  for (const [dx, dy] of spots.slice(0, GUARDIANS)) {
    const guardian = core.NPC.create(GUARDIAN, new core.Location(base.getX() + dx, base.getY() + dy, base.getZ()));
    guardian.__skipDefaultRespawn = true;
    core.World.getAddNPCQueue().push(guardian);
    fight.guardians.push({ npc: guardian, lastHeal: core.World.getProcessCycle() });
    guardianOwners.set(guardian, scorpia);
  }
  watch(scorpia, fight);
}

/** One task while guardians live: heals in reach, despawns the idle ones. */
function watch(scorpia, fight) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(HEAL_EVERY_TICKS, null, false);
    }

    execute() {
      const now = core.World.getProcessCycle();
      fight.guardians = fight.guardians.filter(({ npc }) => Common.alive(npc) || core.World.getAddNPCQueue().includes(npc));
      if (!Common.alive(scorpia) || fight.guardians.length === 0) {
        for (const { npc } of fight.guardians) core.World.getRemoveNPCQueue().push(npc);
        fight.guardians = [];
        this.stop();
        return;
      }
      for (const guardian of fight.guardians) {
        const npc = guardian.npc;
        if (!npc.isRegistered()) continue;
        if (reach(scorpia, npc.getLocation()) <= HEAL_RANGE) {
          guardian.lastHeal = now;
          if (scorpia.getHitpoints() < scorpia.getMaxHitpoints()) {
            new core.Projectile(npc.getLocation(), scorpia.getLocation(), scorpia, CURSE.projectile, CURSE.start, CURSE.end,
              CURSE.startHeight, CURSE.endHeight, null).withSource(npc).sendProjectile();
            scorpia.setHitpoints(Math.min(scorpia.getMaxHitpoints(), scorpia.getHitpoints() + HEAL));
          }
        } else if (now - guardian.lastHeal >= IDLE_TICKS) {
          core.World.getRemoveNPCQueue().push(npc);
        }
      }
    }
  })());
}

/** The first attack on her at 99 or less calls her guardians, whether it hits or not. */
function hitModify({ npc, hit }) {
  if (npc?.getId?.() !== SCORPIA) return;
  const fight = fightOf(npc);
  if (fight.called) return;
  if (fight.armed) {
    callGuardians(npc, fight);
    return;
  }
  const incoming = (hit.getHits?.() ?? []).reduce((sum, part) => sum + (part.getDamage?.() ?? 0), 0);
  if (npc.getHitpoints() - incoming <= GUARDIANS_AT) fight.armed = true;
}

/** Wiki: her blows drain 2 Prayer through Protect from Melee, hit or miss. */
function hitResolved({ attacker, target }) {
  if (attacker?.getId?.() !== SCORPIA || !target?.isPlayer?.()) return;
  if (!PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MELEE)) return;
  const skills = target.getSkillManager();
  skills.setCurrentLevel(core.Skill.PRAYER, Math.max(0, skills.getCurrentLevel(core.Skill.PRAYER) - PRAYER_DRAIN), true);
}

function died({ npc, preventDeath }) {
  if (preventDeath) return;
  if (npc?.getId?.() === GUARDIAN) {
    guardianOwners.get(npc)?.setAttribute?.(GUARDIAN_KILLED_ATTRIBUTE, true);
    return;
  }
  if (npc?.getId?.() !== SCORPIA) return;
  const fight = fights.get(npc);
  fights.delete(npc);
  for (const { npc: guardian } of fight?.guardians ?? []) {
    if (guardian.isRegistered()) core.World.getRemoveNPCQueue().push(guardian);
  }
}

function attach(pluginApi) {
  core = pluginApi.core;
  PrayerHandler = pluginApi.getPrayerHandler();
  pluginApi.onObjectInteraction("Cavern", { Enter: enterCave });
  pluginApi.onObjectInteraction("Crevice", { Use: leaveCave });
  pluginApi.onNpcHitModify(hitModify);
  pluginApi.onCombatHitResolved(hitResolved);
  pluginApi.onNpcBeforeDeath(died);
}

module.exports = { attach, GUARDIAN_KILLED_ATTRIBUTE, _test: { WAYS, reach, callGuardians, fightOf, died } };
