/**
 * Giant bones (Obor's and Bryophyta's), as captured and on the Wiki: they can't be picked up
 * ("I don't think those will fit in my backpack..."); their own ground option, Bury, asks first
 * ("Yes, and don't ask again" stops it asking), then buries them where they lie: 150 Prayer XP,
 * anim 827 and sound 2738, with no message.
 */
const Common = require("./Common.GiantLairs");

let DATA = null;

let api = null;
let core = null;

function isGiantBones(event) {
  return (event.groundItemId ?? event.groundItem?.getItem?.()?.getId?.()) === DATA.item;
}

function take(event) {
  if (!isGiantBones(event)) return false;
  event.handled = true;
  event.player.sendMessage(DATA.noRoom);
  return true;
}

function buryNow(player, groundItem) {
  const { Animation, ItemOnGroundManager, Skill } = core;
  if (groundItem.isPendingRemoval?.()) return;
  ItemOnGroundManager.deregister(groundItem);
  player.performAnimation(new Animation(DATA.anim));
  player.getPacketSender().sendSound(DATA.sound, 1, 0);
  player.getSkillManager().addExperiences(Skill.PRAYER, DATA.xp);
}

function bury(event) {
  if (!isGiantBones(event)) return false;
  event.handled = true;
  const { player, groundItem } = event;
  if (player.getAttribute(Common.BURY_WITHOUT_ASKING_ATTRIBUTE) === true) {
    buryNow(player, groundItem);
    return true;
  }
  const [yes, always, no] = DATA.options;
  api.sendMultiChatboxPrompt(
    player,
    DATA.question,
    yes, () => {
      player.getPacketSender().sendInterfaceRemoval();
      buryNow(player, groundItem);
    },
    always, () => {
      player.setAttribute(Common.BURY_WITHOUT_ASKING_ATTRIBUTE, true);
      player.getPacketSender().sendInterfaceRemoval();
      buryNow(player, groundItem);
    },
    no, () => player.getPacketSender().sendInterfaceRemoval(),
  );
  return true;
}

/** Take refuses giant bones; their own ground option, Bury, asks first. */
function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  DATA = Common.data.giantBones;
  pluginApi.persistAttribute(Common.BURY_WITHOUT_ASKING_ATTRIBUTE);
  pluginApi.onGroundItemPickup(take);
  pluginApi.onGroundItemClick(DATA.item, 3, bury);
}

module.exports = attach;
Object.assign(module.exports, { take, bury });
