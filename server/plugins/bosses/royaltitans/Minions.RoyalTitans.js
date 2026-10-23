/**
 * The fire and ice elementals: trios summoned onto adjacent tiles, walking to the player,
 * attacking about every 4 ticks (max 4, Wiki), and detonating ~18 ticks after spawning when
 * unkilled (captured 840 -> explode 858 -> dels 860-864). Player-killed elementals play
 * death01 + the death spotanim instead, all three on one tick when AoE'd.
 *
 * Wiki accuracy: a player's spell hits with (magic accuracy bonus + 30)%, min 30%; the void
 * mage set effect x1.45; Wind Strike always hits. A failed roll leaves the engine's own roll
 * to decide (there is no forced miss). Row tiles clear to any opposite-element spell;
 * anything else (or the wrong element) shows the hint message and does nothing.
 */
const Shared = require("./Shared.RoyalTitans");
const CombatAchievements = require("./CombatAchievements.RoyalTitans");

const VOID_MAGE_SET_MULTIPLIER = 1.45;
/** A cast spell is remembered this long, for the hit that lands after the selection cleared. */
const RECENT_CAST_TICKS = 6;
const WALKABLE_MASK = 0x1280100;

let core = null;
let attackMagicIndex = 0;
let voidMageHelms = new Set();
/** spellId -> CombatSpells name, so a cast resolves to its element and tier by name. */
const spellNames = new Map();
/** player -> { spell, tick } of their last spell roll. */
const recentCasts = new WeakMap();
/** Row hits that already showed the hint (hit modify can run more than once per hit). */
const hintedHits = new WeakSet();

const { alive, tileOf, later, sessionOfNpc } = Shared;

/** Walkable in the fight's own instance (its collision, not the main world's). */
function isWalkable(session, x, y) {
  return (core.RegionManager.getClipping(x, y, 0, session.area) & WALKABLE_MASK) === 0;
}

/** Three elementals on walkable tiles near the caster (falling back around blocked
 * ones, so a trio never spawns half-buried), with spawn anims and a shared fuse group. */
function spawnTrio(session, minionId, tiles) {
  if (session.area.isDestroyed()) return;
  const kind = Shared.minionKind(minionId);
  const anims = Shared.MINION_ANIMATIONS[kind];
  const group = core.World.getProcessCycle();
  const spots = [];
  const seen = new Set();
  const take = (x, y) => {
    const key = Shared.tileKey(x, y);
    if (seen.has(key)) return false;
    seen.add(key);
    if (!isWalkable(session, x, y)) return false;
    spots.push([x, y]);
    return true;
  };
  for (const [x, y] of tiles) {
    if (spots.length >= 3) break;
    if (take(x, y)) continue;
    for (let radius = 1; radius <= 4 && spots.length < 3; radius++) {
      for (let dx = -radius; dx <= radius && spots.length < 3; dx++) {
        for (let dy = -radius; dy <= radius && spots.length < 3; dy++) {
          if (take(x + dx, y + dy)) break;
        }
      }
    }
  }
  while (spots.length < 3 && tiles.length > 0) spots.push(tiles[spots.length % tiles.length]);
  spots.forEach(([x, y], index) => {
    const minion = core.NPC.create(minionId, new core.Location(x, y, 0));
    minion.__skipDefaultRespawn = true;
    minion.setHitpoints(Shared.MINION_HITPOINTS);
    minion.getMovementCoordinator().setRadius(20);
    minion.setFlag("combat:close-in");
    minion.setMultiCombat(true);
    minion.setAttribute(Shared.ENCOUNTER_ATTRIBUTE, session);
    minion.setAttribute(Shared.MINION_ATTRIBUTE, { kind, group, index });
    minion.setAttribute(Shared.FUSE_AT_ATTRIBUTE, core.World.getProcessCycle() + Shared.MINION_FUSE_TICKS);
    minion.performAnimation(new core.Animation(anims.spawn));
    minion.performGraphic(new core.Graphic(Shared.MINION_SPAWN_GFX[kind]));
    require("./Specials.RoyalTitans").areaSounds(Shared.SOUND.minionSpawn[kind], x, y, Shared.MINION_SOUND_RANGE);
    session.area.add(minion);
    core.World.getAddNPCQueue().push(minion);
    session.minions.add(minion);
    // Pin to a player at once: engine aggression would otherwise pick the nearest
    // attackable, which can be a titan standing closer than the player.
    const target = Shared.nearestPlayer(session, { x, y });
    if (target) minion.getCombat().attack(target);
  });
}

function combatClass() {
  const { CombatMethod, CombatType } = core;

  return class ElementalCombat extends CombatMethod {
    start(character, target) {
      const npc = character.getAsNpc();
      const kind = Shared.minionKind(npc.getId());
      npc.setPositionToFace(target.getLocation());
      npc.performAnimation(new core.Animation(Shared.MINION_ANIMATIONS[kind].attack));
    }

    hits(character, target) {
      const hit = new core.PendingHit(character, target, this, 0);
      hit.setTotalDamage(Math.min(Shared.MINION_MAX, hit.getTotalDamage()));
      return [hit];
    }

    type() {
      return CombatType.MELEE;
    }

    attackDistance() {
      return 1;
    }

    attackSpeed() {
      return Shared.MINION_SPEED_TICKS;
    }
  };
}

function selectedSpell(player) {
  const combat = player.getCombat();
  return combat.getSelectedSpell() ?? combat.getPreviousCast();
}

/** The spell rolled within the last few ticks, if the cast is still in flight. */
function recentSpell(player) {
  const cast = recentCasts.get(player);
  if (!cast || core.World.getProcessCycle() - cast.tick > RECENT_CAST_TICKS) return null;
  return cast.spell;
}

/** A CombatSpells name, from the name itself or a cast spell's spellId. */
function spellName(spell) {
  if (typeof spell === "string") return spell;
  return spell ? spellNames.get(spell.spellId()) ?? null : null;
}

/** "fire" for fire spells, "water" for water and ice spells, else "other". */
function spellElement(spell) {
  const name = spellName(spell) ?? "";
  if (/^FIRE_/.test(name)) return "fire";
  if (/^(WATER|ICE)_/.test(name)) return "water";
  return "other";
}

function spellTier(spell) {
  const name = spellName(spell) ?? "";
  if (/_SURGE$/.test(name)) return "surge";
  if (/_WAVE$/.test(name)) return "wave";
  if (/_(BLAST|BLITZ)$/.test(name)) return "blast";
  if (/_(BOLT|BURST)$/.test(name)) return "bolt";
  if (/_(STRIKE|RUSH)$/.test(name)) return "strike";
  return "other";
}

/**
 * Whether the player's current spell clears a row of `kind` (Wiki + captured hints):
 * the opposite element and strong enough — blast tier or greater for water and fire
 * (Wiki "Blast or greater"); every ice spell qualifies (Wiki "ice spells are also
 * effective", weakest is Ice Rush at 82).
 */
function clearsRow(player, kind) {
  const spell = selectedSpell(player) ?? recentSpell(player);
  if (kind === "fire") {
    if (spellElement(spell) !== "water") return false;
    if (/^ICE_/.test(spellName(spell) ?? "")) return true;
  } else if (spellElement(spell) !== "fire") return false;
  const tier = spellTier(spell);
  return tier === "surge" || tier === "wave" || tier === "blast";
}

function magicBonus(player) {
  return player.getBonusManager().getAttackBonus()[attackMagicIndex] ?? 0;
}

function wearingVoidMage(player) {
  const helm = player.getEquipment().get(core.Equipment.HEAD_SLOT);
  return voidMageHelms.has(helm?.getId());
}

/**
 * Elemental spell accuracy (Wiki): (magic accuracy bonus + 30)%, min 30%, void mage x1.45,
 * Wind Strike always hits; opposite-element hits land their max (one Wave kills). Row tiles
 * have no real defences (cache level -1), so the right element always lands on them.
 * Also remembers the cast: by the time a hit lands the selected spell is already cleared.
 */
function elementalAccuracy(roll) {
  const { attacker, target } = roll;
  if (!attacker.isPlayer() || !target.isNpc()) return;
  // Every player's roll on every NPC comes through here: leave anything not a row or elemental first.
  const targetId = target.getId();
  if (!Shared.isRowHitbox(targetId) && !Shared.isMinion(targetId)) return;
  const spell = selectedSpell(attacker);
  if (!spell) return;
  recentCasts.set(attacker, { spell, tick: core.World.getProcessCycle() });
  if (Shared.isRowHitbox(targetId)) {
    const need = targetId === Shared.FIRE_ROW_ID ? "water" : "fire";
    if (spellElement(spell) === need) roll.forceAccurate = true;
    return;
  }
  if (spellName(spell) === "WIND_STRIKE") {
    roll.forceAccurate = true;
    return;
  }
  let chance = magicBonus(attacker) + Shared.ELEMENTAL_HIT_BONUS;
  if (wearingVoidMage(attacker)) chance *= VOID_MAGE_SET_MULTIPLIER;
  chance = Math.max(Shared.ELEMENTAL_HIT_MIN, Math.min(100, chance));
  if (Math.random() * 100 >= chance) return;
  roll.forceAccurate = true;
  const weakTo = Shared.minionKind(targetId) === "fire" ? "water" : "fire";
  if (spellElement(spell) === weakTo) roll.forceMaxHit = true;
}

/** The titan or elemental a player's spell is aimed at, and the element it is weak to. */
function weakTarget(entity) {
  if (!entity.isPlayer()) return null;
  const target = entity.getCombat().getTarget();
  if (!target?.isNpc()) return null;
  const id = target.getId();
  if (id === Shared.BRANDA_ID || id === Shared.FIRE_MINION_ID) return { id, weakTo: "water" };
  if (id === Shared.ELDRIC_ID || id === Shared.ICE_MINION_ID) return { id, weakTo: "fire" };
  return null;
}

/**
 * Elemental weakness damage (Wiki): opposite-element spells deal double to elementals
 * (100%) and +50% to titans (50%), rounded down like demonbane.
 */
function weaknessDamage(entity, baseHit) {
  const weak = weakTarget(entity);
  const spell = weak ? selectedSpell(entity) : null;
  if (!spell || spellElement(spell) !== weak.weakTo) return baseHit;
  if (Shared.isMinion(weak.id)) return baseHit * 2;
  return baseHit + Math.floor(baseHit / 2);
}

/** Elemental weakness accuracy: opposite-element spells roll +50% against the titans. */
function weaknessAccuracy(entity, roll) {
  const weak = weakTarget(entity);
  if (!weak || !Shared.isLiveTitan(weak.id)) return roll;
  const spell = selectedSpell(entity);
  if (!spell || spellElement(spell) !== weak.weakTo) return roll;
  return roll + Math.floor(roll / 2);
}

/** The element of the spell the player has in hand (or just cast), else "other". */
function spellElementOf(player) {
  return spellElement(selectedSpell(player) ?? recentSpell(player));
}

/** Row tiles clear to strong-enough opposite-element spells; anything else hints and does nothing. */
function rowClearingHit({ npc, hit }) {
  if (!Shared.isRowHitbox(npc.getId())) return;
  const attacker = hit.getAttacker();
  if (!attacker?.isPlayer()) return;
  const session = sessionOfNpc(npc);
  const kind = npc.getId() === Shared.FIRE_ROW_ID ? "fire" : "ice";
  const opposite = clearsRow(attacker, kind);
  for (const part of hit.getHits()) part.setDamage(opposite ? 1 : 0);
  hit.updateTotalDamage();
  if (!opposite) {
    if (hintedHits.has(hit)) return;
    hintedHits.add(hit);
    attacker.sendMessage(kind === "fire" ? Shared.FIRE_HINT : Shared.ICE_HINT);
    return;
  }
  if (session?.rows.has(npc)) {
    require("./Specials.RoyalTitans").clearRowTile(session, npc, true);
  }
}

/** Player-killed elementals burst into their death graphic; expiry is silent. */
function minionDied({ npc }) {
  if (!Shared.isMinion(npc.getId())) return;
  sessionOfNpc(npc)?.minions.delete(npc);
  npc.performGraphic(new core.Graphic(Shared.MINION_DEATH_GFX[Shared.minionKind(npc.getId())]));
}

/** Any resolved player -> elemental hit counts as attacking one (Elemental Company). */
function hitResolved({ attacker, target }) {
  if (!attacker?.isPlayer() || !target?.isNpc() || !Shared.isMinion(target.getId())) return;
  if (sessionOfNpc(target)) CombatAchievements.minionAttacked(attacker.getAsPlayer());
}

/**
 * The fuse: the first minion of a trio to expire plays the explode anim + spot graphic and
 * deals small area damage; its trio-mates despawn silently over the next ticks (captured).
 */
function explodeTrio(session, minion) {
  const { group } = minion.getAttribute(Shared.MINION_ATTRIBUTE);
  const kind = Shared.minionKind(minion.getId());
  const at = tileOf(minion);
  minion.performAnimation(new core.Animation(Shared.MINION_ANIMATIONS[kind].explode));
  require("./Specials.RoyalTitans").areaSounds(Shared.SOUND.minionExplode, at.x, at.y, Shared.EXPLODE_SOUND_RANGE);
  session.players[0]?.getPacketSender().sendGlobalGraphic(
    new core.Graphic(Shared.MINION_EXPLODE_GFX[kind]), new core.Location(at.x, at.y, 0));
  for (const player of session.players) {
    if (!alive(player)) continue;
    const pos = tileOf(player);
    if (Math.max(Math.abs(pos.x - at.x), Math.abs(pos.y - at.y)) > 1) continue;
    const damage = core.Misc.getRandom(Shared.EXPLODE_MAX);
    if (damage <= 0) continue;
    player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
    CombatAchievements.avoidableDamage(player, damage, "explode");
  }
  session.minions.delete(minion);
  if (minion.isRegistered()) core.World.getRemoveNPCQueue().push(minion);
  let delay = 1;
  for (const sibling of [...session.minions]) {
    if (sibling.getAttribute(Shared.MINION_ATTRIBUTE)?.group !== group) continue;
    session.minions.delete(sibling);
    later(delay, () => {
      if (sibling.isRegistered()) core.World.getRemoveNPCQueue().push(sibling);
    });
    delay += 1;
  }
}

/** Elementals attack the party, never the other titan (Wiki), and blow up on their fuse. */
function tickSession(session) {
  const now = core.World.getProcessCycle();
  for (const minion of [...session.minions]) {
    if (!alive(minion)) {
      session.minions.delete(minion);
      continue;
    }
    const target = minion.getCombat().getTarget();
    if (!target?.isPlayer() || !session.players.includes(target.getAsPlayer())) {
      const best = Shared.nearestPlayer(session, tileOf(minion));
      if (best) minion.getCombat().attack(best);
    }
    if (now >= minion.getAttribute(Shared.FUSE_AT_ATTRIBUTE)) explodeTrio(session, minion);
  }
}

function attach(api) {
  core = api.core;
  const { ItemIdentifiers, CombatSpells } = core;
  attackMagicIndex = api.getBonusManager().ATTACK_MAGIC;
  voidMageHelms = new Set([ItemIdentifiers.VOID_MAGE_HELM, ItemIdentifiers.VOID_MAGE_HELM_OR_]);
  for (const [name, spell] of Object.entries(CombatSpells)) {
    if (typeof spell?.spellId === "function") spellNames.set(spell.spellId(), name);
  }
  api.onCombatHitRoll(elementalAccuracy);
  api.onNpcHitModify(rowClearingHit);
  api.onNpcDeath(minionDied);
  api.onCombatHitResolved(hitResolved);
  api.registerMagicHitModifier(weaknessDamage);
  api.registerMagicAttackAccuracyModifier(weaknessAccuracy);
  api.registerNpcCombatMethodProvider(
    [core.NpcIdentifiers.FIRE_ELEMENTAL_2, core.NpcIdentifiers.ICE_ELEMENTAL],
    combatClass(),
    { singleton: false },
  );
}

module.exports = {
  attach, spawnTrio, tickSession, explodeTrio, spellElementOf, clearsRow,
  _test: { spellTier, spellElement, elementalAccuracy, rowClearingHit, clearsRow, weaknessDamage, weaknessAccuracy },
};
