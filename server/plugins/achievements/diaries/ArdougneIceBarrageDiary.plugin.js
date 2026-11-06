const DIARY = "ardougne";
const TASK = "cast-ice-barrage-on-another-player-within-castle";
const ICE_BARRAGE_SPELL_ID = 12891;

function hitResolved({ attacker, target, hit } = {}) {
  if (!attacker?.isPlayer?.() || !target?.isPlayer?.() || attacker === target
    || attacker.isPlayerBot?.() !== false || target.isPlayerBot?.() !== false
    || attacker.isRegistered?.() !== true
    || attacker.getPrivateArea?.() || target.getPrivateArea?.()
    || attacker.getArea?.()?.getName?.() !== "Castle Wars"
    || target.getArea?.() !== attacker.getArea?.()
    || hit?.getSpell?.()?.spellId?.() !== ICE_BARRAGE_SPELL_ID
    || hit?.getHandleAfterHitEffects?.() !== true
    || hit?.isAccurate?.() !== true) return;

  api.emitCustomEvent("diary:task", { player: attacker, diary: DIARY, task: TASK });
}

let api;
module.exports = {
  name: "ArdougneIceBarrageDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "CastleWars"],
  register(pluginApi) {
    api = pluginApi;
    api.onCombatHitResolved(hitResolved);
  },
  _test: { hitResolved, TASK, ICE_BARRAGE_SPELL_ID },
};
