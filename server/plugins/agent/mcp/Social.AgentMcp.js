// Friends, ignores, private messages and clan chat (the friends chat channel).
const { CLAN_CHAT_ATTRIBUTE } = require("../../interface/FriendsChatManager");

const FRIEND_RANKS = ["Friend", "Recruit", "Corporal", "Sergeant", "Lieutenant", "Captain", "General"];
// The setup screen's rank choices, in order; a rank value is its index - 1 ("Anyone" is -1).
const CHANNEL_RANKS = [
  "Anyone", "Any friends", "Recruit+", "Corporal+", "Sergeant+", "Lieutenant+", "Captain+", "General+", "Only me",
];
const SETUP_GROUP = 94;
const SETUP_NAME = 10;
const SETUP_RANK_COMPONENT = { entry: 13, talk: 16, kick: 19 };
const RELATION_ACTION = { add: "add_friend", remove: "remove_friend", ignore: "add_ignore", unignore: "remove_ignore" };

module.exports = function registerSocialTools(ctx) {
  const { core, tool, z, player, find, send, status, sleepTicks } = ctx;
  const { World, Misc } = core;

  const displayName = (encoded) => Misc.formatName(Misc.longToString(encoded));
  const social = (p) => {
    const relations = p.getRelations();
    const channel = p.getAttribute(CLAN_CHAT_ATTRIBUTE);
    const ownChannel = relations.getFriendsChatChannelName();
    return {
      friends: relations.getFriendList().map((encoded) => ({
        name: displayName(encoded),
        rank: FRIEND_RANKS[relations.getFriendRank(encoded)] ?? "Friend",
        online: !!World.getPlayerByName(displayName(encoded)),
      })),
      ignores: relations.getIgnoreList().map(displayName),
      ownChannel: ownChannel ? {
        name: ownChannel,
        entry: CHANNEL_RANKS[relations.getFriendsChatEntryRank() + 1],
        talk: CHANNEL_RANKS[relations.getFriendsChatTalkRank() + 1],
        kick: CHANNEL_RANKS[relations.getFriendsChatKickRank() + 1],
      } : null,
      clanChat: channel ? {
        name: channel.profile.channelName,
        owner: channel.profile.ownerName,
        members: [...channel.members.values()].map((member) => member.getUsername()),
      } : null,
    };
  };
  // Sends the messages, gives the server a tick to act on them, then reports.
  const act = async (username, messages) => {
    for (const message of messages) send(find(username), message);
    await sleepTicks(1);
    const p = find(username);
    return { ...social(p), ...status(p) };
  };
  const setupClick = (childId, option) =>
    ({ type: "widget_action", widgetId: (SETUP_GROUP << 16) | childId, groupId: SETUP_GROUP, childId, option });

  tool(
    "social",
    "A player's friends (rank, online), ignores, their own clan chat setup, and the clan chat they are in with its members.",
    { player },
    ({ player: username }) => social(find(username))
  );

  tool(
    "friend",
    "Add or remove a friend, or ignore/unignore a player, by name.",
    { player, action: z.enum(["add", "remove", "ignore", "unignore"]), name: z.string().min(1).max(12) },
    ({ player: username, action, name }) =>
      act(username, [{ type: "friends_chat_action", action: { action: RELATION_ACTION[action], name } }])
  );

  tool(
    "friend_rank",
    "Give a friend a clan chat rank (what the clan chat setup's entry/talk/kick ranks compare against).",
    { player, name: z.string().min(1).max(12), rank: z.enum(FRIEND_RANKS) },
    ({ player: username, name, rank }) => act(username, [{
      type: "friends_chat_action", action: { action: "set_friend_rank", name, rank: FRIEND_RANKS.indexOf(rank) },
    }])
  );

  tool(
    "private_message",
    "Send a private message to a player on the friends list.",
    { player, to: z.string().min(1).max(12), text: z.string().min(1).max(160) },
    ({ player: username, to, text }) => act(username, [{ type: "private_message", recipient: to, text }])
  );

  tool(
    "clan_chat_setup",
    "Set up the player's own clan chat through its setup screen: name it (which also joins it), set who may enter, talk and kick, or disable it.",
    {
      player,
      name: z.string().min(1).max(12).optional(),
      entry: z.enum(CHANNEL_RANKS).optional(),
      talk: z.enum(CHANNEL_RANKS).optional(),
      kick: z.enum(CHANNEL_RANKS.slice(3)).optional(),
      disable: z.boolean().optional(),
    },
    ({ player: username, name, entry, talk, kick, disable }) => {
      const messages = [];
      if (name) messages.push(setupClick(SETUP_NAME, "Set prefix"), { type: "dialogue_input", value: name });
      for (const [setting, rank] of Object.entries({ entry, talk, kick })) {
        if (rank) messages.push(setupClick(SETUP_RANK_COMPONENT[setting], rank));
      }
      if (disable) messages.push(setupClick(SETUP_NAME, "Disable"));
      if (!messages.length) throw new Error("Give a name, a rank to change, or disable: true");
      return act(username, messages);
    }
  );

  tool(
    "clan_chat",
    "Join a clan chat by its owner's name, leave it, kick a member (needs the kick rank), or say something in it.",
    {
      player,
      action: z.enum(["join", "leave", "kick", "say"]),
      name: z.string().min(1).max(12).optional().describe("Owner to join, or member to kick"),
      text: z.string().min(1).max(160).optional().describe("What to say"),
    },
    ({ player: username, action, name, text }) => {
      if (action === "say") {
        if (!text) throw new Error("say needs text");
        return act(username, [{ type: "chat", text, messageType: "friends_chat" }]);
      }
      if (action === "leave") return act(username, [{ type: "friends_chat_action", action: { action } }]);
      if (!name) throw new Error(`${action} needs a name`);
      return act(username, [{ type: "friends_chat_action", action: { action, name } }]);
    }
  );
};
