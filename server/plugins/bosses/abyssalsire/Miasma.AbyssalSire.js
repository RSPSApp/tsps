/**
 * The Sire's miasma pools, as captured: abyssal_miasma_spotanim on the tile with its sound, then
 * damage on the pool's 3rd, 4th and 5th ticks, less each time - 8-26, 6-17, 3-9 on its own tile and
 * 2-9, 1-8, 1-5 on the eight around it. The first hit can poison, starting at 8 (Wiki). They do no
 * damage once the Sire is dead (Wiki, April 2021).
 */
const Common = require("./Common.AbyssalSire");

class Miasma {
  constructor(fight) {
    this.fight = fight;
    this.pools = [];
  }

  place(tile) {
    const { spotanims, sounds } = Common.data;
    const watchers = this.fight.watchers();
    Common.tileGraphic(watchers, tile, spotanims.miasma);
    Common.areaSound(watchers, sounds.miasma, tile);
    this.pools.push({ tile, placedAt: this.fight.tick });
  }

  tick() {
    const { damageTicks, centre, outer, poison } = Common.data.miasma;
    const player = this.fight.player;
    const here = player.getLocation();
    this.pools = this.pools.filter((pool) => this.fight.tick - pool.placedAt <= damageTicks[damageTicks.length - 1]);
    if (!this.fight.playerHere()) return;
    for (const pool of this.pools) {
      const step = damageTicks.indexOf(this.fight.tick - pool.placedAt);
      if (step < 0) continue;
      const distance = Math.max(Math.abs(here.getX() - pool.tile.getX()), Math.abs(here.getY() - pool.tile.getY()));
      if (distance > 1 || here.getZ() !== pool.tile.getZ()) continue;
      const [min, max] = (distance === 0 ? centre : outer)[step];
      const damage = Common.hurtPlayer(player, Common.randomInt(min, max), true);
      this.fight.stats.miasmaDamage += damage;
      // Severity, not the hit: the miasma's 8 sets the poison varp 0 -> 36, 5 x 8 - 4 (rsprox_transcripts/227/00240.txt:9300,
      // 22 times across the recordings), a first hit of 8 as the Wiki says.
      if (step === 0) Common.core.CombatFactory.poisonEntity(player, poison * 5 - 4);
    }
  }

  clear() {
    this.pools = [];
  }
}

module.exports = Miasma;
