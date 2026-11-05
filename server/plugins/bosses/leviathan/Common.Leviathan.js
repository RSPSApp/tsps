const fs = require("fs");
const path = require("path");
const INSIDE_ATTRIBUTE = "leviathan:inside";
const KILLS_ATTRIBUTE = "leviathan:kills";
const AWAKENED_KILLS_ATTRIBUTE = "leviathan:awakened-kills";
const BEST_ATTRIBUTE = "leviathan:best-ticks";
const DEATHS_ATTRIBUTE = 'leviathan:deaths';
const AWAKENED_BEST_ATTRIBUTE = "leviathan:awakened-best-ticks";
const MONSTER = "Leviathan, The";
let api, core, data, ids;

function init(pluginApi) {
  api = pluginApi;
  core = api.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "leviathan.json"), "utf8"));
  const C = core.CacheDefinitions;
  const lookup = { npcs: name => C.getNpcId(name), locs: name => C.getLocId(name), seqs: name => C.getSeqId(name),
    gfx: name => C.getSpotanimId(name), varps: name => C.getVarpId(name), interfaces: name => C.getInterfaceId(name) };
  ids = {};
  for (const [group, values] of Object.entries(data.cache)) {
    ids[group] = {};
    for (const [key, name] of Object.entries(values)) {
      const id = lookup[group](name);
      if (!Number.isInteger(id) || id < 0) throw new Error(`Leviathan: missing ${group} ${name}`);
      ids[group][key] = id;
    }
  }
  ids.awakenerOrb = C.getObjId("dt2_awakener_orb");
  // The gameval spelling is cache-authoritative; the identifier fallback is also cache-derived.
  if (!Number.isInteger(ids.awakenerOrb)) ids.awakenerOrb = core.ItemIdentifiers.AWAKENERS_ORB;
}
const random = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = list => list[random(0, list.length - 1)];
const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));
function normalKills(player) {
  const request = { player, monster: MONSTER, total: 0 };
  api.emitCustomEvent('combat-achievements:count', request);
  return Math.max(count(player, KILLS_ATTRIBUTE), Math.max(0, Math.trunc(Number(request.total) || 0)));
}
const location = ([x, y, z = 0]) => new core.Location(x, y, z);
function tile(area, [x, y, z = 0]) {
  return area.tile(x - data.instance.sourceChunkX * 8, y - data.instance.sourceChunkY * 8, z);
}
function sourceTile(area, at) {
  return [at.getX() - area.getBaseX() + data.instance.sourceChunkX * 8,
    at.getY() - area.getBaseY() + data.instance.sourceChunkY * 8, at.getZ()];
}
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(Math.max(1, ticks), null, false); }
    execute() { this.stop(); action(); }
  })());
}
const animate = (npc, name) => npc.performAnimation(new core.Animation(ids.seqs[name]));
function graphic(name, delay = 0) {
  const result = new core.Graphic(ids.gfx[name]);
  // Graphic's overloaded second argument treats 50 as a height enum.
  result.delay = delay;
  return result;
}
function tileGraphic(player, area, at, name, delay = 0) { player.getPacketSender().sendGraphic(graphic(name, delay), tile(area, at)); }
function damage(fight, amount, avoidable = true) {
  if (fight.stopped || fight.over || fight.session.ended || fight.session.fight !== fight || fight.player.getHitpoints() <= 0) return;
  const hit = new core.HitDamage(Math.max(0, Math.floor(amount)), core.HitMask.RED);
  trackDamage(fight, hit, avoidable);
  fight.player.getCombat().getHitQueue().addPendingDamage([hit]);
}
function trackDamage(fight, hit, avoidable = true) {
  hit.setSource(fight.boss);
  fight.pendingDamage.add(hit);
  hit.onApplied(taken => {
    fight.pendingDamage.delete(hit);
    if (taken > 0 && avoidable && !fight.stopped && !fight.over && !fight.session.ended && fight.session.fight === fight) fight.perfect = false;
  });
}
function biteDamage(fight, amount) {
  if (!fight.alive()) return;
  const { CombatMethod, CombatType, PendingHit, CombatFactory } = core;
  const method = new (class extends CombatMethod { type() { return CombatType.MELEE; } hits() { return []; } })();
  // Only the physical bite enters ordinary combat resolution: its recoil and
  // Vengeance are part of the documented normal speed-running strategy.
  const hit = new PendingHit(fight.boss, fight.player, method,
    { delay: 0, damage: amount, rollAccuracy: false, experience: false, handleAfterHitEffects: false });
  for (const part of hit.getHits()) trackDamage(fight, part);
  // Area processing follows the player's HP pass. Resolve through the next
  // actual player queue pass, so HP/perfect grading precedes a lethal reflected
  // hit on the following NPC turn. Immediate executeHit reflects too early.
  CombatFactory.addPendingHit(hit);
}
function protectedFrom(player, style) {
  const prayer = { magic: "PROTECT_FROM_MAGIC", ranged: "PROTECT_FROM_MISSILES", melee: "PROTECT_FROM_MELEE" }[style];
  return core.PrayerHandler.isActivated(player, core.PrayerHandler[prayer]);
}
function mouthFor([px, py]) {
  const [cx, cy] = data.arena.centre;
  // Original NPC packets select a mouth on the side(s) outside the 7x7 body,
  // rather than starting every orb at the NPC's ground-level centre.
  return [cx + (Math.abs(px - cx) > 3 ? Math.sign(px - cx) * 2 : 0),
    cy + (Math.abs(py - cy) > 3 ? Math.sign(py - cy) * 2 : 0)];
}
function projectile(fight, style, flight, startup = true) {
  const { Projectile } = core;
  const mouth = mouthFor(fight.hazards.playerTile());
  fight.boss.performGraphic(graphic(`${style}Launch${startup ? 'Start' : ''}`));
  // Recorded launch 30, landing on the impact tick. A one-tick flight can't land at 30 after a
  // 30-cycle launch (the client drew it on the mouth), so it launches at once instead (#1862).
  const launch = flight > 1 ? 30 : 0;
  new Projectile(fight.session.tile(mouth), Projectile.centreOf(fight.player), fight.player,
    ids.gfx[style], launch, flight * 30, 137.5, 25, fight.session.area).withAngle(30).withProgress(124).sendProjectile();
}
function tileProjectile(fight, target, flight, name) {
  // Ordinary footage distinguishes traveling rocks and cyan side orbs from
  // their landing effects. Their source-specific height/slope/progress fields
  // remain unmeasured; reuse recorded ordinary-orb geometry as a bounded arc.
  new core.Projectile(fight.session.tile(mouthFor(target)), fight.session.tile(target), null,
    ids.gfx[name], 0, flight * 30, 137.5, 0, fight.session.area).withAngle(30).withProgress(124).sendProjectile();
}
function shadowSpell(spell) {
  return ["SHADOW_RUSH", "SHADOW_BURST", "SHADOW_BLITZ", "SHADOW_BARRAGE"].some(name =>
    core.CombatSpells[name].getSpell().spellId() === spell?.spellId?.());
}
module.exports = { init, random, pick, count, normalKills, MONSTER, location, tile, sourceTile, later, animate, graphic, tileGraphic, damage, biteDamage, protectedFrom, projectile, tileProjectile,
  shadowSpell,
  INSIDE_ATTRIBUTE, KILLS_ATTRIBUTE, AWAKENED_KILLS_ATTRIBUTE, BEST_ATTRIBUTE, AWAKENED_BEST_ATTRIBUTE, DEATHS_ATTRIBUTE,
  get api() { return api; }, get core() { return core; }, get data() { return data; }, get ids() { return ids; } };
