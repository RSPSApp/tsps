const { FriendsChatManager, CHAT_FILTERS_ATTRIBUTE, CLAN_CHAT_ATTRIBUTE } = require("./FriendsChatManager");

module.exports = {
  name: "FriendsList",
  register(api) {
    api.persistAttribute(CHAT_FILTERS_ATTRIBUTE);
    api.onCanAttack((event) => {
      if (event.allow !== null) return;
      const { attacker, target } = event;
      if (!attacker || !target || attacker === target) return;
      const channel = attacker.getAttribute?.(CLAN_CHAT_ATTRIBUTE);
      if (channel == null || channel !== target.getAttribute?.(CLAN_CHAT_ATTRIBUTE)) return;
      attacker.sendMessage("You cannot attack a player who is in your clan chat.");
      event.allow = false;
    });

    api.onPlayerLogin(({ player }) => {
      FriendsChatManager.onLogin(player);
    });

    api.onPlayerLogout(({ player }) => {
      FriendsChatManager.onLogout(player);
    });

    api.onSocialPacket((event) => {
      const { player, packet } = event;
      if (packet.type === "friends_chat_action") {
        FriendsChatManager.handleAction(player, packet.action);
      } else if (packet.type === "private_message") {
        FriendsChatManager.handlePrivateMessage(player, packet.recipient, packet.text);
      } else if (packet.type === "chat_filter") {
        FriendsChatManager.setChatFilters(player, packet.publicMode, packet.privateMode, packet.tradeMode);
      } else if (packet.type === "chat" && packet.messageType === "friends_chat") {
        FriendsChatManager.handleChat(player, packet.text);
      } else {
        return; // public_chat and other packets are not ours
      }
      // Do NOT mark public_chat or other packet types as handled — let them
      // continue to their proper handlers. The old catch-all else broke public chat.
      if (packet.type === "friends_chat_action" || packet.type === "private_message" || packet.type === "chat_filter" || (packet.type === "chat" && packet.messageType === "friends_chat")) {
        event.handled = true;
      }
    });

    api.onInterfaceActionClick((event) => {
      if (FriendsChatManager.handleWidgetAction(
        event.player,
        event.groupId ?? -1,
        event.childId ?? -1,
        event.option,
        event.opId ?? event.action,
      )) {
        event.handled = true;
      }
    });
  },
};
