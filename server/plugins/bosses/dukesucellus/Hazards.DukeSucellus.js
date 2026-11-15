"use strict";
const Common = require('./Common.DukeSucellus');
const Model = require('./Model.DukeSucellus');
function gas(fight, tile, preparation = false) {
  const s = fight.session, t = Common.data.timing, g = Common.data.graphics;
  const spawnDelay = preparation ? 0 : 2;
  const spawn = () => {
    const vent = s.spawnPassive(Common.data.npcs.vent, [tile[0] - 1, tile[1] - 1], 0);
    if (!vent)
      return;
    const warning = preparation ? 4 : 1, end = preparation ? 11 : t.combatGasMinTicks + Common.random(t.combatGasMaxTicks - t.combatGasMinTicks);
    s.passiveExpiry.set(vent, s.tick + end + 4);
    vent.performGraphic(Common.core.Graphic.delayed(g.gasSpawn, warning * 30));
    for (let tick = warning + 2; tick < end; tick += 2)
      fight.at(tick, () => vent.performGraphic(new Common.core.Graphic(g.gasIdle)));
    for (let tick = warning + 1; tick < end; tick++)
      fight.at(tick, () => {
        if (Model.near(Common.source(s, s.player.getLocation()), tile)) {
          Common.hurt(fight, Common.faceCovered(s.player) ? 4 : 12);
          Common.drainPrayer(s.player, 4);
        }
      });
    fight.at(end, () => vent.performGraphic(new Common.core.Graphic(g.gasEnd)));
  };
  if (spawnDelay)
    fight.at(spawnDelay, spawn);
  else
    spawn();
}
function eye(fight, ordinal) {
  const s = fight.session;
  for (const index of [ordinal, ordinal + 3]) {
    const spec = Common.data.extremities[index], west = spec.face === 3, variant = west ? ordinal : [2, 0, 1][ordinal];
    const object = s.place(spec.id, spec.tile, spec.face);
    s.player.getPacketSender().sendObjectAnimation(object, new Common.core.Animation(Common.data.animations.eyeRouse[variant]));
    const cone = s.spawnPassive(Common.data.npcs.cones[variant], [Common.data.preparation.eyeConeX[west ? "west" : "east"], spec.tile[1] - 1], (west ? Common.core.Direction.EAST : Common.core.Direction.WEST).getId());
    if (cone)
      s.passiveExpiry.set(cone, s.tick + 4);
    fight.at(5, () => {
      if (Model.extremityHit(spec, Common.source(s, s.player.getLocation()))) {
        const protectedMagic = Common.protectedFrom(s.player, 'PROTECT_FROM_MAGIC');
        Common.hurt(fight, protectedMagic ? 55 : 70, { min: protectedMagic ? 40 : 50 });
        Common.drainPrayer(s.player, Math.floor(s.player.getSkillManager().getCurrentLevel(Common.core.Skill.PRAYER) / 4));
        fight.freeze(5);
      }
      s.player.getPacketSender().sendObjectAnimation(object, new Common.core.Animation(Common.data.animations.eyeSleep));
    });
  }
}
function ice(fight, tile) {
  const s = fight.session;
  Common.graphic(s, Common.data.graphics.iceWarning, tile);
  fight.at(Common.data.timing.iceWarning, () => {
    Common.graphic(s, Common.data.graphics.iceImpact, tile);
    if (Model.near(Common.source(s, s.player.getLocation()), tile, 0)) {
      Common.hurt(fight, 18);
      fight.freeze(2, true);
    }
  });
}
function preparation(fight) {
  const s = fight.session, tick = s.tick;
  // Independent room clocks, observed repeatedly in normal-variant actors in event captures 1751/1827.
  const eyePhase = (tick - 2) % 15;
  if (tick >= 2 && [0, 2, 4].includes(eyePhase))
    eye(fight, eyePhase / 2);
  if (tick >= 15 && (tick - 15) % 25 === 0) {
    const phase = Math.floor((tick - 15) / 25) % 3;
    for (let row = 0; row < 3; row++)
      gas(fight, Common.data.vents[row * 3 + ((2 - row + phase) % 3)], true);
  }
  if (tick >= 4 && [0, 4, 5].includes(tick % 6)) {
    const iceArea = Common.data.preparation.ice;
    for (const x of iceArea.columns)
      for (let y = iceArea.minY; y <= iceArea.maxY; y++) {
        if (y === iceArea.skipY)
          continue;
        // The corridor widens by one tile at its southern entrance (1703/1827).
        if (iceArea.entranceColumns.includes(x) && y > iceArea.entranceMaxY)
          continue;
        // Empirical density, not a claim to recover Jagex's unpublished RNG.
        if (Common.random(19) === 0)
          ice(fight, [x, y]);
      }
  }
}
function clear(fight) {
  for (const npc of [...fight.session.passive])
    if (npc.getId() !== Common.data.npcs.vatTimer) {
      if (npc.getId() === Common.data.npcs.vent) {
        npc.performGraphic(new Common.core.Graphic(Common.data.graphics.gasEnd));
        fight.session.passiveExpiry.set(npc, fight.session.tick + 4);
      }
      else
        fight.session.removePassive(npc);
    }
}
module.exports = { gas, eye, ice, preparation, clear };
