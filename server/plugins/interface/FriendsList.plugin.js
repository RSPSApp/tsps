const { FriendsChatManager, FriendsChatRank, CHAT_FILTERS_ATTRIBUTE, CLAN_CHAT_ATTRIBUTE } = require("./FriendsChatManager");

let pluginApi = null;

/**
 * friends-chat:channel - { player } or { key } -> reply `channel` (the chat-channel the player
 * is in, or with that key, or null: key, ownerName, name, members, kickRank, rankOf(member))
 * and `ranks` (FriendsChatRank).
 */
function describeChannel(request) {
  if (!request) return;
  if (request.key) request.channel = FriendsChatManager.channelByKey(request.key);
  else if (request.player) request.channel = FriendsChatManager.channelOf(request.player);
  request.ranks = FriendsChatRank;
}

/** friends-chat:join - { player, owner, notify } -> reply `joined`. */
function joinChannel(request) {
  if (!request?.player) return;
  request.joined = FriendsChatManager.join(request.player, request.owner, request.notify !== false);
}

/** friends-chat:leave - { player, notify }. */
function leaveChannel(request) {
  if (request?.player) FriendsChatManager.leave(request.player, request.notify !== false);
}

/** Tells other plugins a member left a chat-channel (left, kicked, or logged out). */
function announceLeave(player, channelKey) {
  pluginApi?.emitCustomEvent("friends-chat:left", { player, channelKey });
}

/** "friends:send-private-message" ({ sender, recipient, text, sent }): a message sent for a player, such as a bot's reply. */
function sendPrivateMessage(event) {
  const { sender, recipient, text } = event ?? {};
  if (!sender || !recipient || !FriendsChatManager.allowChat(sender, String(text ?? ""))) return;
  event.sent = FriendsChatManager.deliverPrivateMessage(sender, recipient, text);
}

/**
 * OSRS has no rule against attacking someone in your chat-channel. Only bots are held back,
 * since a recruited bot shouldn't pick its owner's channel as a target.
 */
function keepRecruitedBotsFriendly(event) {
  if (event.allow !== null) return;
  const { attacker, target } = event;
  if (!attacker?.isPlayerBot?.() || !target || attacker === target) return;
  const channel = attacker.getAttribute?.(CLAN_CHAT_ATTRIBUTE);
  if (channel != null && channel === target.getAttribute?.(CLAN_CHAT_ATTRIBUTE)) event.allow = false;
}

module.exports = {
  name: "FriendsList",
  register(api) {
    api.onCustomEvent("friends:send-private-message", sendPrivateMessage);
    pluginApi = api;
    FriendsChatManager.memberRemoved = announceLeave;
    api.onCustomEvent("friends-chat:channel", describeChannel);
    api.onCustomEvent("friends-chat:join", joinChannel);
    api.onCustomEvent("friends-chat:leave", leaveChannel);
    api.persistAttribute(CHAT_FILTERS_ATTRIBUTE);
    api.onCanAttack(keepRecruitedBotsFriendly);

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
        // Delivered messages are announced, so a plugin can answer for its player (AI bots).
        const delivered = FriendsChatManager.handlePrivateMessage(player, packet.recipient, packet.text);
        if (delivered) {
          api.emitCustomEvent("friends:private-message", { sender: player, recipient: delivered.recipient, text: delivered.text });
        }
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
