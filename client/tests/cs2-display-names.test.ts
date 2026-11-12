import assert from "node:assert/strict";
import { test } from "node:test";

import { createHandlerMap } from "../rs/cs2/handlers";
import { acceptDisplayNameReply, resetDisplayNames } from "../rs/cs2/handlers/DisplayNameOps";
import { emitPluginMessage } from "../network/serverConnection/domain/pluginMessages";
import { state } from "../network/serverConnection/state";

/** A minimal stack context, as the other cs2 op tests use. */
function stacks() {
    const ints: number[] = [];
    const strings: any[] = [];
    const ctx: any = {
        pushInt: (v: number) => ints.push(v | 0),
        popInt: () => ints.pop()!,
        pushString: (v: any) => strings.push(v),
        popString: () => strings.pop(),
        get intStack() { return ints; },
        get stringStack() { return strings; },
        get intStackSize() { return ints.length; },
        set intStackSize(n: number) { ints.length = n; },
        get stringStackSize() { return strings.length; },
        set stringStackSize(n: number) { strings.length = n; },
    };
    return { ctx, ints, strings };
}

/** Captures what goes over the socket, as text (plugin messages carry JSON). */
function socket() {
    const sent: string[] = [];
    (state as any).socket = { readyState: 1, send: (bytes: Uint8Array) => sent.push(Buffer.from(bytes).toString("latin1")) };
    return sent;
}

test("display name requests go to the server on the display-names channel and are pending until it answers", () => {
    resetDisplayNames();
    const handlers = createHandlerMap();
    const sent = socket();
    const s = stacks();
    s.strings.push("Zezima");
    handlers.get(5102)!(s.ctx, 0); // displaynames_check
    assert.equal(s.strings.length, 0, "the name is taken off the stack");
    assert.equal(sent.length, 1);
    assert.ok(sent[0].includes("display-names") && sent[0].includes('"op":"check"') && sent[0].includes('"name":"Zezima"'));

    handlers.get(5103)!(s.ctx, 0); // displaynames_check_result
    assert.deepEqual(s.ints, [1, 0, 0, 0, 0, 0], "state 1: Checking...");
    assert.deepEqual(s.strings, [""]);

    handlers.get(5100)!(stacks().ctx, 0); // displaynames_status
    assert.ok(sent[1].includes('"op":"status"'));
});

test("each result op returns the latest reply, polled as often as the scripts like", () => {
    resetDisplayNames();
    const handlers = createHandlerMap();
    const read = (opcode: number) => { const s = stacks(); handlers.get(opcode)!(s.ctx, 0); return s; };
    assert.deepEqual(read(5101).ints, [0, 0, 0, 0, 0], "no session before any reply");

    emitPluginMessage({ channel: "display-names", data: { op: "status", result: [200, 0, "", false, -1, 600] } } as any);
    for (let poll = 0; poll < 3; poll++) {
        const s = read(5101);
        assert.deepEqual([s.ints, s.strings], [[200, 0, 0, -1, 600], [""]]);
    }
    acceptDisplayNameReply({ op: "check", result: [200, 0, "", 0, true, 1, -1] });
    assert.deepEqual(read(5103).ints, [200, 0, 0, 1, 1, -1]);
    acceptDisplayNameReply({ op: "claim", result: [403, 7, "Not now"] });
    const claim = read(5105);
    assert.deepEqual([claim.ints, claim.strings], [[403, 7, 0], ["Not now"]], "missing trailing values are neutral");
    emitPluginMessage({ channel: "other", data: { op: "status", result: [0] } } as any);
    assert.equal(read(5101).ints[0], 200, "other channels are ignored");
});
