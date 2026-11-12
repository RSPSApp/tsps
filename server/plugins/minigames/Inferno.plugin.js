// The Inferno: 69 single-player waves under Mor Ul Rek, ending in TzKal-Zuk.
// Rules: https://oldschool.runescape.wiki/w/The_Inferno
//
//   inferno/Waves.Inferno.js     the wave table
//   inferno/Monsters.Inferno.js  combat for each creature
//   inferno/Run.Inferno.js       a run: arena, waves, rocky supports, Jads, rewards
//   inferno/Zuk.Inferno.js       wave 69
//   inferno/Entry.Inferno.js     TzHaar-Ket-Keh's fire cape, the chasm and the exit
const registerInfernoMonsters = require("./inferno/Monsters.Inferno");
const run = require("./inferno/Run.Inferno");
const zuk = require("./inferno/Zuk.Inferno");
const entry = require("./inferno/Entry.Inferno");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

module.exports = {
  name: "Inferno",
  description: "Adds the Inferno: entry through the cave, the wave run, Zuk and the supports, saved progress, and a developer ::infernowave command.",
  members: true,
  register(api) {
    const { ObjectIdentifiers: Objects } = api.core;
    const combat = registerInfernoMonsters(api, { tryRevive: run.tryRevive });
    run.init(api, combat, zuk);
    zuk.init(api, combat);
    entry.init(api);
    api.persistAttribute(run.ATTR_WAVE);
    api.persistAttribute(run.ATTR_SUPPORTS);
    api.persistAttribute(run.ATTR_COMPLETIONS);
    api.persistAttribute(entry.ATTR_SACRIFICED);
    api.onNpcDialogueCondition(entry.answerCondition);
    api.onCustomEvent("npc-dialogue:action", entry.handOverCape);
    api.onObjectFirstClick([entry.INFERNO_ENTRANCE, Objects.THE_INFERNO, Objects.THE_INFERNO_2], entry.jumpIn);
    api.onObjectRoute(entry.routeToChasm);
    api.onObjectFirstClick(Objects.CAVE_EXIT_22, entry.exitCave);
    api.onObjectSecondClick(Objects.CAVE_EXIT_22, entry.quickExit);
    api.onPlayerLogin(entry.syncEntrance);
    api.onPlayerLogin(run.resumeRun);
    api.onPlayerLogout(run.runLogout);
    api.onPlayerProcess(run.processRun);
    require("./inferno/CombatAchievements.Inferno")(api);
    require("./inferno/EscapeCrystal.Inferno")(api);
    api.onPlayerDeath(run.runDeath);
    api.onShouldDropItemsOnDeath(run.keepItemsInRun);
    api.onCanTeleport(run.noTeleportOut);
    api.onCanAttack(run.guardPassives);
    api.onNpcBeforeDeath(run.supportsCollapse);
    api.onCombatHitResolved(zuk.provoke);
    api.registerCommand("infernowave", run.setNextWave, PlayerRights.DEVELOPER, "Set the next Inferno wave");
  },
};
