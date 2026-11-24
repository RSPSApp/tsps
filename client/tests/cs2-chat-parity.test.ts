import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeClientPacket } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { VARBIT_ROOF_REMOVAL } from "../common/vars";
import { state } from "../network/serverConnection/state";
import { chatHistory, isOverheadChatFiltered } from "../rs/cs2/ChatHistory";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerChatOps } from "../rs/cs2/handlers/ChatOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

const sent: any[] = [];
(globalThis as any).WebSocket = { OPEN: 1 };
state.socket = {
    readyState: 1,
    send: (packet: Uint8Array) => sent.push(decodeClientPacket(Buffer.from(packet))),
} as any;

const handlers: HandlerMap = new Map();
registerChatOps(handlers);

function makeCtx(extra: object = {}): any {
    const out: any[] = [];
    return {
        out,
        intStack: new Int32Array(8),
        intStackSize: 0,
        stringStack: [] as string[],
        stringStackSize: 0,
        friendList: [],
        ignoreList: [],
        chatTimestampMode: 0,
        messageFilter: "",
        pushInt: (v: number) => out.push(v),
        pushString: (v: string) => out.push(v),
        varManager: { setVarcString() {}, setVarbit() {} },
        ...extra,
    };
}
function run(ctx: any, opcode: number, ints: number[] = [], strings: string[] = []): any[] {
    ctx.out.length = 0;
    ints.forEach((v, i) => (ctx.intStack[i] = v));
    ctx.intStackSize = ints.length;
    ctx.stringStack = [...strings];
    ctx.stringStackSize = strings.length;
    handlers.get(opcode)!(ctx, 0, null as any);
    return [...ctx.out];
}

test("a chat line's friend/ignore value follows the lists as they are now", () => {
    const type = 2;
    const uid = chatHistory.addMessage(type, "hello", "<img=2>Bob Smith", "");
    const ctx = makeCtx();
    const status = () => [
        run(ctx, Opcodes.CHAT_GETHISTORY_BYTYPEANDLINE, [type, 0])[5],
        run(ctx, Opcodes.CHAT_GETHISTORY_BYUID, [uid])[5],
        run(ctx, Opcodes.CHAT_GETHISTORYEX_BYTYPEANDLINE, [type, 0])[5],
        run(ctx, Opcodes.CHAT_GETHISTORYEX_BYUID, [uid])[5],
    ];
    assert.deepEqual(status(), [0, 0, 0, 0]);
    // Befriended after the line arrived.
    ctx.friendList = [{ name: "bob_smith" }];
    assert.deepEqual(status(), [1, 1, 1, 1]);
    // Removed again, then ignored.
    ctx.friendList = [];
    ctx.ignoreList = [{ name: "Bob Smith" }];
    assert.deepEqual(status(), [2, 2, 2, 2]);
    ctx.ignoreList = [];
    assert.deepEqual(status(), [0, 0, 0, 0]);
    // A line with no sender (a game message) is never either.
    const game = chatHistory.addMessage(0, "Welcome");
    ctx.friendList = [{ name: "" }];
    assert.equal(run(ctx, Opcodes.CHAT_GETHISTORY_BYUID, [game])[5], 0);
});

test("the message filter hides other players' overhead text that does not contain it", () => {
    const ctx = makeCtx();
    run(ctx, Opcodes.CHAT_SETMESSAGEFILTER, [], ["  Selling "]);
    assert.equal(ctx.messageFilter, "selling");
    assert.equal(isOverheadChatFiltered(ctx.messageFilter, "Buying lobsters", false), true);
    assert.equal(isOverheadChatFiltered(ctx.messageFilter, "SELLING lobsters", false), false);
    assert.equal(isOverheadChatFiltered(ctx.messageFilter, "Buying lobsters", true), false, "never the local player's own");
    assert.equal(isOverheadChatFiltered("", "Buying lobsters", false), false, "no filter, nothing hidden");
});

test("docheat runs the client's own commands, then still sends the line", () => {
    const roofs: boolean[] = [];
    const varbits: [number, number][] = [];
    const osrsClient: any = {
        roofsHidden: false,
        renderSelf: true,
        showMouseOverText: true,
        setRoofsHidden(hidden: boolean) { this.roofsHidden = hidden; roofs.push(hidden); },
    };
    const ctx = makeCtx({
        widgetManager: { osrsClient },
        varManager: { setVarcString() {}, setVarbit: (id: number, value: number) => varbits.push([id, value]) },
    });
    const console99 = () => chatHistory.getByTypeAndLine(99, 0);

    sent.length = 0;
    run(ctx, Opcodes.DOCHEAT, [], ["ToggleRoof"]);
    assert.deepEqual(roofs, [true]);
    assert.deepEqual(varbits, [[VARBIT_ROOF_REMOVAL, 1]]);
    assert.equal(console99(), "Roofs are now all hidden");
    run(ctx, Opcodes.DOCHEAT, [], ["toggleroof"]);
    assert.deepEqual(roofs, [true, false]);
    assert.equal(console99(), "Roofs will only be removed selectively");

    run(ctx, Opcodes.DOCHEAT, [], ["renderself"]);
    assert.equal(osrsClient.renderSelf, false);
    run(ctx, Opcodes.DOCHEAT, [], ["renderself"]);
    assert.equal(osrsClient.renderSelf, true);

    run(ctx, Opcodes.DOCHEAT, [], ["mouseovertext"]);
    assert.equal(osrsClient.showMouseOverText, false);

    // Anything else changes nothing here.
    run(ctx, Opcodes.DOCHEAT, [], ["toggleroofs"]);
    assert.deepEqual(roofs, [true, false]);

    assert.deepEqual(
        sent.map((packet) => packet.text),
        ["::ToggleRoof", "::toggleroof", "::renderself", "::renderself", "::mouseovertext", "::toggleroofs"],
        "every command still reaches the server",
    );
});

test("chat_sendclan sends a line for any clan the player belongs to", () => {
    const ctx = makeCtx();
    const send = (chatType: number, clanType: number, text = "hi") => {
        sent.length = 0;
        run(ctx, Opcodes.CHAT_SENDCLAN, [chatType, clanType], [text]);
        return sent[0];
    };
    assert.deepEqual(send(3, 0), { type: "clan_chat", clanType: 0, text: "hi" });
    assert.equal(send(3, 1), undefined, "a Group Ironman group line stays unsent: the server would double its | mark");
    assert.deepEqual(send(3, 2), { type: "clan_chat", clanType: 2, text: "hi" });
    assert.deepEqual(send(4, 0), { type: "clan_chat", clanType: -1, text: "hi" }, "the guest clan");
    assert.equal(send(3, 1, "   "), undefined, "an empty line is not sent");
    assert.equal(send(2, -1), undefined, "the legacy chat channel does not use this instruction");
});
