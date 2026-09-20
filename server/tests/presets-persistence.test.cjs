const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { GROUP_ID, GLOBAL_ROW_COUNT, PRESET_ROW_START, uid } = require("../plugins/modes/pvp/presetsWidget");
const presets = require("../plugins/modes/pvp/Presets");

function playerWithAttributes(attributes = new Map()) {
  const strings = [];
  const sender = {
    sendString(value) {
      strings.push(value);
      return sender;
    },
    sendItemOnInterfaces() { return sender; },
    sendInterfaceDisplayState() { return sender; },
    sendEnterInputPrompt() { return sender; },
  };
  let currentPreset = null;
  let syntaxAction = null;
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInterfaceId: () => GROUP_ID,
    getPacketSender: () => sender,
    sendMessage: (message) => sender.sendMessage(message),
    getCurrentPreset: () => currentPreset,
    setCurrentPreset: (preset) => { currentPreset = preset; },
    setEnteredSyntaxAction: (action) => { syntaxAction = action; },
    getEnteredSyntaxAction: () => syntaxAction,
    getInventory: () => ({ copyValidItemsArray: () => [] }),
    getEquipment: () => ({ copyValidItemsArray: () => [] }),
    getSkillManager: () => ({ getMaxLevel: () => 99 }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getCombat: () => ({ getAutocastSpell: () => null }),
    isPlayerBot: () => false,
  };
  return { attributes, player, strings };
}

test("custom presets rehydrate from their persisted attribute", () => {
  let onButton;
  let onCanBankItem;
  const persisted = [];
  presets.register({
    getPrayerHandler: () => ({}),
    getCombatFactory: () => ({}),
    getSkillManager: () => ({}),
    persistAttribute: (key) => persisted.push(key),
    registerCustomInterface() {},
    onCanBankItem(handler) { onCanBankItem = handler; },
    onInterfaceActionButton(_buttons, handler) { onButton = handler; },
  });
  assert.deepEqual(persisted, ["pvp:customPresets"]);

  const customSlot = uid(PRESET_ROW_START + GLOBAL_ROW_COUNT);
  const source = playerWithAttributes();
  onButton({ player: source.player, buttonId: customSlot });
  source.player.getEnteredSyntaxAction().execute("saved build");

  const stored = source.attributes.get("pvp:customPresets");
  assert.equal(stored[0].name, "Saved Build");
  assert.equal(typeof stored[0].getName, "undefined");

  const restored = playerWithAttributes(new Map([
    ["pvp:customPresets", JSON.parse(JSON.stringify(stored))],
  ]));
  onButton({ player: restored.player, buttonId: customSlot });
  assert.equal(restored.player.getCurrentPreset().getName(), "Saved Build");
  assert.ok(restored.strings.includes("<col=ffffff>Saved Build</col>"));

  const messages = [];
  const event = {
    player: { sendMessage: (message) => messages.push(message) },
    item: { isUntradeable: () => true },
    allow: true,
  };
  onCanBankItem(event);
  assert.equal(event.allow, false);
  assert.deepEqual(messages, ["Preset items cannot be banked."]);
});

test("server-owned items inherit gameplay and deliver external models before definitions", async () => {
  const fs = require("node:fs");
  const { inflateSync } = require("node:zlib");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
  const { ContentApi } = require("../dist/net/http/ContentApi");
  const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize();
  let onLogin;
  require("../plugins/items/ItemDefinitionLoader.plugin").register({
    log() {},
    onPlayerLogin(handler) { onLogin = handler; },
    registerContentEndpoint(name, handler) { ContentApi.register(name, handler); },
  });
  const custom = CacheDefinitions.getCustomItems()[0];
  const item = ItemDefinition.forId(custom.id);
  const base = ItemDefinition.forId(custom.baseItemId);
  assert.equal(CacheDefinitions.getItem(custom.id).id, custom.id);
  assert.equal(item.getId(), custom.id);
  assert.equal(item.getName(), "Dragonic katana");
  assert.equal(item.getEquipmentType().getSlot(), 3);
  assert.equal(item.getNoteId(), -1, "custom weapons must not turn into the base weapon's note");
  assert.equal(item.isTradeable(), false);
  assert.deepEqual(item.getBonuses(), base.getBonuses());
  assert.notEqual(item.getBonuses(), base.getBonuses());
  assert.deepEqual(item.getRequirements(), base.getRequirements());
  assert.equal(CacheDefinitions.getItem(custom.id).inventoryActions[0], "Wield");
  assert.equal(CacheDefinitions.hasItem(custom.id), true);
  assert.equal(CacheDefinitions.hasItem(custom.id + 1), false, "unused custom IDs are not valid items");
  const delivered = [];
  onLogin({ player: { getPacketSender: () => ({
    sendContentData(source, datasets) {
      const packet = encodeContentData(source, datasets);
      assert.ok(packet.length <= 0xffff);
      assert.equal(packet.readUInt16BE(1), packet.length - 3);
      delivered.push(JSON.parse(inflateSync(packet.subarray(8)).toString("utf8")));
    },
  }) } });
  assert.deepEqual(delivered.map((payload) => payload.datasets[0].key),
    ["customModels", "customModels", "customModels", "customItems"]);
  assert.deepEqual(delivered[0].datasets[0].rows, []);
  for (const payload of delivered.slice(1, 3)) {
    const model = payload.datasets[0].rows[0];
    assert.deepEqual(Buffer.from(model.data, "base64"),
      fs.readFileSync(`data/models/${custom.models[model.id]}`));
  }
  assert.equal(delivered[3].datasets[0].rows[0].objType.model, 1000000);
  assert.equal(ContentApi.resolve("GET", `/api/custom-models/1000000`).status, 200);
  assert.throws(() => CacheDefinitions.registerCustomItems([{ ...custom, id: 70000 }]), /id must/);
  assert.throws(() => CacheDefinitions.registerCustomItems([custom, custom]), /duplicate item/);
  assert.equal(CacheDefinitions.getItem(custom.id).id, custom.id, "invalid registration preserves live definitions");
});

test("preset-spawned items carry the untradeable metadata", () => {
  const { Item } = require("../dist/game/model/Item");
  const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
  const item = presets._test.spawnPresetItem(
    new Item(ItemIdentifiers.COINS),
    presets.getGlobalPresetPool()[0],
  );

  assert.equal(item.getMetaValue(Item.UNTRADEABLE_META), true);
  assert.equal(item.isTradeable(), false);
  assert.equal(item.isLostOnDeath(), true);
});

test("deposit booth slot actions reach Bank.deposit", () => {
  const booth = require("../plugins/objects/BankDepositBooth.plugin");
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  let onInterfaceActionClick;
  booth.register({
    onObjectInteraction() {},
    onInterfaceActionClick(handler) { onInterfaceActionClick = handler; },
    onInterfaceActionButton() {},
    onItemOnObject() {},
    emitCanBank: () => null,
  });

  let amount = 1;
  const item = { getId: () => 4153 };
  const player = {
    getInterfaceId: () => 192,
    getInventory: () => ({ forSlot: () => item, getAmount: () => amount }),
    getPacketSender: () => ({ clearItemOnInterface() {}, sendItemContainer() {} }),
  };
  const deposit = Bank.deposit;
  try {
    Bank.deposit = (_player, id, slot, moved) => {
      assert.equal(id, 4153);
      assert.equal(slot, 0);
      assert.equal(moved, 1);
      amount = 0;
    };
    const event = { player, buttonId: (192 << 16) | 24, itemId: 4153, slot: 0, action: 2, handled: false };
    onInterfaceActionClick(event);
    assert.equal(event.handled, true);
  } finally {
    Bank.deposit = deposit;
  }
});

test("a player preset bot announces its suppressed drops once", () => {
  const botDeathLoot = require("../plugins/bots/runtime/BotDeathLoot");
  const messages = [];
  const killer = {
    isRegistered: () => true,
    isPlayerBot: () => false,
    sendMessage: (message) => messages.push(message),
  };
  const victim = { isPlayerBot: () => true };
  const event = {
    player: victim,
    killer,
    item: { isUntradeable: () => true },
    dropEligible: false,
    handled: false,
  };

  botDeathLoot.handleBotDeathItemDrop(event);
  botDeathLoot.handleBotDeathItemDrop(event);
  botDeathLoot.clearBotDeathLootPlan(victim);

  assert.deepEqual(messages, ["This bot was using a player preset and therefore has not dropped its items. Regular bots will still drop items"]);
});
