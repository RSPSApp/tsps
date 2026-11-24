import { strict as assert } from "node:assert";

import { LOCAL_WORLD, cleanPlayerName, orderSocialSnapshot, socialSort } from "../rs/cs2/SocialSort";
import { registerSocialOps } from "../rs/cs2/handlers/SocialOps";
import { registerUnsupportedOps } from "../rs/cs2/handlers/UnsupportedOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

// The friend (3628-3639, 3656), ignore (3640-3643) and friends chat (3644-3655, 3657) sort
// instructions: each rule instruction adds a rule behind the ones set, "sort" re-orders the list
// the getters read.
const handlers: HandlerMap = new Map();
registerSocialOps(handlers);
registerUnsupportedOps(handlers);

const ctx: any = {
    intStack: new Int32Array(8),
    intStackSize: 0,
    stringStack: [] as string[],
    stringStackSize: 0,
    friendList: [] as any[],
    ignoreList: [] as any[],
    clanMembers: [] as any[],
    pushed: [] as number[],
    pushInt(value: number) { this.pushed.push(value); },
};
function op(opcode: number, flag?: boolean): void {
    if (flag !== undefined) ctx.intStack[ctx.intStackSize++] = flag ? 1 : 0;
    handlers.get(opcode)!(ctx, 0, null as any);
    assert.equal(ctx.intStackSize, 0, `opcode ${opcode} leaves the int stack balanced`);
}
const names = (list: { name: string }[]) => list.map((entry) => entry.name);
const friend = (name: string, world: number, rank = 0) => ({ name, previousName: "", world, rank, isOnline: world !== 0 });

function reset(): void {
    socialSort.friends.reset();
    socialSort.ignores.reset();
    socialSort.friendsChat.reset();
}

// Names compare in their clean form.
assert.equal(cleanPlayerName(" Zezi-Ma_x "), "zezi_ma_x");
assert.equal(cleanPlayerName("Élan"), "elan");
assert.equal(cleanPlayerName("thirteen chars"), null);

// --- friends ---
reset();
{
    const lists = orderSocialSnapshot(
        [friend("delta", 0), friend("Charlie", 302), friend("bravo", LOCAL_WORLD), friend("Alpha", 0), friend("echo", 302)],
        [],
        null,
    );
    ctx.friendList = lists.friends;
    // With no rule the list orders itself: this world, then online, then offline; arrival order inside each.
    assert.deepEqual(names(ctx.friendList), ["bravo", "Charlie", "echo", "delta", "Alpha"]);

    // By name, ascending then descending (3630).
    op(3628); op(3630, true); op(3639);
    assert.deepEqual(names(ctx.friendList), ["Alpha", "bravo", "Charlie", "delta", "echo"]);
    op(3628); op(3630, false); op(3639);
    assert.deepEqual(names(ctx.friendList), ["echo", "delta", "Charlie", "bravo", "Alpha"]);

    // Online first, then by world, then by name (3633, 3631, 3630).
    op(3628); op(3633, true); op(3631, true); op(3630, true); op(3639);
    assert.deepEqual(names(ctx.friendList), ["bravo", "Charlie", "echo", "Alpha", "delta"]);

    // Same world first, the rest by name descending (3636, 3630).
    op(3628); op(3636, true); op(3630, false); op(3639);
    assert.deepEqual(names(ctx.friendList), ["bravo", "echo", "delta", "Charlie", "Alpha"]);

    // A name rule always decides, so a rule added after it has no say.
    op(3628); op(3630, true); op(3633, true); op(3639);
    assert.deepEqual(names(ctx.friendList), ["Alpha", "bravo", "Charlie", "delta", "echo"]);

    // The rules stay for the next list from the server, which is ordered on arrival.
    op(3628); op(3630, true); op(3639);
    ctx.friendList = orderSocialSnapshot(
        [friend("delta", 0), friend("Charlie", 302), friend("bravo", LOCAL_WORLD), friend("Alpha", 303), friend("echo", 302)],
        [],
        null,
    ).friends;
    assert.deepEqual(names(ctx.friendList), ["Alpha", "bravo", "Charlie", "delta", "echo"]);

    // Last world change, newest first among online friends (3635 false): Alpha just logged in.
    op(3628); op(3633, true); op(3635, false); op(3630, true); op(3639);
    assert.deepEqual(names(ctx.friendList), ["Alpha", "echo", "bravo", "Charlie", "delta"]);

    // By rank, highest first, names breaking ties (3656).
    ctx.friendList = orderSocialSnapshot(
        [friend("a", 0, 1), friend("b", 0, 3), friend("c", 0, 3), friend("d", 0, 2)],
        [],
        null,
    ).friends;
    op(3628); op(3656, false); op(3630, true); op(3639);
    assert.deepEqual(names(ctx.friendList), ["b", "c", "d", "a"]);
}

// --- ignores ---
reset();
{
    ctx.ignoreList = orderSocialSnapshot([], [{ name: "mike" }, { name: "Zed" }, { name: "adam" }], null).ignores;
    assert.deepEqual(names(ctx.ignoreList), ["mike", "Zed", "adam"], "arrival order until a script sorts");
    op(3640); op(3642, true); op(3643);
    assert.deepEqual(names(ctx.ignoreList), ["adam", "mike", "Zed"]);
    op(3640); op(3642, false); op(3643);
    assert.deepEqual(names(ctx.ignoreList), ["Zed", "mike", "adam"]);
    // 3641 is arrival order (true) or its reverse.
    op(3640); op(3641, false); op(3643);
    assert.deepEqual(names(ctx.ignoreList), ["adam", "Zed", "mike"]);
    op(3640); op(3641, true); op(3643);
    assert.deepEqual(names(ctx.ignoreList), ["mike", "Zed", "adam"]);
}

// --- friends chat ---
reset();
{
    const member = (name: string, world: number, rank: number) => ({ name, world, rank });
    ctx.clanMembers = orderSocialSnapshot(
        [],
        [],
        [member("zoe", 302, 1), member("Bob", LOCAL_WORLD, 7), member("amy", 302, 3), member("Cat", LOCAL_WORLD, 3)],
    ).members;
    assert.deepEqual(names(ctx.clanMembers), ["amy", "Bob", "Cat", "zoe"], "by name when no rule is set");

    // By rank descending, then name (3657, 3646).
    op(3644); op(3657, false); op(3646, true); op(3655);
    assert.deepEqual(names(ctx.clanMembers), ["Bob", "amy", "Cat", "zoe"]);

    // Same world first (3652), then world (3647), then name descending (3646).
    op(3644); op(3652, true); op(3647, true); op(3646, false); op(3655);
    assert.deepEqual(names(ctx.clanMembers), ["Cat", "Bob", "zoe", "amy"]);

    // Last world change, oldest first (3648): the order they were first seen in.
    op(3644); op(3648, true); op(3655);
    assert.deepEqual(names(ctx.clanMembers), ["zoe", "Bob", "amy", "Cat"]);

    // Leaving the channel forgets its rules.
    orderSocialSnapshot([], [], null);
    ctx.clanMembers = orderSocialSnapshot([], [], [member("zoe", 302, 1), member("amy", 302, 3)]).members;
    assert.deepEqual(names(ctx.clanMembers), ["amy", "zoe"]);
}

// --- friend_test / ignore_test (3609 / 3623) ---
reset();
{
    ctx.friendList = [friend("Mod Ash", 0), friend("iron_man-btw", 0)];
    ctx.ignoreList = [{ name: "Spam Bot" }];
    const test = (opcode: number, name: string): number => {
        ctx.pushed = [];
        ctx.stringStack[0] = name;
        ctx.stringStackSize = 1;
        handlers.get(opcode)!(ctx, 0, null as any);
        assert.equal(ctx.stringStackSize, 0);
        return ctx.pushed[0];
    };
    assert.equal(test(3609, "<img=1>Mod Ash"), 1, "a rank icon before the name is ignored");
    assert.equal(test(3609, "mod_ash"), 1, "underscore reads as space, case does not matter");
    assert.equal(test(3609, "Iron Man Btw"), 1);
    assert.equal(test(3609, "<img=1>Mod Ashh"), 0);
    assert.equal(test(3609, ""), 0);
    assert.equal(test(3623, "<img=41>spam-bot"), 1);
    assert.equal(test(3623, "Mod Ash"), 0);
}

console.log("cs2-social-sort: ok");
