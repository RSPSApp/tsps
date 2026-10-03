"use strict";

const Rules = require("./GodWarsRules");
const Shared = require("./GodWarsShared");

const TROLL_STRONGHOLD_STAGE_ATTRIBUTE = "quest.troll_stronghold.stage";

// Surface entrance (cache: GODWARS_ENTRANCE_BOULDER_MOVEROCK01, Little crack,
// GODWARS_ENTRANCE_MULTI which transforms to the Tie-rope/Climb-down Hole).
const BOULDER = 26415;
const LITTLE_CRACK = 26382;
const ENTRANCE_HOLE = 26419;
// Cache: GODWARS_ROCK_ROPE_MULTI1 bottom, the dungeon-side rope out.
const DUNGEON_ROPE = 26370;

const BOULDER_PASSED_TILE = { x: 2898, y: 3718, z: 0 };
const CRACK_PASSED_TILE = { x: 2902, y: 3718, z: 0 };
const DUNGEON_ENTRY_TILE = { x: 2881, y: 5311, z: 2 };
const SURFACE_EXIT_TILE = { x: 2917, y: 3746, z: 0 };

let entranceRoped = false;

module.exports = function registerGodWarsAccess(api) {
  const { ItemIdentifiers, Skill } = api.core;
  const factions = Shared.buildFactions(api.core);

  function trollStrongholdStage(player) {
    return Number(player.getAttribute(TROLL_STRONGHOLD_STAGE_ATTRIBUTE)) || 0;
  }

  function moveBoulder({ player }) {
    const result = Rules.canMoveBoulder(
      trollStrongholdStage(player),
      player.getSkillManager().getCurrentLevel(Skill.STRENGTH),
      player.getSkillManager().getCurrentLevel(Skill.AGILITY)
    );
    if (!result.ok) {
      player.sendMessage(result.reason);
      return true;
    }
    player.sendMessage("You roll the boulder aside and slip past.");
    player.smartMove(Shared.toLocation(api.core, BOULDER_PASSED_TILE), 2);
    return true;
  }

  function crawlThroughCrack({ player }) {
    if (trollStrongholdStage(player) < Rules.TROLL_STRONGHOLD_DAD_STAGE) {
      player.sendMessage("You need to have helped the Troll Stronghold before venturing further.");
      return true;
    }
    player.sendMessage("You squeeze through the crack in the wall.");
    player.smartMove(Shared.toLocation(api.core, CRACK_PASSED_TILE), 2);
    return true;
  }

  function enterDungeon(player) {
    Shared.resetKillCounts(player, factions);
    player.smartMove(Shared.toLocation(api.core, DUNGEON_ENTRY_TILE), 2);
    player.sendMessage("@red@The chill of the dungeon seeps into your bones.");
  }

  function climbEntrance({ player }) {
    const hasRope = player.getInventory().contains(ItemIdentifiers.ROPE);
    const result = Rules.canClimbEntrance(trollStrongholdStage(player), hasRope, entranceRoped);
    if (!result.ok) {
      player.sendMessage(result.reason);
      return true;
    }
    if (result.tiesRope) {
      player.getInventory().delete(ItemIdentifiers.ROPE, 1);
      entranceRoped = true;
      player.sendMessage("You tie your rope to the hole.");
    }
    player.sendMessage("You climb down into the God Wars Dungeon.");
    enterDungeon(player);
    return true;
  }

  function climbOut({ player }) {
    player.sendMessage("You climb back out of the dungeon.");
    player.smartMove(Shared.toLocation(api.core, SURFACE_EXIT_TILE), 2);
    return true;
  }

  function resetKillCountsOnEntry({ player }) {
    Shared.resetKillCounts(player, factions);
  }

  // Essence is earned from any of a god's followers dying within its camp.
  function creditFactionKill({ killer, npc }) {
    if (!killer || !npc) {
      return;
    }
    const faction = Shared.factionForLocation(factions, npc.getLocation());
    if (faction) {
      Shared.addKillCount(killer, faction);
    }
  }

  api.onObjectFirstClick(BOULDER, moveBoulder);
  api.onObjectFirstClick(LITTLE_CRACK, crawlThroughCrack);
  api.onObjectFirstClick(ENTRANCE_HOLE, climbEntrance);
  api.onObjectFirstClick(DUNGEON_ROPE, climbOut);
  api.onZoneEnter(Shared.GOD_WARS_DUNGEON_ZONE, resetKillCountsOnEntry);
  api.onNpcDeath(creditFactionKill);
};
