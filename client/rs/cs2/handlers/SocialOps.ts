/**
 * Social operations: Friends, Ignore, Clan chat
 */
import { Opcodes } from "../Opcodes";
import { listHasPlayer, socialSort, type SocialSortList, type SocialSortRule } from "../SocialSort";
import type { HandlerContext, HandlerMap } from "./HandlerTypes";

/**
 * The sort instructions of one list: `clear` forgets the rules, each rule instruction pops a
 * direction flag and adds its rule behind the ones already set, `sort` re-orders the list.
 */
function registerSortOps(
    handlers: HandlerMap,
    sorter: SocialSortList<any>,
    list: (ctx: HandlerContext) => any[],
    clear: number,
    sort: number,
    rules: [opcode: number, rule: SocialSortRule][],
): void {
    handlers.set(clear, () => sorter.clearRules());
    for (const [opcode, rule] of rules) {
        handlers.set(opcode, (ctx) => {
            sorter.addRule(rule, ctx.intStack[--ctx.intStackSize] === 1);
        });
    }
    handlers.set(sort, (ctx) => {
        sorter.sort(list(ctx));
    });
}

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
            ctx.pushString(friend.previousName);
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
        // The name may come from a chat line, where a rank icon tag leads it; names match in
        // their cleaned form (case, accents and space/underscore/hyphen do not matter).
        const name = ctx.stringStack[--ctx.stringStackSize];
        const isFriend = listHasPlayer(ctx.friendList, name);
        ctx.pushInt(isFriend ? 1 : 0);
    });

    // === Friend sorting (3628-3639, 3656) ===
    registerSortOps(handlers, socialSort.friends, (ctx) => ctx.friendList, 3628, 3639, [
        [3629, "natural"],
        [3630, "name"],
        [3631, "world"],
        [3632, "worldChange"],
        [3633, "online"],
        [3634, "onlineName"],
        [3635, "onlineWorldChange"],
        [3636, "sameWorld"],
        [3637, "sameWorldName"],
        [3638, "sameWorldChange"],
        [3656, "rank"],
    ]);

    // === Ignore ===
    handlers.set(Opcodes.IGNORE_COUNT, (ctx) => {
        ctx.pushInt(ctx.ignoreList.length);
    });

    handlers.set(Opcodes.IGNORE_GETNAME, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const ignored = ctx.ignoreList[index];
        if (ignored) {
            ctx.pushString(ignored.name);
            ctx.pushString(ignored.previousName);
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
        const isIgnored = listHasPlayer(ctx.ignoreList, name);
        ctx.pushInt(isIgnored ? 1 : 0);
    });

    // === Ignore sorting (3640-3643) ===
    registerSortOps(handlers, socialSort.ignores, (ctx) => ctx.ignoreList, 3640, 3643, [
        [3641, "natural"],
        [3642, "name"],
    ]);

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

    // === Friends chat member sorting (3644-3655, 3657) ===
    registerSortOps(handlers, socialSort.friendsChat, (ctx) => ctx.clanMembers, 3644, 3655, [
        [3645, "natural"],
        [3646, "name"],
        [3647, "world"],
        [3648, "worldChange"],
        [3649, "online"],
        [3650, "onlineName"],
        [3651, "onlineWorldChange"],
        [3652, "sameWorld"],
        [3653, "sameWorldName"],
        [3654, "sameWorldChange"],
        [3657, "rank"],
    ]);
}
