/**
 * The glyphs of phases 1 and 2, as captured: five 3x3 floor glyphs light up as a phase starts,
 * the three by the throne and to the south in the element of the phase's first special, the two
 * at the sides in the other. A player on a lit glyph's centre absorbs it a tick later: "You
 * absorb a Glyph of Fire.", the immunity spot animation, the glyph going out (a flash, then
 * inactive), and 10 ticks of immunity to its element (Wiki). Fire burns for 2-12 and shadow
 * drains 2-12 prayer, more the closer Yama stands to the glyph (Wiki). The glyphs go out at the
 * phase change and stay out in phase 3.
 */
const Common = require("./Common.Yama");
const Hits = require("./Hits.Yama");

const LOC_SHAPE = 10;
const OTHER = { fire: "shadow", shadow: "fire" };

/** Lights the phase's glyphs: `major` is the element of the three by the throne. */
function light(fight, major) {
  const { glyphs } = Common.data;
  fight.glyphs = [
    ...glyphs.major.map((tile) => ({ tile, element: major, lit: true })),
    ...glyphs.minor.map((tile) => ({ tile, element: OTHER[major], lit: true })),
  ];
  for (const glyph of fight.glyphs) place(fight, glyph, glyphs.ids[glyph.element]);
}

function place(fight, glyph, id) {
  const { GameObject, ObjectManager } = Common.core;
  const object = new GameObject(id, fight.session.tile([...glyph.tile, 0]), LOC_SHAPE, Common.data.glyphs.rotation, fight.session.area);
  ObjectManager.register(object, true);
  glyph.object = object;
}

/** A glyph goes out: its flash, then the inactive glyph a tick later (as captured). */
function putOut(fight, glyph) {
  const { ids } = Common.data.glyphs;
  glyph.lit = false;
  place(fight, glyph, ids.inactive);
  place(fight, glyph, glyph.element === "fire" ? ids.fireOut : ids.shadowOut);
  fight.at(1, () => place(fight, glyph, ids.inactive));
}

/** Every glyph still lit goes out (the phase change). */
function putAllOut(fight) {
  for (const glyph of fight.glyphs ?? []) if (glyph.lit) putOut(fight, glyph);
}

/** Every glyph left as it is out of a fight: inactive, at once. */
function clear(fight) {
  for (const glyph of fight.glyphs ?? []) {
    glyph.lit = false;
    place(fight, glyph, Common.data.glyphs.ids.inactive);
  }
}

/** The glyph's value by how close Yama is to it: 12 adjacent, then 9, 6, and 2 from four tiles. */
function strength(fight, glyph) {
  const { byYamaDistance, farValue, size } = Common.data.glyphs;
  const yama = fight.yama;
  if (!yama) return farValue;
  const [gx, gy] = fight.session.worldTile(fight.session.tile([...glyph.tile, 0]));
  const [yx, yy] = fight.session.worldTile(yama.getLocation());
  const ySize = yama.getSize();
  const gap = (a, aSize, b, bSize) => Math.max(0, Math.max(a - (b + bSize - 1), b - (a + aSize - 1)));
  const distance = Math.max(gap(gx, size, yx, ySize), gap(gy, size, yy, ySize)) || 1;
  return byYamaDistance.find(([tiles]) => distance <= tiles)?.[1] ?? farValue;
}

/** Each tick: a player on a lit glyph's centre absorbs it a tick later. */
function process(fight) {
  const { player } = fight;
  const [x, y] = fight.session.worldTile(player.getLocation());
  for (const glyph of fight.glyphs ?? []) {
    const onCentre = glyph.lit && x === glyph.tile[0] + 1 && y === glyph.tile[1] + 1;
    if (!onCentre) {
      glyph.standing = 0;
      continue;
    }
    glyph.standing = (glyph.standing ?? 0) + 1;
    if (glyph.standing >= 2) absorb(fight, glyph);
  }
  for (const element of ["fire", "shadow"]) {
    if (fight.immunity[element] && fight.tick >= fight.immunity[element]) {
      fight.immunity[element] = 0;
      player.sendMessage(Common.data.glyphs.messages.fade[element]);
    }
  }
}

function absorb(fight, glyph) {
  const { glyphs } = Common.data;
  const { player } = fight;
  const value = strength(fight, glyph);
  putOut(fight, glyph);
  fight.immunity[glyph.element] = fight.tick + glyphs.immunityTicks;
  player.sendMessage(glyphs.messages.absorb[glyph.element]);
  player.performGraphicInSlot?.(glyphs.absorbSlot, Hits.graphic(glyphs.immunitySpot[glyph.element]));
  if (glyph.element === "fire") Hits.damage(player, value);
  else Hits.drainPrayer(player, value);
}

/** Whether a glyph keeps `element` off the player now. */
function immune(fight, element) {
  return fight.immunity[element] > fight.tick;
}

/** The special's damage soaked up by a glyph: the message and a 0 (as captured). */
function blocked(fight, element) {
  fight.player.sendMessage(Common.data.glyphs.messages.blocked[element]);
  Hits.damage(fight.player, 0);
}

module.exports = { light, putAllOut, clear, process, immune, blocked, strength };
