/**
 * Tai Bwo Wannai village: the tribal statue Tinsay repairs and the brothers' bamboo hut doors.
 * Wiki transcript: "You do not have permission to enter here" (no full stop) at a hut door before the quest
 * is done. Ours: the statue's refusal and prayer lines, which no capture or Wiki line covers.
 */
module.exports = function attachVillage(api, t) {
  const { STAGE, LOC, KEY, TINSAY } = t;
  const { Skill } = api.core;

  function objectInteraction(event) {
    const { player } = event;
    if (LOC.STATUES.has(event.objectId)) {
      event.handled = true;
      if (t.state(player, KEY.TINSAY) < TINSAY.DONE) {
        player.sendMessage("You do not have permission to pray here.");
        return;
      }
      const skills = player.getSkillManager();
      skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER), true);
      player.sendMessage("You pray at the tribal statue and your prayer is restored.");
      return;
    }
    if (event.objectId === LOC.BAMBOO_DOOR && t.stage(player) < STAGE.COMPLETE) {
      event.handled = true;
      player.sendMessage("You do not have permission to enter here");
    }
  }

  api.onObjectInteraction(objectInteraction);
};
