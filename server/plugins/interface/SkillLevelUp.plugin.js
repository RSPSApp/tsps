// RuneLite InterfaceID.LevelupDisplay, verified against cache group 233.
const GROUP = 233;
const CONTINUE = (GROUP << 16) | 3;
// Skill.getIndex() order (Construction precedes Hunter in server arrays).
const SKILL_LAYERS = [6, 17, 49, 30, 40, 38, 34, 12, 53, 25, 23, 21,
  14, 47, 36, 28, 4, 51, 45, 19, 43, 9, 32, 57];

function showLevelUp(core, { player, skill, newLevel }) {
  player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendChatboxInterface(GROUP);
  sender.sendString(`Congratulations! You have achieved a ${skill.getName()} level!`, (GROUP << 16) | 1);
  sender.sendString(`Your ${skill.getName()} level is now ${newLevel}.`, (GROUP << 16) | 2);
  sender.sendString("Click here to continue.", CONTINUE);
  for (const layer of SKILL_LAYERS) {
    sender.sendInterfaceDisplayState((GROUP << 16) | layer, layer !== SKILL_LAYERS[skill.getIndex()]);
  }
}

function continueLevelUp({ player }) {
  if (!player.getPacketSender().isChatboxInterface(GROUP)) return false;
  player.getPacketSender().closeInterface(GROUP);
  return true;
}

module.exports = {
  name: "SkillLevelUp",
  register(api) {
    api.onPlayerLevelUp(showLevelUp.bind(null, api.core));
    api.onInterfaceActionButton(CONTINUE, continueLevelUp);
  },
};
