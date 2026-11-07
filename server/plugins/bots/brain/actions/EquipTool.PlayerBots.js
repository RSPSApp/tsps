"use strict";

const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Item } = require("../../../../src/main/typescript/elvarg/game/model/Item");
const { Flag } = require("../../../../src/main/typescript/elvarg/game/model/Flag");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const WorldDefinition = require("../../../../src/main/typescript/elvarg/game/definition/WorldDefinition");
const { CacheDefinitions } = require("../../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const Woodcutting = require("../../../skills/Woodcutting.plugin");
const Mining = require("../../../skills/Mining.plugin");

/** Free worlds: a members tool is no tool there (as Woodcutting and Mining refuse it), so bots don't wield one. */
function usableOnWorld(tool) {
  return WorldDefinition.isMembersWorld() || CacheDefinitions.getItem(tool.id)?.isMembers !== true;
}

const TOOL_RESOLVERS = {
  axe(player) {
    const level = player.getSkillManager().getCurrentLevel(Skill.WOODCUTTING);
    return Woodcutting.findBestUsableAxeByLevel(level, usableOnWorld)?.id ?? null;
  },
  pickaxe(player) {
    const level = player.getSkillManager().getCurrentLevel(Skill.MINING);
    const pickaxe = (Mining.PICKAXES_DESC ?? []).find(
      // Only the standard pickaxes, as for axes: not the league's Echo pickaxe or a crystal one that needs Agility.
      (entry) => entry.standard && level >= entry.requiredLevel && usableOnWorld(entry)
    );
    return pickaxe?.id ?? null;
  },
};

function createEquipToolAction(spec) {
  const resolveTool = TOOL_RESOLVERS[spec.tool];
  if (!resolveTool) {
    throw new Error(`[bot activities] unknown tool '${spec.tool}'`);
  }
  return {
    id: "equipTool",
    update(ctx) {
      const player = ctx.player;
      const equipment = player.getEquipment();
      const toolId = resolveTool(player);
      if (!toolId) {
        return "failed";
      }
      const equipped = equipment.getItems()[Equipment.WEAPON_SLOT];
      if (equipped && equipped.getId() === toolId) {
        return "success";
      }
      equipment.set(Equipment.WEAPON_SLOT, new Item(toolId, 1));
      equipment.refreshItems();
      player.getUpdateFlag().flag(Flag.APPEARANCE);
      return "success";
    },
  };
}

module.exports = {
  createEquipToolAction,
};
