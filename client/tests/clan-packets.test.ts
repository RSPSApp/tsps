import assert from "assert";

import {
    encodeClanChannelDelta,
    encodeClanChannelFull,
    encodeClanSettingsDelta,
    encodeClanSettingsFull,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { applyClanChannelDelta, applyClanSettingsDelta } from "../common/social/Clans";
import { registerClanOps } from "../rs/cs2/handlers/ClanOps";
import { Opcodes } from "../rs/cs2/Opcodes";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

function decode(packet: Buffer): any {
    return decodeServerPacket(new Uint8Array(packet));
}

const settings = decode(
    encodeClanSettingsFull(0, {
        updateNum: 3,
        creationTime: 8700,
        name: "Blur",
        allowGuests: true,
        talkRank: -1,
        kickRank: 100,
        ownerSlot: 1,
        replacementOwnerSlot: 0xffff,
        members: [
            { name: "Zed", rank: 0, extraInfo: 7, joinRuneDay: 8715, muted: true },
            { name: "Amy", rank: 126, extraInfo: 0, joinRuneDay: 8700, muted: false },
        ],
        banned: ["Bad"],
        settings: [{ id: 6, value: 350 }],
    }),
);
assert.equal(settings.type, "clan_settings");
assert.equal(settings.payload.clanType, 0);
const own = settings.payload.settings;
assert.equal(own.name, "Blur");
assert.equal(own.rankTalk, -1, "anyone may talk");
assert.equal(own.rankKick, 100);
assert.equal(own.currentOwnerSlot, 1);
assert.equal(own.replacementOwnerSlot, -1, "no replacement owner");
assert.deepEqual(own.memberNames, ["Zed", "Amy"]);
assert.deepEqual(own.memberRanks, [0, 126]);
assert.deepEqual(own.memberMuted, [true, false]);
assert.deepEqual(own.memberExtraInfo, [7, 0]);
assert.deepEqual(own.memberJoinDays, [8715, 8700]);
assert.deepEqual(own.bannedNames, ["Bad"]);
assert.equal(own.parameters.get(6), 350);

assert.deepEqual(decode(encodeClanSettingsFull(0, null)).payload, { clanType: 0, settings: null });
assert.deepEqual(decode(encodeClanChannelFull(0, null)).payload, { clanType: 0, channel: null });

const settingsDelta = decode(
    encodeClanSettingsDelta(0, 4, [
        { type: "add_member", name: "Bob", joinRuneDay: 8720 },
        { type: "member_rank", index: 0, rank: 115 },
        { type: "member_muted", index: 0, muted: false },
        { type: "member_extra_info", index: 1, value: 1835, startBit: 0, endBit: 12 },
        { type: "int_setting", setting: 8, value: 8715 },
        { type: "delete_member", index: 1 },
    ]),
);
assert.equal(settingsDelta.type, "clan_settings_delta");
const changed = applyClanSettingsDelta(own, settingsDelta.payload.updates);
assert.deepEqual(changed.memberNames, ["Zed", "Bob"]);
assert.deepEqual(changed.memberRanks, [115, 0]);
assert.deepEqual(changed.memberMuted, [false, false]);
assert.deepEqual(changed.memberJoinDays, [8715, 8720]);
assert.equal(changed.parameters?.get(8), 8715);
assert.deepEqual(own.memberNames, ["Zed", "Amy"], "the old settings are not changed");
const extra = applyClanSettingsDelta(own, [{ type: "member_extra_info", index: 0, value: 3, startBit: 1, endBit: 2 }]);
assert.equal(extra.memberExtraInfo[0], 7, "only its own bits");

const channel = decode(
    encodeClanChannelFull(0, {
        key: 9,
        updateNum: 1,
        name: "Blur",
        talkRank: -1,
        kickRank: 100,
        users: [
            { name: "Amy", rank: 126, world: 1 },
            { name: "Zed", rank: 0, world: 1 },
        ],
    }),
).payload.channel;
assert.deepEqual(channel.userNames, ["Amy", "Zed"]);
assert.deepEqual(channel.userRanks, [126, 0]);

const delta = decode(
    encodeClanChannelDelta(0, 9, 2, [
        { type: "delete", index: 0 },
        { type: "add", user: { name: "Bob", rank: 10, world: 1 } },
    ]),
);
assert.equal(delta.type, "clan_channel_delta");
const applied = applyClanChannelDelta(channel, delta.payload)!;
assert.deepEqual(applied.userNames, ["Zed", "Bob"]);
assert.deepEqual(applied.userRanks, [0, 10]);
assert.equal(applied.updateNum, 2);
assert.deepEqual(channel.userNames, ["Amy", "Zed"], "the old channel is not changed");
assert.equal(applyClanChannelDelta(channel, { ...delta.payload, key: 8 }), channel, "another clan's delta");
assert.equal(applyClanChannelDelta(undefined, delta.payload), undefined);

// find_affined(0) is the player's clan, find_listened the guest one, and a group clan is neither.
const handlers: HandlerMap = new Map();
registerClanOps(handlers);
const context: any = { own: own, guest: null, listened: false };
function run(opcode: number, stack: number[] = []): number {
    const ctx: any = {
        intStack: Int32Array.from([...stack, 0]),
        intStackSize: stack.length,
        pushInt(value: number) {
            ctx.intStack[ctx.intStackSize++] = value;
        },
        get clanSettings() {
            return context.listened ? context.guest : context.own;
        },
        selectClanSettings(listened: boolean) {
            context.listened = listened;
        },
    };
    handlers.get(opcode)!(ctx, 0, null as any);
    return ctx.intStack[ctx.intStackSize - 1];
}
assert.equal(run(Opcodes.ACTIVECLANSETTINGS_FIND_AFFINED, [0]), 1);
assert.equal(run(Opcodes.ACTIVECLANSETTINGS_FIND_AFFINED, [1]), 0);
assert.equal(run(Opcodes.ACTIVECLANSETTINGS_FIND_LISTENED), 0);
assert.equal(context.listened, true);
assert.equal(run(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDCOUNT), 0, "the guest clan, which is empty");
assert.equal(run(Opcodes.ACTIVECLANSETTINGS_FIND_AFFINED, [0]), 1);
assert.equal(run(Opcodes.ACTIVECLANSETTINGS_GETAFFINEDCOUNT), 2);

console.log("clan-packets: ok");
