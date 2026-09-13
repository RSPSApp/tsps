import assert = require("assert");
import { inflateSync } from "zlib";
import { parseCacheTarget } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import {
  decodeClientPacket,
  decodeClientPackets,
  encodeChatMessage,
  encodeContentData,
  createNpcSyncState,
  createPlayerSyncState,
  encodeGameframeBootstrap,
  encodeHandshake,
  encodeInventorySlot,
  encodeInventorySnapshot,
  encodeLoginResponse,
  encodeNpcSync,
  encodePlayJingle,
  encodePlaySong,
  encodeRunClientScript,
  encodeRunEnergy,
  encodeSkillsSnapshot,
  encodePlayerAppearance,
  encodePlayerSync,
  encodeProjectiles,
  encodeWelcome,
  encodeSound,
  encodeServerPacket,
  encodeDestination,
  encodeGroundItems,
  encodeGroundItemsDelta,
  encodeBankSnapshot,
  encodeLocAddChange,
  encodeRebuildNormal,
  encodeRegionReplacement,
  encodeShopOpen,
  encodeTradeOpen,
  encodeVarbit,
  encodeVarp,
  encodeWidgetOpen,
  encodeWidgetOpenSub,
  encodeWidgetRunScript,
  encodeWidgetSetFlagsRange,
  encodeWidgetSetText,
  MAIN_INVENTORY_SLOT_FLAGS,
  MAIN_INVENTORY_WIDGET_UID,
} from "../src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { ServerPacketId } from "../src/main/typescript/elvarg/net/protocol/ServerPackets";
import { Music } from "../src/main/typescript/elvarg/game/Music";
import { NPC } from "../src/main/typescript/elvarg/game/entity/impl/npc/NPC";
import { Direction } from "../src/main/typescript/elvarg/game/model/Direction";
import { Location } from "../src/main/typescript/elvarg/game/model/Location";
import { Sound } from "../src/main/typescript/elvarg/game/Sound";
import { FightType } from "../src/main/typescript/elvarg/game/content/combat/FightType";
import { MagicCombatMethod } from "../src/main/typescript/elvarg/game/content/combat/method/impl/MagicCombatMethod";
import { EquipPacketListener } from "../src/main/typescript/elvarg/net/packet/impl/EquipPacketListener";
import { Bank } from "../src/main/typescript/elvarg/game/model/container/impl/Bank";
import { ShopManager } from "../src/main/typescript/elvarg/game/model/container/shop/ShopManager";
import { PrayerHandler } from "../src/main/typescript/elvarg/game/content/PrayerHandler";
import { Autocasting } from "../src/main/typescript/elvarg/game/content/combat/magic/Autocasting";
import { CombatSpells } from "../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells";
import { WeaponInterfaces } from "../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces";
import { WeaponInterfaceManager } from "../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager";
import { PacketSender } from "../src/main/typescript/elvarg/net/packet/PacketSender";
import { packWorldMapCoord } from "../src/main/typescript/elvarg/net/protocol/WorldMapProtocol";
import { CombatFactory } from "../src/main/typescript/elvarg/game/content/combat/CombatFactory";
import { HitQueue } from "../src/main/typescript/elvarg/game/content/combat/hit/HitQueue";
import { TeleportHandler } from "../src/main/typescript/elvarg/game/model/teleportation/TeleportHandler";
import { PluginManager } from "../src/main/typescript/elvarg/plugins/PluginManager";
import { ItemIdentifiers } from "../src/main/typescript/elvarg/util/ItemIdentifiers";

const ElementalStaves = require("../plugins/items/ElementalStaves.plugin");

assert.strictEqual(EquipPacketListener.resolveEquipmentSlot(387, 15), 0);
assert.strictEqual(EquipPacketListener.resolveEquipmentSlot(387, 25), 13);
assert.strictEqual(EquipPacketListener.resolveEquipmentSlot(84, 16), 7);
assert.strictEqual(EquipPacketListener.resolveEquipmentSlot(12, 15), -1);
assert.strictEqual(Bank.actionAmount("withdraw", 3, undefined, 100), 5);
assert.strictEqual(Bank.actionAmount("withdraw", 1, undefined, 100, 0, 2), 10);
assert.strictEqual(Bank.actionAmount("withdraw", 1, "Withdraw-All-but-1", 100), 99);
assert.strictEqual(Bank.actionAmount("deposit", 8, undefined, 100), 100);
assert.strictEqual(ShopManager.actionAmount(3), 5);
assert.strictEqual(ShopManager.actionAmount(1, "Buy 50"), 50);
assert.strictEqual(ShopManager.actionAmount(1, "Value"), null);
assert.strictEqual(PrayerHandler.prayerIdForChild(9), PrayerHandler.THICK_SKIN);
assert.strictEqual(PrayerHandler.prayerIdForChild(33), PrayerHandler.RIGOUR);
assert.strictEqual(PrayerHandler.prayerIdForChild(38), null);
assert.strictEqual(Autocasting.autocastSpell(1), CombatSpells.WIND_STRIKE);
assert.strictEqual(Autocasting.autocastSpell(17), CombatSpells.CRUMBLE_UNDEAD);
assert.strictEqual(Autocasting.autocastSpell(46), CombatSpells.ICE_BARRAGE);
assert.strictEqual(Autocasting.autocastSpell(59), null);

const originalAssignWeapon = WeaponInterfaceManager.assign;
const originalSetAutocast = Autocasting.setAutocast;
let equippedStaff = false;
let selectedAutocast: any = CombatSpells.WIND_STRIKE;
let autocastSyncs = 0;
let autocastLocation = new Location(3200, 3200);
(WeaponInterfaceManager as any).assign = () => undefined;
(Autocasting as any).setAutocast = (_player: any, spell: any) => {
  selectedAutocast = spell;
  autocastSyncs++;
};
const autocastPlayer: any = {
  getCombat: () => ({ getAutocastSpell: () => selectedAutocast }),
  getEquipment: () => ({ hasStaffEquipped: () => equippedStaff }),
  getLocation: () => autocastLocation,
  getPacketSender: () => ({ sendSpecialAttackState: () => undefined }),
  setSpecialActivated: () => undefined,
};
EquipPacketListener.resetWeapon(autocastPlayer, true);
assert.strictEqual(selectedAutocast, CombatSpells.WIND_STRIKE);
assert.strictEqual(autocastSyncs, 0);
equippedStaff = true;
EquipPacketListener.resetWeapon(autocastPlayer, true);
assert.strictEqual(selectedAutocast, CombatSpells.WIND_STRIKE);
assert.strictEqual(autocastSyncs, 1);
autocastLocation = new Location(3200, 3600);
EquipPacketListener.resetWeapon(autocastPlayer, true);
assert.strictEqual(selectedAutocast, null);
(WeaponInterfaceManager as any).assign = originalAssignWeapon;
(Autocasting as any).setAutocast = originalSetAutocast;

assert.strictEqual(WeaponInterfaces.WHIP.getCategory(), 20);
assert.strictEqual(WeaponInterfaces.STAFF.getCategory(), 18);
assert.strictEqual(WeaponInterfaces.BLOWPIPE.getCategory(), 19);

ElementalStaves.register((PluginManager as any).createApi("elemental-staves-smoke"));
let magicWeaponId = ItemIdentifiers.STAFF_OF_AIR;
const staffPlayer = {
  getEquipment: () => ({ get: () => ({ getId: () => magicWeaponId }) }),
};
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0), null);
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0, ItemIdentifiers.AIR_RUNE), true);
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0, ItemIdentifiers.FIRE_RUNE), null);
assert.deepStrictEqual(
  CombatSpells.WIND_STRIKE.itemsToConsume(staffPlayer as any).map((rune) => rune.id),
  [ItemIdentifiers.MIND_RUNE]
);
magicWeaponId = ItemIdentifiers.MYSTIC_SMOKE_STAFF;
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0, ItemIdentifiers.AIR_RUNE), true);
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0, ItemIdentifiers.FIRE_RUNE), true);
magicWeaponId = ItemIdentifiers.KODAI_WAND;
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0, ItemIdentifiers.WATER_RUNE), true);
magicWeaponId = ItemIdentifiers.TWINFLAME_STAFF;
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0, ItemIdentifiers.FIRE_RUNE), true);
assert.strictEqual(PluginManager.emitSpellRuneBypass(staffPlayer, null, 0, ItemIdentifiers.WATER_RUNE), true);

let hitTargetHp = 10;
let hitAttackerHp = 10;
const hitTarget: any = {
  getHitpoints: () => hitTargetHp,
  isRegistered: () => true,
  isUntargetable: () => false,
  getUpdateFlag: () => ({ flagged: () => false, flag: () => undefined }),
};
const hitAttacker: any = { getHitpoints: () => hitAttackerHp, isRegistered: () => true };
const hitQueue = new HitQueue(hitTarget);
const originalExecuteHit = CombatFactory.executeHit;
let appliedHits = 0;
(CombatFactory as any).executeHit = () => { appliedHits++; };
hitQueue.addPendingHit({ getTarget: () => hitTarget, getAttacker: () => hitAttacker } as any, 7);
HitQueue.processAll(6);
assert.strictEqual(appliedHits, 0);
HitQueue.processAll(7);
assert.strictEqual(appliedHits, 1);
hitAttackerHp = 0;
hitQueue.addPendingHit({ getTarget: () => hitTarget, getAttacker: () => hitAttacker } as any, 8);
HitQueue.processAll(8);
assert.strictEqual(appliedHits, 1);
(CombatFactory as any).executeHit = originalExecuteHit;

let stoppedSkill = 0;
let closedInterface = 0;
let resetCombat = 0;
TeleportHandler.onTeleporting({
  getSkillManager: () => ({ stopSkillable: () => stoppedSkill++ }),
  getPacketSender: () => ({ sendInterfaceRemoval: () => closedInterface++ }),
  getCombat: () => ({ reset: () => resetCombat++ }),
} as any, false);
assert.deepStrictEqual([stoppedSkill, closedInterface, resetCombat], [1, 0, 1]);

for (let id = 0; id < 8; id++) {
  const npc = new NPC(-1, new Location(0, 0));
  npc.setFace(Direction.valueOf(id));
  assert.strictEqual(npc.getFace().getDirection().getId(), id);
}

const loginPayload = Buffer.alloc(4);
loginPayload.writeInt32BE(237);
const body = Buffer.concat([Buffer.from("toby\0secret\0", "latin1"), loginPayload]);
const frame = Buffer.concat([
  Buffer.from([204, body.length >> 8, body.length & 0xff]),
  body,
]);

assert.deepStrictEqual(decodeClientPacket(frame), {
  type: "login",
  username: "toby",
  password: "secret",
  revision: 237,
});
assert.deepStrictEqual(
  decodeClientPacket(Buffer.from([16, 0x0d, 0x43, 0xff, 0x0c, 0x93, 0x80, 0x00])),
  { type: "move", worldX: 3091, worldY: 3523, modifierFlags: 1 }
);
const npcClick = Buffer.from([76, 0, 0, 135]);
const objectClick = Buffer.from([96, 0x93, 0x0c, 0xc4, 0x0d, 0, 3, 0x68]);
assert.deepStrictEqual(decodeClientPacket(npcClick), {
  type: "npc_option", index: 7, clickType: 1,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([
  75, 0, 7, 9, 0, 218, 0, 0, 9, 73, 12, 128,
])), {
  type: "spell_on_npc", targetIndex: 7, spellWidget: (218 << 16) | 9,
  spellChild: 9, spellItemId: 3273,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([
  36, 0, 131, 0, 12, 142, 0, 0, 227, 3, 0, 135,
])), {
  type: "item_on_npc", targetIndex: 7, itemId: 995, slot: 3, widgetId: 3214,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([
  86, 0, 131, 104, 3, 142, 12, 0, 0, 128, 19, 12, 13, 196, 3, 99,
])), {
  type: "item_on_object", objectId: 1000, x: 3091, y: 3524, itemId: 995, slot: 3, widgetId: 3214,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([
  2, 13, 68, 104, 3, 10, 4, 9, 0, 218, 0, 12, 19, 138, 4, 0,
])), {
  type: "spell_on_object", objectId: 1000, x: 3091, y: 3524,
  spellWidget: (218 << 16) | 9, spellChild: 1162, spellItemId: 1162,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([
  30, 0, 16, 0, 14, 2, 0, 0, 0, 3, 0, 9, 0, 12, 0, 227, 3, 170, 187,
])), {
  type: "local_trigger", opcodeParam: 2, childIndex: 3, widgetId: (12 << 16) | 9,
  itemId: 995, argsData: Buffer.from([170, 187]),
});
assert.strictEqual(CombatSpells.getCombatSpellByName("Wind Strike"), CombatSpells.WIND_STRIKE);
assert.strictEqual(CombatSpells.getCombatSpellByName("Ice barrage"), CombatSpells.ICE_BARRAGE);
assert.deepStrictEqual(decodeClientPacket(objectClick), {
  type: "object_option", id: 1000, x: 3091, y: 3524, clickType: 1,
});
assert.deepStrictEqual(decodeClientPackets(Buffer.concat([npcClick, objectClick])), [
  { type: "npc_option", index: 7, clickType: 1 },
  { type: "object_option", id: 1000, x: 3091, y: 3524, clickType: 1 },
]);
assert.deepStrictEqual(decodeClientPacket(Buffer.from([44, 128, 0, 7])), {
  type: "player_option", index: 7, option: 1,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([102, 128, 0xc4, 0x0d, 0x63, 0x03, 0x93, 0x0c])), {
  type: "ground_item_action", itemId: 995, x: 3091, y: 3524, optionIndex: 1,
});
const chat = Buffer.from([190, 7, 0, ...Buffer.from("hello\0", "latin1")]);
assert.deepStrictEqual(decodeClientPacket(chat), {
  type: "chat", text: "hello", messageType: "public",
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([55])), { type: "interface_close" });
const worldMapCoord = (2 << 28) | (3200 << 14) | 3201;
assert.strictEqual(packWorldMapCoord(3200, 3201, 2), worldMapCoord);
assert.deepStrictEqual(decodeClientPacket(Buffer.from([
  105,
  (worldMapCoord >>> 16) & 0xff,
  (worldMapCoord >>> 24) & 0xff,
  worldMapCoord & 0xff,
  (worldMapCoord >>> 8) & 0xff,
])), { type: "world_map_click", level: 2, x: 3200, y: 3201 });
const worldMapPackets: Buffer[] = [];
const worldMapSender = new PacketSender({
  getLocation: () => new Location(3200, 3201, 2),
  getSession: () => ({
    sendClientPacket: (packet: Buffer) => {
      worldMapPackets.push(packet);
      return true;
    },
  }),
});
worldMapSender.toggleWorldMap();
assert.deepStrictEqual(worldMapPackets.map((packet) => packet[0]), [110, 103, 109]);
worldMapSender.toggleWorldMap();
assert.strictEqual(worldMapPackets[3][0], 104);
const chatboxPackets: Buffer[] = [];
const chatboxSender = new PacketSender({
  getSession: () => ({
    sendClientPacket: (packet: Buffer) => {
      chatboxPackets.push(packet);
      return true;
    },
  }),
});
chatboxSender.sendChatboxInterface(2492);
assert.strictEqual(chatboxSender.isChatboxInterface(2492), true);
chatboxSender.closeInterface(2492);
assert.deepStrictEqual(chatboxPackets.map((packet) => packet[0]), [106, 103, 104, 106]);
const combatTabPackets: Buffer[] = [];
new PacketSender({
  getSession: () => ({
    sendClientPacket: (packet: Buffer) => {
      combatTabPackets.push(packet);
      return true;
    },
  }),
}).sendTabInterface(0, 593);
assert.deepStrictEqual(combatTabPackets.map((packet) => packet[0]), [104, 103, 106, 106]);
const inventoryPackets: Buffer[] = [];
new PacketSender({
  getSession: () => ({
    sendClientPacket: (packet: Buffer) => inventoryPackets.push(packet),
  }),
}).sendSubInterface((161 << 16) | 79, 149);
assert.deepStrictEqual(inventoryPackets.map((packet) => packet[0]), [103, 109]);
assert.deepStrictEqual(
  inventoryPackets[1],
  encodeWidgetSetFlagsRange(MAIN_INVENTORY_WIDGET_UID, 0, 27, MAIN_INVENTORY_SLOT_FLAGS)
);
assert.deepStrictEqual(decodeClientPacket(Buffer.from([191, 0, 43, 0, 0, 0, 2])), {
  type: "varp_transmit", varpId: 43, value: 2,
});
assert.deepStrictEqual(decodeClientPackets(Buffer.concat([chat, Buffer.from([55])])).map(({ type }) => type), [
  "chat", "interface_close",
]);
assert.deepStrictEqual(decodeClientPacket(Buffer.from([252, 0, 0, 0, 42, 0, 131])), {
  type: "dialogue_continue", widgetId: 42, childIndex: 131,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([
  251, 21, 0, 12, 0, 12, 0, 12, 0, 12, 0, 0, 7, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255,
])), {
  type: "widget_action", widgetId: (12 << 16) | 12, groupId: 12, childId: 12,
  opId: 7, buttonNum: undefined, option: undefined, target: undefined, slot: undefined, itemId: undefined,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([62, 0, 143, 1, 14, 0, 15])), {
  type: "dialogue_continue", widgetId: (270 << 16) | 15, childIndex: 15,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([192, 0, 0, 0, 10])), {
  type: "dialogue_amount", amount: 10,
});
assert.deepStrictEqual(decodeClientPacket(Buffer.from([194, 3, 111, 107, 0])), {
  type: "dialogue_input", value: "ok",
});
assert.deepStrictEqual([...encodeChatMessage("game", "Hi")], [
  120, 8, 72, 105, 0, 0, 0, 0, 255, 255,
]);
assert.deepStrictEqual([...encodeServerPacket(ServerPacketId.SHOP_CLOSE, Buffer.alloc(0))], [152]);
const content = encodeContentData("test", [{ key: "widgets", rows: [{ id: 1 }] }]);
assert.strictEqual(content[0], ServerPacketId.GAMEMODE_DATA);
assert.deepStrictEqual(JSON.parse(inflateSync(content.subarray(8)).toString()), {
  gamemodeId: "test",
  datasets: [{ key: "widgets", rows: [{ id: 1 }] }],
});
assert.throws(() => encodeServerPacket(ServerPacketId.RUN_ENERGY, Buffer.alloc(1)));
assert.deepStrictEqual([...encodeVarp(12, 3)], [40, 0, 12, 3]);
assert.deepStrictEqual([...encodeVarbit(12, 300)], [42, 0, 12, 0, 0, 1, 44]);
assert.deepStrictEqual([...encodeInventorySlot(2, 4151, 1)], [51, 5, 0, 2, 16, 56, 1]);
assert.strictEqual(encodeInventorySnapshot([{ slot: 0, itemId: -1, quantity: 0 }])[0], 50);
assert.strictEqual(encodeSkillsSnapshot([{
  id: 0, xp: 83, baseLevel: 2, virtualLevel: 2, boost: 0, currentLevel: 2,
}], 24, 3)[0], 70);
assert.deepStrictEqual([...encodeRunEnergy(65, true)], [81, 65, 1]);
assert.deepStrictEqual([...encodeDestination(3091, 3524)], [87, 12, 19, 13, 196]);
assert.strictEqual(encodeGroundItems(1, [{ id: 7, itemId: 995, quantity: 1, x: 3091, y: 3524, level: 0 }])[0], 54);
assert.strictEqual(encodeGroundItemsDelta(2, [], [7])[0], 55);
assert.strictEqual(encodeBankSnapshot(1410, [{ slot: 0, itemId: 995, quantity: 1000, tab: 0 }])[0], 52);
assert.deepStrictEqual([...encodeLocAddChange(1000, 3091, 3524, 0, 10, 2)], [134, 8, 3, 232, 12, 19, 13, 196, 0, 42]);
assert.strictEqual(encodeRebuildNormal(386, 440, true, [[1, 2, 3, 4]])[0], 141);
const regionReplacement = encodeRegionReplacement(
  12343,
  false,
  Uint8Array.from([1, 2, 3]),
  Uint8Array.from([4, 5])
);
assert.deepStrictEqual([...regionReplacement], [144, 0, 12, 48, 55, 0, 0, 3, 0, 2, 1, 2, 3, 4, 5]);
const maxRegionReplacement = encodeRegionReplacement(12343, false, new Uint8Array(0xfffd - 7), null);
assert.strictEqual(maxRegionReplacement.length, 0x10000);
assert.throws(() => encodeRegionReplacement(12343, false, new Uint8Array(0xfffd - 6), null));
assert.strictEqual(encodeShopOpen("1", "Shop", 995, false, 1, 1, [
  { slot: 0, itemId: 4151, quantity: 1 },
])[0], 150);
assert.strictEqual(encodeTradeOpen("1:2", "offer", { offers: [] }, { offers: [] })[0], 155);
assert.deepStrictEqual([...encodeWidgetOpen(12)], [100, 0, 12, 1]);
assert.deepStrictEqual([...encodeWidgetSetText(42, "Hi")], [105, 0, 7, 0, 0, 0, 42, 72, 105, 0]);
assert.strictEqual(encodeWidgetOpenSub((161 << 16) | 7, 122)[0], 103);
assert.strictEqual(encodeWidgetRunScript(876, ["Toby", 1])[0], 110);
assert.deepStrictEqual([...encodeRunClientScript(626)], [170, 0, 3, 2, 114, 0]);
assert.deepStrictEqual(parseCacheTarget("osrs-237_2026-03-25"), {
  revision: 237,
  date: "2026-03-25",
});
assert.throws(() => parseCacheTarget("latest"));
assert.strictEqual(encodeWelcome(600, Date.now()).length, 9);
assert.strictEqual(encodeLoginResponse(true)[0], 3);
assert.strictEqual(encodeHandshake(1, "Toby", true)[0], 2);
assert.deepStrictEqual([...encodeSound(2395, { x: 3090, y: 3524, radius: 5 })], [
  131, 13, 9, 91, 1, 12, 18, 13, 196, 0, 1, 0, 0, 5, 0,
]);
assert.deepStrictEqual([...encodeSound(2738)], [131, 8, 10, 178, 0, 1, 0, 0, 0, 0]);
assert.strictEqual(Sound.PICK_UP_ITEM.getId(), 2582);
assert.strictEqual(Sound.SHOOT_CROSSBOW.getId(), 2695);
assert.strictEqual(Sound.PRAYER_PROTECT_MELEE.getId(), 2676);
assert.strictEqual(FightType.UNARMED_KICK.getAttackSound().getId(), 2565);
assert.strictEqual((MagicCombatMethod as any).resolveCastSound(1152).getId(), 220);
assert.strictEqual((MagicCombatMethod as any).resolveImpactSound(12891).getId(), 168);
assert.deepStrictEqual([...encodePlayJingle(42, 0x010203)], [132, 0, 42, 1, 3, 2]);
assert.deepStrictEqual([...encodePlaySong(76)], [133, 0, 76, 0, 0, 0, 100, 0, 100, 0, 0]);
assert.strictEqual(Music.forRegion(12850), 76);
const gameframe = encodeGameframeBootstrap("Toby");
assert.deepStrictEqual(gameframe.map((packet) => packet[0]), [
  170, 102, 103, 103, 103, 103, 103, 103, 103, 103, 103, 103,
  103, 103, 103, 103, 103, 103, 103, 103, 103, 109, 103, 111,
  109, 109, 109, 109, 110,
]);
assert.deepStrictEqual([...gameframe[0]], [170, 0, 3, 2, 114, 0]);
assert.deepStrictEqual([...gameframe[1]], [102, 0, 161]);
assert.strictEqual(gameframe[2].readInt32BE(3), (161 << 16) | 96);
assert.strictEqual(gameframe[2].readUInt16BE(7), 162);
assert.deepStrictEqual(
  gameframe[21],
  encodeWidgetSetFlagsRange(MAIN_INVENTORY_WIDGET_UID, 0, 27, MAIN_INVENTORY_SLOT_FLAGS)
);
const appearance = encodePlayerAppearance(
  { gender: 0, colors: [2, 14, 5, 4, 0], kits: [3, 14, 18, 26, 34, 38, 42], equip: [] },
  "Toby",
  3,
  32,
  [808, 823, 819, 820, 821, 822, 824]
);
const npcAppearance = encodePlayerAppearance(
  { gender: 0, colors: [0, 0, 0, 0, 0], kits: [], equip: [], npcTransformationId: 172 },
  "Toby",
  3,
  32,
  [808, 823, 819, 820, 821, 822, 824]
);
assert.deepStrictEqual([...npcAppearance.subarray(0, 7)], [0, 255, 255, 255, 255, 0, 172]);
const playerState = createPlayerSyncState(1, { x: 3089, y: 3524, level: 0 });
const activeSlots = playerState.active;
const emptySlots = playerState.empty;
const playerFrame = encodePlayerSync(1, 3040, 3472, 10, [
  { index: 1, x: 3090, y: 3524, level: 0, appearance },
  { index: 2, x: 3091, y: 3524, level: 0, appearance },
], playerState);
assert.strictEqual(playerFrame[0], 20);
assert.strictEqual(playerState.active, activeSlots);
assert.strictEqual(playerState.empty, emptySlots);
assert.deepStrictEqual(Array.from(playerState.active.subarray(0, playerState.activeCount)), [1, 2]);
encodePlayerSync(1, 3040, 3472, 11, [
  { index: 1, x: 3090, y: 3524, level: 0, appearance },
], playerState);
assert.deepStrictEqual(Array.from(playerState.active.subarray(0, playerState.activeCount)), [1]);
encodePlayerSync(1, 3040, 3472, 12, [
  { index: 1, x: 3090, y: 3524, level: 0, appearance },
  { index: 3, x: 3092, y: 3524, level: 0, appearance },
], playerState);
assert.deepStrictEqual(Array.from(playerState.active.subarray(0, playerState.activeCount)), [1, 3]);

const forcedState = createPlayerSyncState(1, { x: 3089, y: 3521, level: 0 });
const forcedEnd = { x: 3089, y: 3524, level: 0 };
encodePlayerSync(1, 3040, 3472, 10, [{
  index: 1, x: 3089, y: 3521, level: 0, appearance,
  forcedMovement: {
    startDeltaX: 0, startDeltaY: 0, endDeltaX: 0, endDeltaY: 3,
    startCycleOffset: 0, endCycleOffset: 70, direction: 0,
  },
  forcedMovementEnd: forcedEnd,
}], forcedState);
assert.deepStrictEqual(forcedState.lastTiles.get(1), forcedEnd);
encodePlayerSync(1, 3040, 3472, 11, [{
  index: 1, x: 3089, y: 3521, level: 0, appearance, forcedMovementEnd: forcedEnd,
}], forcedState);
assert.deepStrictEqual(forcedState.lastTiles.get(1), forcedEnd);

const combatPlayerState = createPlayerSyncState(1, { x: 3090, y: 3524, level: 0 });
const combatPlayerFrame = encodePlayerSync(1, 3040, 3472, 11, [{
  index: 1,
  x: 3090,
  y: 3524,
  level: 0,
  appearance,
  forcedChat: "Ow",
  faceDirection: 1024,
  interactionIndex: 7,
  animation: { id: 123, delay: 2 },
  hits: [{ type: 16, damage: 5 }],
  health: { current: 5, max: 10 },
  graphic: { id: 456, height: 50, delay: 3 },
}], combatPlayerState);
assert.deepStrictEqual([...combatPlayerFrame.subarray(-31)], [
  235, 64, 1, 79, 119, 0, 0, 4, 0, 7, 0, 251, 0, 2,
  255, 16, 5, 0, 255, 0, 0, 0, 15, 129, 0, 1, 200, 0, 3, 0, 50,
]);

const npcState = createNpcSyncState();
const npcFrame = encodeNpcSync(10, { x: 3090, y: 3524, level: 0 }, [{
  index: 7,
  typeId: 1,
  x: 3091,
  y: 3524,
  level: 0,
  rotation: 4,
  walkDirection: -1,
  runDirection: -1,
}], npcState);
assert.strictEqual(npcFrame[0], 21);
assert.deepStrictEqual(npcState.indices, [7]);

const npcCombatFrame = encodeNpcSync(11, { x: 3090, y: 3524, level: 0 }, [{
  index: 7,
  typeId: 1,
  x: 3091,
  y: 3524,
  level: 0,
  rotation: 4,
  walkDirection: -1,
  runDirection: -1,
  forcedChat: "Hi",
  interactionIndex: 0x8001,
  animation: { id: 200, delay: 0 },
  hits: [{ type: 17, damage: 4 }],
  health: { current: 6, max: 10 },
  graphic: { id: 300, height: 0, delay: 1 },
}], npcState);
assert.deepStrictEqual([...npcCombatFrame.subarray(-29)], [
  248, 64, 2, 129, 128, 128, 127, 17, 4, 0, 129, 0, 0, 0, 238,
  72, 105, 0, 1, 128, 44, 1, 0, 1, 0, 0, 0, 200, 0,
]);
const npcClearFaceFrame = encodeNpcSync(12, { x: 3090, y: 3524, level: 0 }, [{
  index: 7,
  typeId: 1,
  x: 3091,
  y: 3524,
  level: 0,
  rotation: 4,
  walkDirection: -1,
  runDirection: -1,
  interactionIndex: -1,
}], npcState);
assert.deepStrictEqual([...npcClearFaceFrame.subarray(-4)], [8, 127, 255, 127]);

const projectile = encodeProjectiles([{
  projectileId: 91,
  source: { x: 3090, y: 3524, level: 0 },
  target: { x: 3094, y: 3524, level: 0 },
  sourceHeight: 172,
  endHeight: 124,
  slope: 16,
  startPos: 64,
  startCycleOffset: 40,
  endCycleOffset: 57,
  targetActor: { kind: "npc", index: 7 },
}]);
assert.strictEqual(projectile[0], 84);
assert.strictEqual(projectile.readUInt16BE(1), 31);
assert.strictEqual(projectile.readUInt16BE(3), 1);
assert.strictEqual(projectile.readUInt16BE(5), 91);
assert.deepStrictEqual([...projectile.subarray(-3)], [2, 0, 7]);

console.log("cache, login, and client protocol smoke test passed");
