const {
  FriendsChatManager,
} = require("../../interface/FriendsChatManager");
const {
  ATTR_RECRUIT_OWNER_USERNAME,
} = require("./BotRecruitConstants");
const { startRecruit } = require("../brain/BrainActivities");

function registerBotStatusInteractions(options = {}) {
  const {
    api,
    botStatusReporter,
    recruitOptionLabel = "Recruit",
    recruitInteractionSlot = 5,
    runtime = null,
    behaviorMode = null,
  } = options;
  if (!api || !botStatusReporter) {
    return;
  }

  const getOwnedClan = (player) => FriendsChatManager.getOwnedChannel(player);
  const signalClanBotsToFollowOwner = (owner) => {
    const clan = getOwnedClan(owner);
    if (!clan || !runtime) {
      return;
    }
    for (const member of clan.members.values()) {
      if (!member || member === owner || member.isPlayerBot?.() !== true) {
        continue;
      }
      if (member.isRegistered?.() !== true) {
        continue;
      }
      const botUsername = member.getUsername?.();
      const botState = botUsername
        ? runtime.botStatesByName?.get?.(botUsername) ??
          runtime.entriesByUsername?.get?.(botUsername)?.state
        : null;
      if (!botState) {
        member.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, owner.getUsername?.() ?? null);
        member.setFollowing?.(owner);
        member.setMobileInteraction?.(owner);
        member.setPositionToFace?.(owner.getLocation?.());
        continue;
      }
      startRecruit(member, botState, owner);
    }
  };
  const shouldShowRecruitOption = (player) => player?.isPlayerBot?.() !== true;
  const recruitOptionSent = new WeakSet();
  const syncInteractionOptions = (player) => {
    if (player?.isPlayerBot?.() === true) {
      return;
    }
    const sender = player?.getPacketSender?.();
    if (!sender || recruitOptionSent.has(player)) {
      return;
    }
    sender.sendPlayerOption(recruitInteractionSlot, recruitOptionLabel, false);
    recruitOptionSent.add(player);
    signalClanBotsToFollowOwner(player);
  };
  const recruitBot = (owner, bot) => {
    if (!FriendsChatManager.recruitBot(owner, bot)) return;
    const botUsername = bot.getUsername?.();
    const botState = botUsername
      ? runtime?.botStatesByName?.get?.(botUsername) ??
        runtime?.entriesByUsername?.get?.(botUsername)?.state
      : null;
    if (botState) {
      startRecruit(bot, botState, owner);
    } else {
      bot.setAttribute?.(ATTR_RECRUIT_OWNER_USERNAME, owner.getUsername?.() ?? null);
      bot.setFollowing?.(owner);
      bot.setMobileInteraction?.(owner);
      bot.setPositionToFace?.(owner.getLocation?.());
    }
    owner
      .getPacketSender?.()
      .sendMessage?.(`${bot.getUsername?.()} joins your clan chat.`);
  };

  api.onPlayerOption((event) => {
    const { player, target } = event;
    if (event.option !== recruitInteractionSlot || target?.isPlayerBot?.() !== true || !shouldShowRecruitOption(player)) {
      return;
    }
    event.handled = true;
    recruitBot(player, target);
  });

  api.onPlayerProcess(({ player }) => {
    syncInteractionOptions(player);
  });
}

module.exports = {
  ATTR_RECRUIT_OWNER_USERNAME,
  registerBotStatusInteractions,
};
