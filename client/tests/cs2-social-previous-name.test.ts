import { strict as assert } from "node:assert";

import { Opcodes } from "../rs/cs2/Opcodes";
import { registerSocialOps } from "../rs/cs2/handlers/SocialOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

// friend_getname / ignore_getname push (name, previousName). Scripts 125, 129 and 1664 show
// "Previous name:" whenever the second string is non-empty, so an account that never changed
// its name must push "" (#2820), not its current name.
const handlers: HandlerMap = new Map();
registerSocialOps(handlers);

function getName(opcode: number, list: "friendList" | "ignoreList", entry: object): string[] {
    const ctx: any = {
        intStack: Int32Array.from([0, 0]),
        intStackSize: 1,
        friendList: [],
        ignoreList: [],
        pushed: [] as string[],
        pushString(s: string) { this.pushed.push(s); },
    };
    ctx[list] = [entry];
    handlers.get(opcode)!(ctx, 0, null as any);
    return ctx.pushed;
}

assert.deepEqual(getName(Opcodes.FRIEND_GETNAME, "friendList", { name: "Fresh", previousName: "" }), ["Fresh", ""]);
assert.deepEqual(getName(Opcodes.FRIEND_GETNAME, "friendList", { name: "New", previousName: "Old" }), ["New", "Old"]);
assert.deepEqual(getName(Opcodes.IGNORE_GETNAME, "ignoreList", { name: "Fresh", previousName: "" }), ["Fresh", ""]);
assert.deepEqual(getName(Opcodes.IGNORE_GETNAME, "ignoreList", { name: "New", previousName: "Old" }), ["New", "Old"]);

console.log("cs2-social-previous-name: ok");
