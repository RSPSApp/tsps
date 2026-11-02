import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chatHistory } from "../rs/cs2/ChatHistory";
import { PlayerSyncManager } from "../game/sync/PlayerSyncManager";
import { Inventory } from "../rs/inventory/Inventory";
import { EquipmentDisplaySlot } from "../rs/config/player/Equipment";
import { encodePlayerAppearance } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { ItemIdentifiers } from "../../server/src/main/typescript/elvarg/util/ItemIdentifiers";

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
    const worn: any = Object.assign(Object.create(OsrsClient.prototype), { equipment: new Inventory(14) });
    const sync: any = {
        onAppearanceUpdate: (_id: number, data: any) => worn.buildPlayerAppearanceFromPayload(data.appearance, true),
    };
    const equip = new Array(14).fill(-1);
    const equipQty = new Array(14).fill(0);
    equip[13] = ItemIdentifiers.RUNE_ARROW;
    equipQty[13] = 300;
    const appearance = { gender: 0, colors: new Array(5).fill(0), kits: new Array(7).fill(-1), equip, equipQty };
    function update(weapon: number, quantity: number, legacy = false) {
        equip[3] = weapon;
        equipQty[3] = quantity;
        let payload = encodePlayerAppearance(appearance, "Knives", 126, 2277, new Array(7).fill(808));
        if (legacy) payload = payload.subarray(0, payload.length - 4);
        (PlayerSyncManager.prototype as any).applyAppearanceUpdate.call(sync, 1, { payload });
        assert.equal(worn.equipment.getSlot(EquipmentDisplaySlot.AMMO)?.quantity, 300, "ammo quantity survives weapon updates");
    }
    for (const quantity of [50, 49, 100000, 1]) {
        update(ItemIdentifiers.RUNE_KNIFE, quantity);
        assert.deepEqual(worn.equipment.getSlot(EquipmentDisplaySlot.WEAPON),
            { slot: EquipmentDisplaySlot.WEAPON, itemId: ItemIdentifiers.RUNE_KNIFE, quantity },
            "the worn inventory keeps the encoded knife stack after equipping or consuming knives");
    }
    update(ItemIdentifiers.RUNE_DART, 500);
    assert.equal(worn.equipment.getSlot(EquipmentDisplaySlot.WEAPON)?.quantity, 500, "other stacked weapons keep their quantity");
    update(ItemIdentifiers.RUNE_SCIMITAR, 1);
    assert.equal(worn.equipment.getSlot(EquipmentDisplaySlot.WEAPON)?.quantity, 1, "ordinary weapons remain singular");
    update(ItemIdentifiers.RUNE_KNIFE, 50, true);
    assert.equal(worn.equipment.getSlot(EquipmentDisplaySlot.WEAPON)?.quantity, 1, "old appearance payloads retain their fallback");
    update(-1, 0);
    assert.equal(worn.equipment.getSlot(EquipmentDisplaySlot.WEAPON)?.itemId, -1, "removing the last weapon clears the slot");
    console.log("equipment slot examine uses the slot's item child");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
