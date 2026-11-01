/**
 * Yama's attacks in phases 1 and 2 (Wiki: Yama/Strategies, with the captured animations, spot
 * animations, projectiles and hit timings):
 * - The rotation: one standard attack in the phase's opening element, then a special of the other
 *   element, after which his standard attacks take that element; then three standard attacks and
 *   a special, over and over, each special the other element from the last. Void flares stand in
 *   for one shadow special a phase (the 2nd or 3rd shadow one if the phase opened with a shadow
 *   special, the 1st or 2nd if with fire) and change nothing.
 * - A standard attack is a swing if the player is next to him, else magic (fire) or ranged
 *   (shadow): 46 at most; Protect from Melee lets 6 through, the others block it all.
 * - Phase 1's specials: the flaming rock (fire) and the shadow spike; phase 2's: Meteor Strike
 *   and Shadow Stomp. Standing on a glyph of the element blocks them.
 * Phase 3 (PhaseThree in Fight.Yama) uses the standard attacks here with its own rules.
 */
const Common = require("./Common.Yama");
const Hits = require("./Hits.Yama");
const Glyphs = require("./Glyphs.Yama");
const Flares = require("./Flares.Yama");

const STYLE_OF = { fire: "magic", shadow: "ranged" };
const OTHER = { fire: "shadow", shadow: "fire" };
const SPECIALS_BEFORE_FLARE_CHOICE = 2;

function animate(npc, id, delay = 0) {
  npc.performAnimation(new Common.core.Animation(id, delay));
}

/** One of Yama's lines for the moment (Wiki transcript; data overheads). */
function say(fight, moment) {
  const lines = Common.data.overheads[moment];
  if (lines?.length && fight.yama) fight.yama.forceChat(lines[Math.floor(Math.random() * lines.length)]);
}

/** Whether the player stands next to Yama (where he swings instead). */
function adjacent(fight) {
  const yama = fight.yama;
  const at = yama.getLocation();
  const p = fight.player.getLocation();
  const size = yama.getSize();
  const dx = p.getX() < at.getX() ? at.getX() - p.getX() : Math.max(0, p.getX() - (at.getX() + size - 1));
  const dy = p.getY() < at.getY() ? at.getY() - p.getY() : Math.max(0, p.getY() - (at.getY() + size - 1));
  return dx + dy === 1 && p.getZ() === at.getZ();
}

// ------------------------------------------------------------------ the rotation

/** A phase's rotation: the opening element, and which shadow special void flares replace. */
function startRotation(fight) {
  const opening = Math.random() < 0.5 ? "fire" : "shadow";
  const firstSpecial = OTHER[opening];
  // The shadow specials' places: shadow first -> specials 1, 3, 5...; fire first -> 2, 4...
  const shadowSlots = firstSpecial === "shadow" ? [1, 3, 5] : [2, 4];
  const choices = firstSpecial === "shadow" ? [shadowSlots[1], shadowSlots[2]] : [shadowSlots[0], shadowSlots[1]];
  fight.rotation = {
    opening, element: opening, lastSpecial: null, specials: 0, sinceSpecial: 0,
    flareSlot: choices[Math.floor(Math.random() * SPECIALS_BEFORE_FLARE_CHOICE)], hazards: 0,
  };
  return firstSpecial;
}

/** When the special after this attack falls, for the hazard before it. */
function nextSpecialIn(fight) {
  const { rotation } = fight;
  if (!rotation) return null;
  const attacksLeft = rotation.specials === 0 ? 1 - rotation.sinceSpecial : 3 - rotation.sinceSpecial;
  return attacksLeft;
}

/** Yama's turn in phases 1 and 2. */
function attack(fight) {
  const { rotation } = fight;
  const dueSpecial = rotation.specials === 0 ? rotation.sinceSpecial >= 1 : rotation.sinceSpecial >= 3;
  if (dueSpecial) {
    special(fight);
    return;
  }
  rotation.sinceSpecial++;
  standard(fight, rotation.element);
}

function special(fight) {
  const { rotation } = fight;
  rotation.specials++;
  rotation.sinceSpecial = 0;
  const element = rotation.lastSpecial ? OTHER[rotation.lastSpecial] : OTHER[rotation.opening];
  if (element === "shadow" && rotation.specials === rotation.flareSlot) {
    summonFlares(fight);
    return;
  }
  rotation.lastSpecial = element;
  rotation.element = element;
  if (fight.phase === 1) {
    if (element === "fire") rockfall(fight);
    else spike(fight);
  } else if (element === "fire") meteor(fight);
  else stomp(fight);
}

// ------------------------------------------------------------------ standard attacks

/** A standard attack: a swing on an adjacent player, else a cast of `element`. */
function standard(fight, element) {
  if (adjacent(fight)) {
    swing(fight);
    return;
  }
  cast(fight, STYLE_OF[element], element);
}

function cast(fight, style, element) {
  const { attacks } = Common.data;
  const spec = attacks[style];
  const { yama, player } = fight;
  const phase = String(fight.phase);
  animate(yama, spec.anim, spec.animDelay);
  yama.performGraphic(Hits.graphic(spec.spot, { delay: spec.spotDelay }));
  player.performGraphicInSlot(spec.impactSlot, Hits.graphic(spec.impact));
  if (Glyphs.immune(fight, element)) {
    fight.at(spec.hitDelay, () => Hits.damage(player, 0));
    return;
  }
  const hit = Hits.strike(yama, player, style, attacks.maxHit, spec.hitDelay, { throughPrayer: attacks.castThroughPrayer[phase] });
  maybePoison(fight, hit, spec.hitDelay);
}

/** The axe swing: the target, and everyone within three tiles of them (solo: the target). */
function swing(fight) {
  const { attacks } = Common.data;
  const { yama, player } = fight;
  animate(yama, attacks.melee.anim);
  const hit = Hits.strike(yama, player, "melee", attacks.maxHit, attacks.melee.hitDelay, {
    throughPrayer: attacks.meleeThroughPrayer[String(fight.phase)],
  });
  maybePoison(fight, hit, attacks.melee.hitDelay);
  return hit;
}

function maybePoison(fight, hit, delay) {
  const { poison } = Common.data.attacks;
  if (Math.random() >= poison.chance) return;
  fight.at(delay + 1, () => {
    if (hit.getTotalDamage() > 0) Hits.poison(fight.player, poison.damage);
  });
}

// ------------------------------------------------------------------ phase 1 specials

/** The flaming rock (fire) and the shadow spike: a rock from above landing 6 ticks later. */
function fallingSpecial(fight, spec, element, onHit) {
  const { yama, player } = fight;
  animate(yama, spec.anim);
  yama.performGraphic(Hits.graphic(spec.spot));
  player.sendMessage(spec.message);
  Hits.projectile(fight, yama, player, spec.projectile);
  if (spec.impact.delay) player.performGraphic(Hits.graphic(spec.impact.id, { delay: spec.impact.delay }));
  Hits.sound(player, spec.sound);
  fight.at(spec.hitDelay, () => {
    if (!spec.impact.delay) player.performGraphic(Hits.graphic(spec.impact.id));
    if (Glyphs.immune(fight, element)) {
      Glyphs.blocked(fight, element);
      return;
    }
    const value = Hits.randomInt(0, spec.maxHit);
    Hits.damage(player, value);
    onHit?.(value);
  });
}

function rockfall(fight) {
  const spec = Common.data.specials.rockfall;
  say(fight, "rockfall");
  fallingSpecial(fight, spec, "fire", (value) => {
    if (value > 0) fight.at(1, () => Hits.burn(fight, spec.burn));
  });
}

function spike(fight) {
  const spec = Common.data.specials.spike;
  say(fight, "stomp");
  fallingSpecial(fight, spec, "shadow", (value) => Hits.drainPrayer(fight.player, value * spec.prayerDrainShare));
}

// ------------------------------------------------------------------ phase 2 specials

/** Meteor Strike: a 5x5 blast on the player's tile 6 ticks on; within a tile of its centre is death. */
function meteor(fight) {
  const spec = Common.data.specials.meteor;
  const { yama, player, session } = fight;
  animate(yama, spec.anim);
  yama.performGraphic(Hits.graphic(spec.spot));
  say(fight, "rockfall");
  const centre = session.worldTile(player.getLocation());
  fight.at(spec.warnTicks, () => {
    player.sendMessage(spec.message);
    const half = (spec.npcSize - 1) >> 1;
    const marker = session.spawn(spec.npc, [centre[0] - half, centre[1] - half, 0], "SOUTH");
    if (marker) {
      marker.setFlag?.("combat:no-retaliate", true);
      animate(marker, spec.npcAnim);
      marker.performGraphic(Hits.graphic(spec.npcSpot));
      fight.at(spec.hitTicks - spec.warnTicks + 1, () => marker.isRegistered() && Common.api.removeNpc(marker));
    }
  });
  fight.at(spec.hitTicks, () => {
    const [px, py] = session.worldTile(player.getLocation());
    const distance = Math.max(Math.abs(px - centre[0]), Math.abs(py - centre[1]));
    Hits.sound(player, { id: spec.sound.id });
    if (Glyphs.immune(fight, "fire")) {
      Glyphs.blocked(fight, "fire");
      return;
    }
    const band = spec.byDistance.find(([tiles]) => distance <= tiles);
    if (!band) return;
    const value = band[1] === "kill" ? player.getHitpoints() : band[1];
    Hits.damage(player, value);
    fight.at(1, () => Hits.burn(fight, spec.burn));
  });
}

/** Shadow Stomp: a shadow along the ground, up to 80, roots for 2 ticks and drains prayer. */
function stomp(fight) {
  const spec = Common.data.specials.stomp;
  const { yama, player } = fight;
  animate(yama, spec.anim);
  yama.performGraphic(Hits.graphic(spec.spot));
  say(fight, "stomp");
  fight.at(spec.warnTicks, () => {
    player.sendMessage(spec.message);
    Hits.projectile(fight, yama, player, spec.projectile);
    Hits.sound(player, spec.sound);
  });
  fight.at(spec.hitTicks, () => {
    player.performGraphic(Hits.graphic(spec.impact.id));
    if (Glyphs.immune(fight, "shadow")) {
      Glyphs.blocked(fight, "shadow");
      return;
    }
    const value = Hits.randomInt(0, spec.maxHit);
    Hits.damage(player, value);
    Hits.root(player, spec.rootTicks);
    Hits.drainPrayer(player, value * spec.prayerDrainShare);
  });
}

// ------------------------------------------------------------------ void flares

function summonFlares(fight) {
  const { flares } = Common.data.specials;
  animate(fight.yama, flares.anim);
  fight.at(flares.spawnTicks, () => Flares.spawn(fight, 2));
}

module.exports = { startRotation, attack, standard, swing, cast, nextSpecialIn, adjacent, summonFlares, animate, say, STYLE_OF, OTHER };
