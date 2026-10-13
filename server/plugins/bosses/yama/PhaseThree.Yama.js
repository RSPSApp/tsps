/**
 * Phase 3 (Wiki: Yama/Strategies; the beat pattern from the scim.gg Yama simulator, an estimate):
 * Yama stays in the centre and attacks every 7 ticks, alternating ranged and magic from the
 * element of the glyphs that were more abundant in phase 2, or swinging at an adjacent player
 * (and summoning a flare with each swing). His beats come every 7 ticks from 4 ticks in, 10 a
 * cycle: Shadow Crash on beats 0, 3 and 7 when the player is out of melee reach, two flares on
 * beat 8. A pair of shadow waves follows the last crash, and two pairs the flares, 7 ticks apart
 * (captured); the 2nd and 3rd cross a column east or west at random (Wiki). Protection prayers
 * let 22 of a swing and 3 of a cast through.
 */
const Common = require("./Common.Yama");
const Attacks = require("./Attacks.Yama");
const Hazards = require("./Hazards.Yama");
const Flares = require("./Flares.Yama");


function start(fight, opening) {
  fight.phaseThree = { element: opening, beat: 0 };
}

/** Yama's turn in phase 3: a standard attack, and the beat's special. */
function beat(fight) {
  const { phase3 } = Common.data;
  const state = fight.phaseThree;
  const position = state.beat % phase3.beatsPerCycle;
  state.beat++;
  if (Attacks.adjacent(fight)) {
    Attacks.swing(fight);
    Flares.spawn(fight, 1);
  } else {
    Attacks.cast(fight, Attacks.STYLE_OF[state.element], state.element);
    state.element = Attacks.OTHER[state.element];
    if (phase3.crashBeats.includes(position)) {
      Hazards.shadowCrash(fight);
      if (position === phase3.crashBeats[phase3.crashBeats.length - 1]) {
        fight.at(phase3.waveAfterCrashTicks, () => waves(fight, 0));
      }
    }
  }
  if (phase3.flareBeats.includes(position)) {
    Flares.spawn(fight, 2);
    for (const ticks of phase3.wavesAfterFlaresTicks) fight.at(ticks, () => waves(fight, randomShift()));
  }
}

const randomShift = () => Math.floor(Math.random() * 3) - 1;

/** A pair of waves, one from each corner, crossing `shift` columns east of the usual one. */
function waves(fight, shift) {
  if (fight.state !== "fighting" || fight.phase !== 3) return;
  Hazards.wave(fight, "southEast", shift);
  Hazards.wave(fight, "southWest", shift);
}

module.exports = { start, beat };
