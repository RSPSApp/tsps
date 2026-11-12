"use strict";

/**
 * Wiki Raw guppy/cavefish/tetra/catfish: levels, XP, nets and membership.
 * Their Wiki pages explicitly lack success charts. The interpolation below is a
 * TSPS estimate, not a measured retail success curve; see docs/camdozaal.md.
 */
module.exports = function tools(Fish, FishingTool, ids) {
  const makeFish = (id, level, xp, caught) => new Fish({ id, level, xp, caught, rolls: [[32, 192]] });
  const guppy = makeFish(ids.RAW_GUPPY, 7, 8, "a raw guppy");
  const cavefish = makeFish(ids.RAW_CAVEFISH, 20, 16, "a raw cavefish");
  const tetra = makeFish(ids.RAW_TETRA, 33, 24, "a raw tetra");
  const catfish = makeFish(ids.RAW_CATFISH, 46, 33, "a raw catfish");
  const makeTool = (id, level, animation, fish, clueBase = null) => new FishingTool({
    id, level, animation, fish, clueBase, stationary: true, interval: 6, firstRoll: 3,
    startMessage: "You cast out your net...",
  });
  return {
    "Small Net": makeTool(ids.SMALL_FISHING_NET, 7, 621, [tetra, cavefish, guppy]),
    "Big Net": makeTool(ids.BIG_FISHING_NET, 33, 620, [catfish, tetra], 100000),
  };
};
