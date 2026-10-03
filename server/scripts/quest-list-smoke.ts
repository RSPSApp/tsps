import * as assert from "node:assert/strict";
import { encodeWidgetSetQuestList } from "../src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { ServerPacketId } from "../src/main/typescript/elvarg/net/protocol/ServerPackets";

// Shape mirrors the client's ServerBinaryDecoder WIDGET_SET_QUEST_LIST branch.
// Slot 0 is reserved for the group header row (the client draws the title at
// firstQuestSlot - 1), so quest rows begin at slot 1.
const groups = [
    {
        title: "Free Quests",
        quests: [
            { slot: 1, status: 2, key: "cooks_assistant", displayName: "Cook's Assistant" },
            { slot: 2, status: 1, key: "sheep_shearer", displayName: "Sheep Shearer" },
        ],
    },
];

const packet = encodeWidgetSetQuestList(groups);
let offset = 0;

assert.equal(packet[offset++], ServerPacketId.WIDGET_SET_QUEST_LIST, "opcode");
const length = packet.readUInt16BE(offset);
offset += 2;
assert.equal(length, packet.length - 3, "short length prefix covers the payload");

const readString = () => {
    const end = packet.indexOf(0, offset);
    assert.ok(end >= offset, "unterminated string");
    const value = packet.subarray(offset, end).toString("latin1");
    offset = end + 1;
    return value;
};

assert.equal(packet.readUInt16BE(offset), 1, "group count");
offset += 2;
assert.equal(readString(), "Free Quests");

assert.equal(packet.readUInt16BE(offset), 2, "quest count");
offset += 2;
for (const expected of groups[0].quests) {
    assert.equal(packet.readUInt16BE(offset), expected.slot, "slot");
    offset += 2;
    assert.equal(packet[offset++], expected.status, "status");
    assert.equal(readString(), expected.key, "key");
    assert.equal(readString(), expected.displayName, "displayName");
}
assert.equal(offset, packet.length, "no trailing bytes");

console.info("quest list smoke passed");
