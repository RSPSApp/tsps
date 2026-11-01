const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { World } = require("../../src/main/typescript/elvarg/game/World");
const { encodeChatMessage, encodeFriendsChatSnapshot } = require("../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { PlayerPunishment } = require("../../src/main/typescript/elvarg/util/PlayerPunishment");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../src/main/typescript/elvarg/game/task/TaskManager");
const FriendsChatRank = {
    Unranked: -1,
    Friend: 0,
    Recruit: 1,
    Corporal: 2,
    Sergeant: 3,
    Lieutenant: 4,
    Captain: 5,
    General: 6,
    Owner: 7,
    JagexModerator: 127,
};
const MAX_CHANNEL_MEMBERS = 500;
const KICK_BAN_MS = 60 * 60 * 1000;
const FRIENDS_CHAT_MESSAGE_TYPE = 9;
/** [public, private, trade] chat filter modes, saved so they survive a relog. */
const CHAT_FILTERS_ATTRIBUTE = "chat.filters";
const CLAN_CHAT_ATTRIBUTE = "clan-chat:channel";
const FRIENDS_CHAT_NOTIFICATION_TYPE = 11;
const SETUP_NOTICE_MESSAGE_TYPE = 30;
/** rsprox 754 and 753: setup changes reach the channel 100 ticks after the first one. */
const SETUP_CHANGE_TICKS = 100;
/** rsprox 763: a join is answered on the next tick. */
const JOIN_DELAY_TICKS = 1;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const SOCIAL_TAB_TARGET_UID = (161 << 16) | 85;
const RANK_OPTIONS = [
    "Anyone",
    "Any friends",
    "Recruit+",
    "Corporal+",
    "Sergeant+",
    "Lieutenant+",
    "Captain+",
    "General+",
    "Only me",
];
function accountName(value) {
    const key = String(value ?? "")
        .replace(/_/g, " ")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    if (key.length < 1 || key.length > 12 || !/^[a-z0-9 ]+$/.test(key))
        return undefined;
    const encoded = Misc.stringToLongBigInt(key);
    if (encoded <= 0n)
        return undefined;
    return { key, display: Misc.formatText(key.replace(/ /g, "_")), encoded };
}
function channelName(value) {
    const name = String(value ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 1 || name.length > 12 || !/^[a-z0-9 _-]+$/i.test(name))
        return undefined;
    return name;
}
function rankFromOption(option) {
    const index = RANK_OPTIONS.findIndex((value) => value.toLowerCase() === option.trim().toLowerCase());
    return index < 0 ? undefined : index - 1;
}
function optionFromWidget(groupId, componentId, opId) {
    if (groupId === 429 && componentId === 1 && opId === 1)
        return "View Ignore List";
    if (groupId === 432 && componentId === 1 && opId === 1)
        return "View Friends List";
    if (groupId === 7 && componentId === 20 && opId === 1)
        return "Setup";
    if (groupId !== 94)
        return undefined;
    if (componentId === 10)
        return ["Set prefix", "Disable"][opId - 1];
    if (componentId === 13 || componentId === 16)
        return RANK_OPTIONS[opId - 1];
    if (componentId === 19 && opId >= 4)
        return RANK_OPTIONS[opId - 1];
    return undefined;
}
function afterTicks(ticks, action) {
    TaskManager.submit(new (class extends Task {
        constructor() {
            super(ticks);
        }
        execute() {
            this.stop();
            action();
        }
    })());
}
function rankLabel(rank) {
    return RANK_OPTIONS[Math.max(-1, Math.min(7, rank)) + 1] ?? "Anyone";
}
class FriendsChatManager {
    static getOwnedChannel(player) {
        const owner = accountName(player.getUsername());
        return owner ? this.channels.get(owner.key) : undefined;
    }
    static recruitBot(owner, bot) {
        if (!bot.isPlayerBot() || owner.isPlayerBot())
            return false;
        if (!owner.getRelations().getFriendsChatChannelName()) {
            this.gameMessage(owner, "Set up a chat-channel first to recruit bots.");
            return false;
        }
        if (!this.join(owner, owner.getUsername(), true))
            return false;
        const relations = owner.getRelations();
        relations.addFriend(bot.getLongUsername());
        relations.setFriendRank(bot.getLongUsername(), Math.max(FriendsChatRank.Recruit, relations.getFriendsChatEntryRank(), relations.getFriendRank(bot.getLongUsername())));
        this.persist(owner);
        this.refreshOwnedChannel(owner);
        this.sendSnapshot(owner);
        return this.join(bot, owner.getUsername(), true);
    }
    static channels = new Map();
    static membershipByPlayer = new Map();
    static temporaryBans = new Map();
    static offlinePlayerIds = new Set();
    /** Who has asked to join and is waiting for the answer, by player index. */
    static pendingJoins = new Map();
    /** Owner key -> the setup the channel takes when its delay ends. */
    static pendingSetups = new Map();
    static onLogin(player) {
        this.offlinePlayerIds.delete(player.getIndex());
        const filters = player.getAttribute(CHAT_FILTERS_ATTRIBUTE);
        if (Array.isArray(filters) && filters.length === 3)
            player.getRelations().setChatModes(filters[0], filters[1], filters[2]);
        player.getRelations().onLogin(player);
        this.refreshOwnedChannel(player);
        this.sendSnapshot(player);
        this.refreshFriendWatchers(player.getLongUsername(), player);
        const lastOwner = player.getRelations().getFriendsChatLastOwner();
        if (lastOwner) {
            this.notification(player, "Attempting to join chat-channel...");
            this.join(player, lastOwner, true);
        }
    }
    static onLogout(player) {
        if (this.offlinePlayerIds.has(player.getIndex()))
            return;
        this.offlinePlayerIds.add(player.getIndex());
        this.pendingJoins.delete(player.getIndex());
        const ownerKey = this.membershipByPlayer.get(player.getIndex());
        if (ownerKey)
            this.removeMember(ownerKey, player.getIndex());
        this.refreshOwnedChannel(player);
        this.refreshFriendWatchers(player.getLongUsername(), player);
    }
    static handleAction(player, action) {
        switch (action.action) {
            case "join":
                this.requestJoin(player, action.name);
                return;
            case "leave":
                this.leave(player, true);
                return;
            case "kick":
                this.kick(player, action.name);
                return;
            case "add_friend":
            case "remove_friend":
            case "set_friend_rank":
            case "add_ignore":
            case "remove_ignore":
                this.handleRelationAction(player, action);
                return;
        }
    }
    static handlePrivateMessage(player, rawRecipient, rawText) {
        const recipientName = accountName(rawRecipient);
        const text = this.cleanMessage(rawText, 160);
        if (!recipientName || !text || !this.allowChat(player, text))
            return;
        if (!player.getRelations().hasFriend(recipientName.encoded)) {
            this.gameMessage(player, "Please add that player to your friends list first.");
            return;
        }
        const recipient = this.onlinePlayer(recipientName);
        if (!recipient || !recipient.getRelations().canReceivePrivateMessageFrom(player)) {
            this.gameMessage(player, "This player is currently offline.");
            return;
        }
        if (player.getRelations().getStatus() === 2) {
            // OSRS forces private chat to Friends when you send a PM; route
            // through setChatFilters so the change survives a relog.
            const relations = player.getRelations();
            this.setChatFilters(player, relations.getPublicChatMode(), 1, relations.getTradeChatMode());
        }
        this.deliverPrivateMessage(player, recipient, text);
        return { recipient, text };
    }
    /**
     * Shows `text` to both sides of a private message. The recipient's own privacy settings
     * still apply; whether the sender may message them (friends list) is the caller's check.
     */
    static deliverPrivateMessage(sender, recipient, rawText) {
        const text = this.cleanMessage(rawText, 160);
        if (!text || !recipient?.getRelations?.().canReceivePrivateMessageFrom(sender))
            return false;
        recipient.getSession().sendClientPacket(encodeChatMessage("private_in", text, sender.getUsername(), "", sender.getIndex(), 3));
        sender.getSession().sendClientPacket(encodeChatMessage("private_out", text, recipient.getUsername(), "", recipient.getIndex(), 6));
        return true;
    }
    static setChatFilters(player, publicMode, privateMode, tradeMode) {
        player.getRelations().setChatModes(publicMode, privateMode, tradeMode);
        const relations = player.getRelations();
        player.setAttribute(CHAT_FILTERS_ATTRIBUTE, [relations.getPublicChatMode(), relations.getStatus(), relations.getTradeChatMode()]);
        this.sendSnapshot(player);
        this.refreshFriendWatchers(player.getLongUsername(), player);
    }
    static handleChat(player, rawText) {
        const ownerKey = this.membershipByPlayer.get(player.getIndex());
        const channel = ownerKey ? this.channels.get(ownerKey) : undefined;
        if (!channel) {
            this.notification(player, "You are not currently in a chat-channel.");
            return;
        }
        const text = this.cleanMessage(rawText, 160);
        if (!text || !this.allowChat(player, text))
            return;
        const rank = this.memberRank(channel.profile, player);
        if (rank !== FriendsChatRank.JagexModerator && rank < channel.profile.talkRank) {
            this.notification(player, "You are not a high enough rank to talk in this chat-channel.");
            return;
        }
        for (const member of channel.members.values()) {
            if (this.offlinePlayerIds.has(member.getIndex()) ||
                member.getRelations().hasIgnore(player.getLongUsername())) {
                continue;
            }
            member.getSession().sendClientPacket(encodeChatMessage("channel", text, player.getUsername(), channel.profile.channelName, player.getIndex(), FRIENDS_CHAT_MESSAGE_TYPE));
        }
    }
    static handleWidgetAction(player, groupId, componentId, rawOption, rawOpId) {
        const option = String(rawOption ?? "").trim() ||
            optionFromWidget(groupId, componentId, Math.trunc(rawOpId)) || "";
        const normalized = option.toLowerCase();
        if (groupId === 429 && normalized === "view ignore list") {
            player.getPacketSender().sendSubInterface(SOCIAL_TAB_TARGET_UID, 432, 1);
            return true;
        }
        if (groupId === 432 && normalized === "view friends list") {
            player.getPacketSender().sendSubInterface(SOCIAL_TAB_TARGET_UID, 429, 1);
            return true;
        }
        if (groupId === 7) {
            if (normalized === "setup") {
                this.openSetup(player);
                return true;
            }
            if (normalized === "join") {
                this.requestName(player, "Enter the name of the chat-channel owner:", (name) => this.requestJoin(player, name));
                return true;
            }
            if (normalized === "leave") {
                this.leave(player, true);
                return true;
            }
            return false;
        }
        if (groupId !== 94)
            return false;
        if (normalized === "set prefix") {
            this.requestName(player, "Enter a name for your chat-channel:", (name) => this.setOwnChannelName(player, name));
            return true;
        }
        if (normalized === "disable") {
            this.disableOwnChannel(player);
            return true;
        }
        if (normalized === "back" || normalized === "close") {
            player.getPacketSender().closeInterface(94);
            return true;
        }
        const rank = rankFromOption(option);
        if (rank === undefined)
            return false;
        const setRanks = {
            13: (relations) => relations.setFriendsChatRanks(rank, relations.getFriendsChatTalkRank(), relations.getFriendsChatKickRank()),
            16: (relations) => relations.setFriendsChatRanks(relations.getFriendsChatEntryRank(), rank, relations.getFriendsChatKickRank()),
            19: (relations) => relations.setFriendsChatRanks(relations.getFriendsChatEntryRank(), relations.getFriendsChatTalkRank(), rank),
        }[componentId];
        if (!setRanks)
            return false;
        if (this.setupIsLive(player)) {
            this.changeSetup(player, setRanks);
        }
        else {
            setRanks(player.getRelations());
            this.persist(player);
            this.syncSetupText(player);
        }
        return true;
    }
    static sendSnapshot(player) {
        if (this.offlinePlayerIds.has(player.getIndex()))
            return;
        const relations = player.getRelations();
        const friends = relations.getFriendList().map((encoded) => {
            const display = Misc.formatName(Misc.longToString(encoded));
            const online = this.onlinePlayer({
                key: display.toLowerCase(),
                display,
                encoded,
            });
            const visible = online?.getRelations().canReceivePrivateMessageFrom(player) === true;
            return {
                name: online?.getUsername() ?? display,
                previousName: "",
                world: visible ? 1 : 0,
                rank: relations.getFriendRank(encoded),
                isOnline: visible,
            };
        }).sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.name.localeCompare(b.name));
        const ignores = relations.getIgnoreList()
            .map((encoded) => ({ name: Misc.formatName(Misc.longToString(encoded)), previousName: "" }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const snapshot = { friends, ignores };
        const ownerKey = this.membershipByPlayer.get(player.getIndex());
        const channel = ownerKey ? this.channels.get(ownerKey) : undefined;
        if (channel) {
            snapshot.channel = {
                name: channel.profile.channelName,
                owner: channel.profile.ownerName,
                minKickRank: channel.profile.kickRank,
                localRank: this.memberRank(channel.profile, player),
                members: Array.from(channel.members.values())
                    .filter((member) => !this.offlinePlayerIds.has(member.getIndex()))
                    .map((member) => ({
                    name: member.getUsername(),
                    world: 1,
                    rank: this.memberRank(channel.profile, member),
                }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
            };
        }
        player.getSession().sendClientPacket(encodeFriendsChatSnapshot(snapshot));
    }
    static handleRelationAction(player, action) {
        const target = accountName(action.name);
        if (!target)
            return;
        const relations = player.getRelations();
        if (action.action === "add_friend")
            relations.addFriend(target.encoded);
        else if (action.action === "remove_friend")
            relations.deleteFriend(target.encoded);
        else if (action.action === "set_friend_rank") {
            if (!relations.setFriendRank(target.encoded, action.rank)) {
                this.gameMessage(player, "This player is not on your friends list.");
            }
        }
        else if (action.action === "add_ignore")
            relations.addIgnore(target.encoded);
        else
            relations.deleteIgnore(target.encoded);
        this.persist(player);
        this.sendSnapshot(player);
        this.refreshFriendWatchers(player.getLongUsername(), player);
        const ownerKey = accountName(player.getUsername())?.key;
        if (ownerKey) {
            this.refreshOwnedChannel(player);
            if (action.action === "add_ignore") {
                const channel = this.channels.get(ownerKey);
                const member = channel && Array.from(channel.members.values()).find((candidate) => candidate.getLongUsername() === target.encoded);
                if (member) {
                    member.getRelations().setFriendsChatLastOwner("");
                    this.removeMember(ownerKey, member.getIndex());
                    this.sendSnapshot(member);
                }
            }
        }
    }
    /** A player's own request to join, as the Join Chat button sends it. */
    static requestJoin(player, rawOwnerName) {
        const index = player.getIndex();
        if (this.membershipByPlayer.has(index)) {
            this.notification(player, "Please wait until you are logged out of your previous chat-channel.");
            return;
        }
        if (this.pendingJoins.has(index))
            return;
        this.pendingJoins.set(index, player);
        this.notification(player, "Attempting to join chat-channel...");
        afterTicks(JOIN_DELAY_TICKS, () => {
            if (this.pendingJoins.get(index) !== player)
                return;
            this.pendingJoins.delete(index);
            this.join(player, rawOwnerName, true);
        });
    }
    static join(player, rawOwnerName, notify) {
        const ownerName = accountName(rawOwnerName);
        if (!ownerName) {
            if (notify)
                this.notification(player, "The channel you tried to join does not exist.");
            return false;
        }
        let channel = this.channels.get(ownerName.key);
        const profile = channel?.profile ?? this.loadOwnerProfile(ownerName);
        if (!profile?.channelName) {
            if (notify)
                this.notification(player, "The channel you tried to join does not exist.");
            return false;
        }
        const memberName = accountName(player.getUsername());
        const rank = this.memberRank(profile, player);
        const privileged = rank === FriendsChatRank.JagexModerator;
        if (!privileged && profile.ignores.has(memberName.encoded)) {
            if (notify)
                this.notification(player, "You are not allowed to join this user's chat-channel.");
            return false;
        }
        const bannedUntil = this.temporaryBans.get(ownerName.key)?.get(memberName.key) ?? 0;
        if (!privileged && bannedUntil > Date.now()) {
            if (notify)
                this.notification(player, "You are temporarily banned from this chat-channel.");
            return false;
        }
        if (!privileged && rank < profile.entryRank) {
            if (notify)
                this.notification(player, "You do not have a high enough rank to join this chat-channel.");
            return false;
        }
        const previous = this.membershipByPlayer.get(player.getIndex());
        if (previous === ownerName.key) {
            this.sendSnapshot(player);
            return true;
        }
        if (previous)
            this.removeMember(previous, player.getIndex());
        if (!channel) {
            channel = { ownerKey: ownerName.key, profile, members: new Map() };
            this.channels.set(ownerName.key, channel);
        }
        if (channel.members.size >= MAX_CHANNEL_MEMBERS) {
            const candidate = Array.from(channel.members.values())
                .filter((member) => this.memberRank(profile, member) < rank)
                .sort((a, b) => this.memberRank(profile, a) - this.memberRank(profile, b))[0];
            if (!candidate) {
                if (notify)
                    this.notification(player, "This chat-channel is currently full.");
                return false;
            }
            candidate.getRelations().setFriendsChatLastOwner("");
            this.removeMember(ownerName.key, candidate.getIndex());
            this.sendSnapshot(candidate);
            this.notification(candidate, "You have been removed from this channel.");
        }
        channel.members.set(player.getIndex(), player);
        player.setAttribute(CLAN_CHAT_ATTRIBUTE, channel);
        this.membershipByPlayer.set(player.getIndex(), ownerName.key);
        player.getRelations().setFriendsChatLastOwner(profile.ownerName);
        this.persist(player);
        if (notify) {
            this.notification(player, `Now talking in chat-channel ${profile.channelName}`);
            this.notification(player, "To talk, start each line of chat with the / symbol.");
        }
        this.broadcastChannel(ownerName.key);
        return true;
    }
    static leave(player, notify) {
        const ownerKey = this.membershipByPlayer.get(player.getIndex());
        this.pendingJoins.delete(player.getIndex());
        player.getRelations().setFriendsChatLastOwner("");
        this.persist(player);
        if (!ownerKey) {
            this.sendSnapshot(player);
            return;
        }
        this.removeMember(ownerKey, player.getIndex());
        this.sendSnapshot(player);
        if (notify)
            this.notification(player, "You have left the channel.");
    }
    static kick(player, rawTargetName) {
        const ownerKey = this.membershipByPlayer.get(player.getIndex());
        const channel = ownerKey ? this.channels.get(ownerKey) : undefined;
        const targetName = accountName(rawTargetName);
        if (!ownerKey || !channel || !targetName)
            return;
        const kickerRank = this.memberRank(channel.profile, player);
        if (kickerRank !== FriendsChatRank.JagexModerator &&
            kickerRank < Math.max(FriendsChatRank.Corporal, channel.profile.kickRank)) {
            this.notification(player, "You are not a high enough rank to kick from this chat-channel.");
            return;
        }
        const target = Array.from(channel.members.values()).find((member) => member.getLongUsername() === targetName.encoded);
        if (!target || target === player || this.memberRank(channel.profile, target) >= kickerRank) {
            this.notification(player, "You can only kick chat-channel members with a lower rank.");
            return;
        }
        let bans = this.temporaryBans.get(ownerKey);
        if (!bans) {
            bans = new Map();
            this.temporaryBans.set(ownerKey, bans);
        }
        bans.set(targetName.key, Date.now() + KICK_BAN_MS);
        target.getRelations().setFriendsChatLastOwner("");
        this.persist(target);
        this.notification(target, "You have been kicked from the channel.");
        this.removeMember(ownerKey, target.getIndex());
        this.sendSnapshot(target);
    }
    static removeMember(ownerKey, playerId) {
        const channel = this.channels.get(ownerKey);
        if (!channel)
            return;
        const member = channel.members.get(playerId);
        member?.setAttribute(CLAN_CHAT_ATTRIBUTE, null);
        channel.members.delete(playerId);
        this.membershipByPlayer.delete(playerId);
        if (channel.members.size === 0) {
            // A channel with a change on the way keeps its old setup until the change lands.
            if (!this.pendingSetups.has(ownerKey))
                this.channels.delete(ownerKey);
            this.temporaryBans.delete(ownerKey);
        }
        else {
            this.broadcastChannel(ownerKey);
        }
        if (member)
            this.memberRemoved?.(member, ownerKey);
    }
    /**
     * A plugin-facing view of the chat-channel a player is in, or null: its key (the owner's
     * name), display name, members, and each member's rank in it.
     */
    static channelOf(player) {
        return this.channelByKey(this.membershipByPlayer.get(player.getIndex()));
    }
    /** The same view of a chat-channel by its key, or null if no one is in it. */
    static channelByKey(ownerKey) {
        const channel = ownerKey ? this.channels.get(ownerKey) : undefined;
        if (!channel)
            return null;
        return {
            key: ownerKey,
            ownerName: channel.profile.ownerName,
            name: channel.profile.channelName,
            members: Array.from(channel.members.values()),
            kickRank: Math.max(FriendsChatRank.Corporal, channel.profile.kickRank),
            rankOf: (member) => this.memberRank(channel.profile, member),
        };
    }
    static setOwnChannelName(player, rawName) {
        const name = channelName(rawName);
        if (!name) {
            this.notification(player, "Chat-channel names must contain 1 to 12 valid characters.");
            return;
        }
        if (this.setupIsLive(player)) {
            this.changeSetup(player, (relations) => relations.setFriendsChatChannelName(name));
            return;
        }
        // rsprox 749, 754: switching a disabled channel on is immediate and doesn't join it.
        player.getRelations().setFriendsChatChannelName(name);
        this.persist(player);
        this.syncSetupText(player);
        this.notification(player, "Your chat-channel has now been enabled!");
        this.notification(player, `Join your channel by clicking 'Join Chat' and typing: ${player.getUsername()}`);
    }
    static disableOwnChannel(player) {
        if (this.setupIsLive(player))
            this.changeSetup(player, (relations) => relations.setFriendsChatChannelName(""));
    }
    /** The channel is on, or is on until a change that is already on its way lands. */
    static setupIsLive(player) {
        const owner = accountName(player.getUsername());
        return !!owner && (!!player.getRelations().getFriendsChatChannelName() || this.pendingSetups.has(owner.key));
    }
    /**
     * Saves a setup change now, and has the channel take it when the delay ends. The channel
     * keeps its old name and ranks until then, for whoever joins in the meantime (rsprox 753).
     */
    static changeSetup(player, change) {
        const owner = accountName(player.getUsername());
        if (!owner)
            return;
        const before = this.profileFromPlayer(player, owner);
        const relations = player.getRelations();
        change(relations);
        this.persist(player);
        this.syncSetupText(player);
        const firstChange = !this.pendingSetups.has(owner.key);
        this.pendingSetups.set(owner.key, {
            channelName: relations.getFriendsChatChannelName(),
            entryRank: relations.getFriendsChatEntryRank(),
            talkRank: relations.getFriendsChatTalkRank(),
            kickRank: relations.getFriendsChatKickRank(),
        });
        if (!firstChange)
            return;
        if (!this.channels.has(owner.key))
            this.channels.set(owner.key, { ownerKey: owner.key, profile: before, members: new Map() });
        player.getSession().sendClientPacket(encodeChatMessage("game", "Changes will take effect on your friends channel in the next 60 seconds.", "", "", -1, SETUP_NOTICE_MESSAGE_TYPE));
        afterTicks(SETUP_CHANGE_TICKS, () => this.applySetup(owner));
    }
    static applySetup(owner) {
        const setup = this.pendingSetups.get(owner.key);
        const channel = this.channels.get(owner.key);
        this.pendingSetups.delete(owner.key);
        if (!setup || !channel)
            return;
        channel.profile = { ...channel.profile, ...setup };
        if (!setup.channelName) {
            this.closeChannel(owner, channel);
            return;
        }
        if (channel.members.size === 0) {
            this.channels.delete(owner.key);
            this.temporaryBans.delete(owner.key);
            return;
        }
        this.broadcastChannel(owner.key);
    }
    static closeChannel(owner, channel) {
        this.channels.delete(owner.key);
        this.temporaryBans.delete(owner.key);
        const online = this.onlinePlayer(owner);
        if (online)
            this.notification(online, "Your chat-channel has now been disabled!");
        for (const member of channel.members.values()) {
            member.setAttribute(CLAN_CHAT_ATTRIBUTE, null);
            this.membershipByPlayer.delete(member.getIndex());
            member.getRelations().setFriendsChatLastOwner("");
            this.persist(member);
            this.notification(member, "You have been removed from this channel.");
            this.sendSnapshot(member);
            this.memberRemoved?.(member, owner.key);
        }
    }
    static openSetup(player) {
        player.getPacketSender().sendSubInterface(MAIN_MODAL_TARGET_UID, 94, 0);
        this.syncSetupText(player);
    }
    static syncSetupText(player) {
        const relations = player.getRelations();
        player.getPacketSender()
            .sendString(relations.getFriendsChatChannelName() || "Chat disabled", (94 << 16) | 10)
            .sendString(rankLabel(relations.getFriendsChatEntryRank()), (94 << 16) | 13)
            .sendString(rankLabel(relations.getFriendsChatTalkRank()), (94 << 16) | 16)
            .sendString(rankLabel(relations.getFriendsChatKickRank()), (94 << 16) | 19);
    }
    static requestName(player, title, callback) {
        player.setEnteredSyntaxAction({ execute: callback });
        player.getPacketSender().sendEnterInputPrompt(title);
    }
    static refreshOwnedChannel(player) {
        const owner = accountName(player.getUsername());
        const channel = owner ? this.channels.get(owner.key) : undefined;
        if (!owner || !channel)
            return;
        const { channelName: name, entryRank, talkRank, kickRank } = channel.profile;
        channel.profile = this.profileFromPlayer(player, owner);
        // Friends and ignores apply at once; the setup waits for its delay.
        if (this.pendingSetups.has(owner.key))
            Object.assign(channel.profile, { channelName: name, entryRank, talkRank, kickRank });
        this.broadcastChannel(owner.key);
    }
    static loadOwnerProfile(owner) {
        const online = this.onlinePlayer(owner);
        if (online)
            return this.profileFromPlayer(online, owner);
        try {
            const save = GameConstants.PLAYER_PERSISTENCE.load(owner.display);
            return save ? this.profileFromSave(save, owner) : undefined;
        }
        catch {
            return undefined;
        }
    }
    static profileFromPlayer(player, owner) {
        const relations = player.getRelations();
        return {
            ownerKey: owner.key,
            ownerName: player.getUsername(),
            channelName: relations.getFriendsChatChannelName(),
            entryRank: relations.getFriendsChatEntryRank(),
            talkRank: relations.getFriendsChatTalkRank(),
            kickRank: relations.getFriendsChatKickRank(),
            friends: new Set(relations.getFriendList()),
            ignores: new Set(relations.getIgnoreList()),
            friendRanks: new Map(relations.getFriendList().map((name) => [name, relations.getFriendRank(name)])),
        };
    }
    static profileFromSave(save, owner) {
        const friends = new Set();
        const ignores = new Set();
        for (const value of save.getFriends?.() ?? []) {
            try {
                friends.add(BigInt(value));
            }
            catch { }
        }
        for (const value of save.getIgnores?.() ?? []) {
            try {
                ignores.add(BigInt(value));
            }
            catch { }
        }
        const friendRanks = new Map();
        for (const [value, rank] of Object.entries(save.getFriendRanks?.() ?? {})) {
            try {
                const encoded = BigInt(value);
                if (friends.has(encoded))
                    friendRanks.set(encoded, Math.max(0, Math.min(6, rank | 0)));
            }
            catch { }
        }
        return {
            ownerKey: owner.key,
            ownerName: owner.display,
            channelName: save.getFriendsChatChannelName?.() ?? "",
            entryRank: save.getFriendsChatEntryRank?.() ?? -1,
            talkRank: save.getFriendsChatTalkRank?.() ?? -1,
            kickRank: save.getFriendsChatKickRank?.() ?? 2,
            friends,
            ignores,
            friendRanks,
        };
    }
    static memberRank(profile, player) {
        if ((player.getRights()?.getId?.() ?? 0) > 0)
            return FriendsChatRank.JagexModerator;
        if (player.getLongUsername() === accountName(profile.ownerName)?.encoded)
            return FriendsChatRank.Owner;
        if (!profile.friends.has(player.getLongUsername()))
            return FriendsChatRank.Unranked;
        return profile.friendRanks.get(player.getLongUsername()) ?? FriendsChatRank.Friend;
    }
    static onlinePlayer(name) {
        const player = World.getPlayers().search((candidate) => accountName(candidate.getUsername())?.key === name.key) ?? undefined;
        return player && !this.offlinePlayerIds.has(player.getIndex()) ? player : undefined;
    }
    static refreshFriendWatchers(friend, excluded) {
        World.getPlayers().forEach((player) => {
            if (player && player !== excluded && !this.offlinePlayerIds.has(player.getIndex()) &&
                player.getRelations().hasFriend(friend)) {
                this.sendSnapshot(player);
            }
        });
    }
    static broadcastChannel(ownerKey) {
        const channel = this.channels.get(ownerKey);
        if (!channel)
            return;
        for (const member of channel.members.values())
            this.sendSnapshot(member);
    }
    static cleanMessage(value, maxLength) {
        return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, maxLength);
    }
    static allowChat(player, text) {
        if (PlayerPunishment.muted(player.getUsername()) || PlayerPunishment.IPMuted(player.getHostAddress())) {
            this.gameMessage(player, "You are muted and cannot chat.");
            return false;
        }
        if (Misc.blockedWord(text)) {
            this.gameMessage(player, "Your message did not make it past the filter.");
            return false;
        }
        return true;
    }
    static persist(player) {
        try {
            GameConstants.PLAYER_PERSISTENCE.requestSave(player, "clan-roster");
        }
        catch (error) {
            console.warn(`[social] failed to save ${player.getUsername()}`, error);
        }
    }
    static gameMessage(player, text) {
        player.sendMessage(text);
    }
    static notification(player, text) {
        player.getSession().sendClientPacket(encodeChatMessage("game", text, "", "", -1, FRIENDS_CHAT_NOTIFICATION_TYPE));
    }
}

module.exports = { FriendsChatManager, FriendsChatRank, CHAT_FILTERS_ATTRIBUTE, CLAN_CHAT_ATTRIBUTE };
