/**
 * Nature's recurve (https://oldschool.runescape.wiki/w/Nature%27s_recurve), a Leagues VI (Demonic
 * Pacts) echo item from Echo Hespori, its passive a Leagues VI character's only: a two-handed
 * shortbow that fires every arrow up to dragon (RangedData NATURES_RECURVE; the item's own text
 * says "Can shoot all arrows", the Wiki "up to dragon arrows": the same list). Its speeds and range
 * are the cache's (4 ticks, 7 tiles).
 *
 * Passive (item text): "Upon a successful hit, there is a 50% chance that your Hitpoints and prayer
 * points are restored by 10% of the damage dealt, rounded up." Wiki: it "cannot heal players above
 * 99 hitpoints" (Demonic Pacts' overhealing does not raise that), and Demonic Pacts' ranged echoes
 * do not trigger it (asked of the pacts with `league:pact-echo-hit`).
 *
 * Ours: the restore happens when the hit lands, as its hitsplat does; Hitpoints and Prayer go up
 * to their base levels (Hitpoints 99 at most) and a level already above them is left alone. The
 * cache's vfx_natures_recurve_spotanim_01 plays on the player when it restores.
 */
const HEAL_CHANCE = 0.5;
const HEAL_FRACTION = 0.1;
const HITPOINTS_CAP = 99;
const HEAL_GRAPHIC = "vfx_natures_recurve_spotanim_01";

let core;
let pluginApi;

/** Leagues VI (Demonic Pacts) item: its effects are a Leagues VI character's only (LeagueMode's `league:profile`). */
const LEAGUE_VI = 6;
function inLeagueSix(player) {
  const query = { player, league: null };
  pluginApi.emitCustomEvent("league:profile", query);
  return Number(query.league) === LEAGUE_VI;
}

function wieldsRecurve(player) {
  const weapon = player.getEquipment?.().get?.(core.Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === core.ItemIdentifiers.NATURES_RECURVE && inLeagueSix(player);
}

function isPactEcho(hit) {
  const query = { hit, echo: false };
  pluginApi.emitCustomEvent("league:pact-echo-hit", query);
  return query.echo === true;
}

/** Up to `cap`; a level already at or above it (an overheal, a boost) is not lowered. */
function restore(player, skill, amount, cap) {
  const skills = player.getSkillManager();
  if (amount <= 0 || skills.getCurrentLevel(skill) >= cap) return;
  skills.increaseCurrentLevel(skill, amount, cap);
}

/** A landed recurve hit: half the time, Hitpoints and Prayer back by 10% of its damage, rounded up. */
function hitLanded({ attacker, hit }) {
  if (!attacker?.isPlayer?.() || !hit || hit.getCombatType?.() !== core.CombatType.RANGED) return;
  const player = attacker.getAsPlayer();
  const damage = hit.getTotalDamage?.() ?? 0;
  if (!hit.isAccurate?.() || damage <= 0 || !wieldsRecurve(player) || isPactEcho(hit)) return;
  if (Math.random() >= HEAL_CHANCE) return;
  const amount = Math.ceil(damage * HEAL_FRACTION);
  const skills = player.getSkillManager();
  restore(player, core.Skill.HITPOINTS, amount, Math.min(HITPOINTS_CAP, skills.getMaxLevel(core.Skill.HITPOINTS)));
  restore(player, core.Skill.PRAYER, amount, skills.getMaxLevel(core.Skill.PRAYER));
  const graphic = core.CacheDefinitions.getSpotanimId(HEAL_GRAPHIC);
  if (graphic !== null) player.performGraphic(new core.Graphic(graphic));
}

function initialize(api) {
  core = api.core;
  pluginApi = api;
}

module.exports = {
  name: "NaturesRecurve",
  members: true,
  register(api) {
    initialize(api);
    api.onCombatHitResolved(hitLanded);
  },
  _test: { hitLanded },
};
