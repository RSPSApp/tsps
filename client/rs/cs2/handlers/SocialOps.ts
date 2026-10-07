/**
 * Social operations: Friends, Ignore, Clan chat
 */
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

export function registerSocialOps(handlers: HandlerMap): void {
    // === Friends ===
    handlers.set(Opcodes.FRIEND_COUNT, (ctx) => {
        ctx.pushInt(ctx.friendList.length);
    });

    handlers.set(Opcodes.FRIEND_GETNAME, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const friend = ctx.friendList[index];
        if (friend) {
            ctx.pushString(friend.name);
            ctx.pushString(friend.previousName || friend.name);
        } else {
            ctx.pushString("");
            ctx.pushString("");
        }
    });

    handlers.set(Opcodes.FRIEND_GETWORLD, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const friend = ctx.friendList[index];
        // Return 0 if offline, otherwise the world number
        ctx.pushInt(friend?.isOnline ? friend.world : 0);
    });

    handlers.set(Opcodes.FRIEND_GETRANK, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const friend = ctx.friendList[index];
        ctx.pushInt(friend?.rank ?? 0);
    });

    handlers.set(Opcodes.FRIEND_SETRANK, (ctx) => {
        const rank = ctx.intStack[--ctx.intStackSize];
        const name = ctx.stringStack[--ctx.stringStackSize];
        ctx.sendFriendsChatAction?.({ action: "set_friend_rank", name, rank });
    });

    handlers.set(Opcodes.FRIEND_ADD, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        ctx.sendFriendsChatAction?.({ action: "add_friend", name });
    });

    handlers.set(Opcodes.FRIEND_DEL, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        ctx.sendFriendsChatAction?.({ action: "remove_friend", name });
    });

    handlers.set(Opcodes.FRIEND_TEST, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        const isFriend = ctx.friendList.some((f) => f.name.toLowerCase() === name.toLowerCase());
        ctx.pushInt(isFriend ? 1 : 0);
    });

    // === Friend Sorting ===
    handlers.set(Opcodes.FRIEND_SORT_CLEAR, () => {
        /* no-op */
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_NAME, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_WORLD, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_RANK, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_NAME_LEGACY, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_5, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_6, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_7, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_8, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_9, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_ADD_10, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIEND_SORT_APPLY, () => {
        /* no-op */
    });

    // === Ignore ===
    handlers.set(Opcodes.IGNORE_COUNT, (ctx) => {
        ctx.pushInt(ctx.ignoreList.length);
    });

    handlers.set(Opcodes.IGNORE_GETNAME, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const ignored = ctx.ignoreList[index];
        if (ignored) {
            ctx.pushString(ignored.name);
            ctx.pushString(ignored.previousName || ignored.name);
        } else {
            ctx.pushString("");
            ctx.pushString("");
        }
    });

    handlers.set(Opcodes.IGNORE_ADD, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        ctx.sendFriendsChatAction?.({ action: "add_ignore", name });
    });

    handlers.set(Opcodes.IGNORE_DEL, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        ctx.sendFriendsChatAction?.({ action: "remove_ignore", name });
    });

    handlers.set(Opcodes.IGNORE_TEST, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        const isIgnored = ctx.ignoreList.some((i) => i.name.toLowerCase() === name.toLowerCase());
        ctx.pushInt(isIgnored ? 1 : 0);
    });

    // === Ignore Sorting ===
    handlers.set(Opcodes.IGNORE_SORT_CLEAR, () => {
        /* no-op */
    });
    handlers.set(Opcodes.IGNORE_SORT_ADD_NAME, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.IGNORE_SORT_ADD_2, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.IGNORE_SORT_APPLY, () => {
        /* no-op */
    });

    // === Clan chat (legacy friends chat / clan chat system) ===
    handlers.set(Opcodes.CLAN_GETCHATDISPLAYNAME, (ctx) => {
        ctx.pushString(ctx.clanName);
    });

    handlers.set(Opcodes.CLAN_GETCHATCOUNT, (ctx) => {
        ctx.pushInt(ctx.clanMembers.length);
    });

    handlers.set(Opcodes.CLAN_GETCHATUSERNAME, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const member = ctx.clanMembers[index];
        ctx.pushString(member?.name ?? "");
    });

    handlers.set(Opcodes.CLAN_GETCHATUSERWORLD, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const member = ctx.clanMembers[index];
        ctx.pushInt(member?.world ?? 0);
    });

    handlers.set(Opcodes.CLAN_GETCHATUSERRANK, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const member = ctx.clanMembers[index];
        ctx.pushInt(member?.rank ?? 0);
    });

    handlers.set(Opcodes.CLAN_GETCHATMINKICK, (ctx) => {
        ctx.pushInt(ctx.friendsChatMinKick);
    });

    handlers.set(Opcodes.CLAN_KICKUSER, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        ctx.sendFriendsChatAction?.({ action: "kick", name });
    });

    handlers.set(Opcodes.CLAN_GETCHATRANK, (ctx) => {
        // Current player's rank in the clan
        ctx.pushInt(ctx.clanRank);
    });

    handlers.set(Opcodes.CLAN_JOINCHAT, (ctx) => {
        const name = ctx.stringStack[--ctx.stringStackSize];
        ctx.sendFriendsChatAction?.({ action: "join", name });
    });

    handlers.set(Opcodes.CLAN_LEAVECHAT, (ctx) => {
        ctx.sendFriendsChatAction?.({ action: "leave" });
    });

    handlers.set(Opcodes.CLAN_ISSELF, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const member = ctx.clanMembers[index];
        // Check if this clan member is the local player
        const isSelf = member?.name.toLowerCase() === ctx.localPlayerName?.toLowerCase();
        ctx.pushInt(isSelf ? 1 : 0);
    });

    handlers.set(Opcodes.CLAN_GETCHATOWNERNAME, (ctx) => {
        ctx.pushString(ctx.clanOwner);
    });

    handlers.set(Opcodes.CLAN_ISFRIEND, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const member = ctx.clanMembers[index];
        if (member) {
            const isFriend = ctx.friendList.some(
                (f) => f.name.toLowerCase() === member.name.toLowerCase(),
            );
            ctx.pushInt(isFriend ? 1 : 0);
        } else {
            ctx.pushInt(0);
        }
    });

    handlers.set(Opcodes.CLAN_ISIGNORE, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const member = ctx.clanMembers[index];
        if (member) {
            const isIgnored = ctx.ignoreList.some(
                (i) => i.name.toLowerCase() === member.name.toLowerCase(),
            );
            ctx.pushInt(isIgnored ? 1 : 0);
        } else {
            ctx.pushInt(0);
        }
    });

    // === Clan Sorting ===
    handlers.set(Opcodes.CLAN_SORT_CLEAR, () => {
        /* no-op */
    });
    handlers.set(Opcodes.CLAN_SORT_ADD_NAME, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.CLAN_SORT_ADD_RANK, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.CLAN_SORT_ADD_WORLD, (ctx) => {
        ctx.intStackSize--;
    });
    handlers.set(Opcodes.FRIENDLIST_SORT_RANK, (ctx) => {
        ctx.intStackSize--; // ascending
    });

    // === Friends Chat Sorting (different from friend list sorting) ===
    handlers.set(Opcodes.FRIENDSCHAT_SORT_ADD, (ctx) => {
        ctx.intStackSize--; // pop ascending boolean
        /* no-op - add comparator to friends chat */
    });
    handlers.set(Opcodes.FRIENDSCHAT_SORT, () => {
        /* no-op - sort friends chat */
    });
    handlers.set(Opcodes.FRIENDSCHAT_SORT_ADD_RANK, (ctx) => {
        ctx.intStackSize--; // pop ascending boolean
        /* no-op - add rank comparator to friends chat */
    });

    // === Clan Profile ===
    handlers.set(Opcodes.CLANPROFILE_FIND, (ctx) => {
        ctx.pushInt(0); // not found
    });
}
