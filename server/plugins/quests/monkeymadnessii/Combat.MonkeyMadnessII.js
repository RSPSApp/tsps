// Wiki: normal stats/max 61, six-tick attacks, final magic reach 11; the
// quest guide separately describes a melee knockback reaching 66. The special
// ceiling follows that specific account, not a claim that every style hits 66.
// Exact style probabilities, phase-2 reach and partial-prayer percentage are
// not packet-qualified: use equal adjacent-style choices, canonical ranged
// reach, and the guide's approximate halving. Keep these limits in the docs.
const ATTACK_SPEED = 6;
const FINAL_MAGIC_REACH = 11;
const KNOCKBACK_MAXIMUM = 66;
const PARTIAL_PROTECTION = 0.5;
// Inferred policy: the phase guide's protected ranged ceiling 21 divided by
// the explicitly approximate half-damage model. It does not state raw max 42.
const SECOND_PHASE_RANGED_MAXIMUM = 42;
// Actual cache assets. Their assignment here is presentation, not a recorded
// Glough animation-policy claim.
const GIANT_ATTACK_ANIMATION = 4652;
const PULL_ANIMATION = 7208;
const BLOCKED_TILE = 0x200100;

function attach(api, { lifecycle, contains, sceneFor }) {
  const { Animation, CombatMethod, CombatType, Location, MeleeCombatMethod,
    RangedCombatMethod, PendingHit, PrayerHandler, RegionManager } = api.core;
  const attacks = new WeakMap();
  const damagedSincePull = new WeakSet();
  const ranged = new RangedCombatMethod();

  function distance(boss, player) {
    const b = boss.getLocation(), p = player.getLocation(), size = boss.getSize();
    return Math.max(0, b.getX() - p.getX(), p.getX() - (b.getX() + size - 1),
      b.getY() - p.getY(), p.getY() - (b.getY() + size - 1));
  }

  function live(state, target) {
    return !!state && state.active && lifecycle.forBoss(state.boss) === state
      && target === state.player && target.isRegistered() && target.getHitpoints() > 0
      && contains(state) && !state.deferredLethal && !state.finalDeath;
  }

  function openTile(scene, tile) {
    return scene.contains(tile) && tile.getZ() === 0 && (scene.getClip(tile) & BLOCKED_TILE) === 0;
  }

  function pull(state) {
    const scene = sceneFor(state.player), boss = state.boss;
    const b = boss.getLocation(), p = state.player.getLocation(), size = boss.getSize(), tiles = [];
    for (let offset = 0; offset < size; offset++) {
      tiles.push(new Location(b.getX() + offset, b.getY() - 1, 0),
        new Location(b.getX() + offset, b.getY() + size, 0),
        new Location(b.getX() - 1, b.getY() + offset, 0),
        new Location(b.getX() + size, b.getY() + offset, 0));
    }
    tiles.sort((a, b) => a.getDistance(p) - b.getDistance(p));
    const destination = tiles.find(tile => openTile(scene, tile)
      && RegionManager.canMovestart(p, tile, 1, 1, scene));
    if (!destination) return;
    state.player.getMovementQueue().reset();
    state.player.performAnimation(new Animation(PULL_ANIMATION));
    state.player.moveTo(destination);
  }

  function push(state) {
    const scene = sceneFor(state.player), player = state.player, boss = state.boss;
    const b = boss.getLocation(), p = player.getLocation(), size = boss.getSize();
    const dx = p.getX() - (b.getX() + (size - 1) / 2);
    const dy = p.getY() - (b.getY() + (size - 1) / 2);
    const stepX = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
    const stepY = stepX === 0 ? Math.sign(dy) : 0;
    let destination = p;
    // Move out of melee reach, stopping at canonical clipping. The exact retail
    // throw distance/flight timing remains unclaimed; never push through a wall.
    const footprintDistance = tile => Math.max(0, b.getX() - tile.getX(),
      tile.getX() - (b.getX() + size - 1), b.getY() - tile.getY(), tile.getY() - (b.getY() + size - 1));
    while ((stepX || stepY) && footprintDistance(destination) <= 1) {
      const next = destination.transform(stepX, stepY);
      if (!openTile(scene, next) || !RegionManager.canMovestart(destination, next, 1, 1, scene)) break;
      destination = next;
    }
    if (!destination.equals(p)) {
      player.getMovementQueue().reset();
      player.moveTo(destination);
    }
  }

  class GloughCombat extends CombatMethod {
    constructor(npc) {
      super();
      this.state = lifecycle.forBoss(npc);
      this.fallback = this.state ? null : new MeleeCombatMethod();
      this.phase = this.state?.phase ?? 0;
      const adjacent = this.state && distance(npc, this.state.player) <= 1;
      if (!this.state || this.phase === 0) this.style = CombatType.MELEE;
      else if (this.phase === 1) this.style = adjacent && Math.random() < 0.5 ? CombatType.MELEE : CombatType.RANGED;
      else this.style = adjacent && (!damagedSincePull.has(npc) || Math.random() < 0.5)
        ? CombatType.MELEE : CombatType.MAGIC;
    }
    type() { return this.style; }
    attackSpeed(npc) { return this.fallback ? this.fallback.attackSpeed(npc) : ATTACK_SPEED; }
    attackDistance(npc) {
      if (this.fallback) return this.fallback.attackDistance(npc);
      if (this.style === CombatType.MELEE) return 1;
      return this.phase === 2 ? FINAL_MAGIC_REACH : ranged.attackDistance(npc);
    }
    canPursue(npc, target) {
      if (this.fallback) return this.fallback.canPursue(npc, target);
      return live(this.state, target) && this.state.pendingPhase === null
        && (this.phase !== 2 || distance(npc, target) <= FINAL_MAGIC_REACH);
    }
    canAttack(npc, target) {
      if (this.fallback) return this.fallback.canAttack(npc, target);
      return live(this.state, target) && this.state.phase === this.phase && this.state.pendingPhase === null;
    }
    start(npc, target) {
      if (this.fallback) return this.fallback.start(npc, target);
      npc.performAnimation(new Animation(GIANT_ATTACK_ANIMATION));
    }
    hits(npc, target) {
      if (this.fallback) return this.fallback.hits(npc, target);
      if (!this.canAttack(npc, target)) return [];
      const knockback = this.phase === 2 && this.style === CombatType.MELEE;
      const secondRanged = this.phase === 1 && this.style === CombatType.RANGED;
      const hit = new PendingHit(npc, target, this, {
        delay: 0, ordinary: true, bypassProtectionPrayer: this.phase > 0,
        ...(knockback || secondRanged ? { damage: Math.floor(Math.random()
          * ((knockback ? KNOCKBACK_MAXIMUM : SECOND_PHASE_RANGED_MAXIMUM) + 1)) } : {}),
      });
      attacks.set(hit, { state: this.state, phase: this.phase, style: this.style,
        knockback, protectionApplied: false });
      if (this.style === CombatType.MAGIC) damagedSincePull.delete(npc);
      return [hit];
    }
    handleAfterHitEffects(hit) {
      if (this.fallback) return this.fallback.handleAfterHitEffects(hit);
      const attack = attacks.get(hit);
      if (!attack || !live(attack.state, hit.getTarget()) || attack.phase !== 2) return;
      if (attack.style === CombatType.MAGIC) pull(attack.state);
      else if (attack.knockback) push(attack.state);
    }
  }

  function incoming({ player, hit }) {
    const attack = attacks.get(hit);
    if (!attack) return;
    if (!live(attack.state, player)) {
      hit.setTotalDamage(0);
      return;
    }
    if (attack.phase > 0 && !attack.protectionApplied) {
      attack.protectionApplied = true;
      if (PrayerHandler.isActivated(player, PrayerHandler.getProtectingPrayer(attack.style))) {
        hit.setTotalDamage(Math.floor(hit.getTotalDamage() * PARTIAL_PROTECTION));
      }
    }
  }

  function damageApplied({ target, hit }) {
    const state = lifecycle.forBoss(target);
    if (state && state.active && contains(state) && hit.getHealthLost() > 0) damagedSincePull.add(target);
  }

  api.registerNpcCombatMethodProvider(api.core.NpcIdentifiers.GLOUGH_4, GloughCombat, { singleton: false });
  api.onPlayerHitModify(incoming);
  api.onCustomEvent("combat:damage-applied", damageApplied);
}

module.exports = { attach };
