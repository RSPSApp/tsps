import assert from "node:assert/strict";
import { ClientState } from "../game/ClientState";
import { buildPlayerActionEntries } from "../render/render/interact/playerMenu";

// The player right-click menu always offers Follow in OPPLAYER3 and it sits below
// Walk here (the server sends Follow without priority, like live OSRS).
const calls: Array<[string, number]> = [];
const actions = {
    option: (serverId: number, slot: number) => calls.push([`option${slot}`, serverId]),
    follow: (serverId: number) => calls.push(["follow", serverId]),
    trade: (serverId: number) => calls.push(["trade", serverId]),
    attack: (serverId: number) => calls.push(["attack", serverId]),
};
const entries = buildPlayerActionEntries({
    sid: 42,
    playerLabel: "Bob",
    targetCombatLevel: 3,
    localCombatLevel: 3,
    targetTeam: 0,
    localTeam: 0,
    targetIsClanMember: false,
    canAttackPlayers: false,
    localX: 10,
    localY: 12,
    actions,
});
const follow = entries.find((entry) => entry.option === "Follow");
const trade = entries.find((entry) => entry.option === "Trade with");
assert.ok(follow, "players must have a Follow option");
assert.ok(trade, "players keep Trade with");
assert.equal(follow.actionIndex, 2, "Follow is OPPLAYER3");
assert.equal(follow.deprioritized, true, "Follow stays below Walk here");
assert.equal(trade.actionIndex, 1, "Trade with is OPPLAYER2");
assert.equal(follow.onClick !== undefined, true);

follow.onClick?.();
assert.deepEqual(calls, [["follow", 42]], "clicking Follow starts the client follow state");

// A server-sent Follow option keeps its own priority and opcode.
const previous = new Map(ClientState.playerOptions);
try {
    ClientState.playerOptions.set(3, { option: "Follow", priority: true, opcode: 46 });
    const sent = buildPlayerActionEntries({
        sid: 7, playerLabel: "Alice", targetCombatLevel: 3, localCombatLevel: 3,
        targetTeam: 0, localTeam: 0, targetIsClanMember: false, canAttackPlayers: false,
        localX: 1, localY: 1, actions,
    }).find((entry) => entry.option === "Follow");
    assert.ok(sent);
    assert.equal(sent.actionIndex, 2);
    assert.equal(sent.opcode, 46, "the server's opcode is carried through");
    assert.equal(sent.deprioritized, false, "a prioritised server option stays prioritised");
} finally {
    ClientState.playerOptions.clear();
    for (const [slot, option] of previous) ClientState.playerOptions.set(slot, option);
}

console.log("player follow menu test passed");
