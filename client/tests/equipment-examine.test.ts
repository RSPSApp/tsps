import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chatHistory } from "../rs/cs2/ChatHistory";

// Worn equipment (387): the slot layer holds the Examine op, the item sits in a CC_CREATE child.
async function main() {
    (globalThis as any).self = globalThis;
    require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
    for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
    const { OsrsClient } = await import("../game/OsrsClient");
    const slot = { uid: (387 << 16) | 15, fileId: 15, itemId: -1 };
    const children = [{ fileId: -1, itemId: -1 }, { fileId: -1, itemId: 1163 }];
    const client: any = {
        widgetManager: { getDynamicChildrenByParent: (w: any) => (w === slot ? children : []) },
        objTypeLoader: { load: (id: number) => ({ examine: id === 1163 ? "A full face helmet." : "null" }) },
    };
    const messages: string[] = [];
    const addMessage = chatHistory.addMessage.bind(chatHistory);
    (chatHistory as any).addMessage = (_type: string, text: string) => { messages.push(text); };
    try {
        assert.equal(OsrsClient.prototype.examineWidgetItem.call(client, slot), true);
        assert.deepEqual(messages, ["A full face helmet."]);
        children[1].itemId = 0;
        client.objTypeLoader.load = (id: number) => ({ examine: id === 0 ? "Dwarf remains." : "null" });
        assert.equal(OsrsClient.prototype.examineWidgetItem.call(client, slot), true);
        assert.equal(messages.at(-1), "Dwarf remains.", "the child lookup includes valid cache item zero");
        assert.equal(OsrsClient.prototype.examineWidgetItem.call(client, { fileId: -1, itemId: 0 }), true,
            "an item-zero widget examines its own item");
        assert.equal(OsrsClient.prototype.examineWidgetItem.call(client, { fileId: -1, itemId: -1 }), false,
            "a CC child without an item does not borrow a sibling's");
    } finally {
        (chatHistory as any).addMessage = addMessage;
    }
    console.log("equipment slot examine uses the slot's item child");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
