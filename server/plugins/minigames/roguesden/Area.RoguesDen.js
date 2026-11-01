"use strict";

/**
 * The maze's one area: per-tick traps for players in it, the no-items rescue when someone walks
 * in through a door another player opened, and the leave/logout edge that ends the run.
 */
const Common = require("./Common.RoguesDen");
const Run = require("./Run.RoguesDen");

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const core = Common.core();
  AreaClass = class RoguesDenMaze extends core.Area {
    constructor() {
      const b = Common.DATA.bounds.maze;
      super([new core.Boundary(b.minX, b.maxX, b.minY, b.maxY, b.z)]);
    }

    getName() {
      return "Rogues' Den";
    }

    allowSummonPet() {
      return false;
    }

    process(mobile) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (Run.runOf(player)) Run.tick(player);
    }

    postEnter(mobile) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (Run.runOf(player)) return;
      // Someone held the doorway open. Start them properly if they are dressed for it; otherwise
      // put them back in the lobby rather than let items into the maze.
      const allowed = player.getInventory().getValidItems().every((item) => item.getId() === Common.itemIds.mysticJewel)
        && player.getEquipment().getValidItems().length === 0;
      const levels = Common.maxLevel(player, "THIEVING") >= 50 && Common.maxLevel(player, "AGILITY") >= 50;
      if (!allowed || !levels || player.getAttribute(Run.ACCESS_ATTRIBUTE) !== true) {
        Run.finish(player, { reason: "left", silent: true });
        const [x, y, z] = Common.DATA.lobby.entryTile;
        player.moveTo(new (Common.core().Location)(x, y, z));
        return;
      }
      Run.start(player);
      if (!Common.hasItem(player, Common.itemIds.mysticJewel)) Common.give(player, Common.itemIds.mysticJewel, 1);
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) Run.left(mobile.getAsPlayer(), logout);
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

function createArea() {
  return new (areaClass())();
}

module.exports = { createArea };
