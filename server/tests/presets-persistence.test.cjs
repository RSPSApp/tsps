const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { GROUP_ID, GLOBAL_ROW_COUNT, PRESET_ROW_START, uid } = require("../plugins/modes/pvp/PresetsWidget.PvpMode");
const presets = require("../plugins/modes/pvp/Presets.PvpMode");

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
  let syntaxAction = null;
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInterfaceId: () => GROUP_ID,
    getPacketSender: () => sender,
    sendMessage: (message) => sender.sendMessage(message),
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

function assertBotPresetLoot() {
  const { Location } = require("../dist/game/model/Location");
  const lootKeys = require("../plugins/items/LootKeys.plugin");
  const botDeathLoot = require("../plugins/bots/runtime/DeathLoot.PlayerBots");
  const ground = [];
  const location = new Location(3090, 3600);
  botDeathLoot.initBotDeathLootCoreAccess({
    getWorld: () => ({}),
    getItemOnGroundManager: () => ({ registerNonGlobals: (_player, item) => ground.push(item) }),
  });
  const bot = { isPlayerBot: () => true };
  const preset = presets.getGlobalPresetPool()[0];
  const items = [...preset.getInventory(), ...preset.getEquipment()].map((source) => {
    const item = presets._test.spawnPresetItem(source, preset, bot);
    assert.notEqual(item, source);
    assert.deepEqual(item.getMeta(), source.getMeta());
    assert.equal(item.isLostOnDeath(), false);
    assert.equal(item.isUnbankable(), false);
    assert.equal(item.isPresetItem(), false);
    return item;
  });
  const drops = items.filter((item) => item.isTradeable());
  assert.ok(drops.length > 0);

  for (const keysEnabled of [false, true]) {
    ground.length = 0;
    const received = [];
    const attributes = new Map([[lootKeys.ENABLED_ATTRIBUTE, keysEnabled]]);
    const killer = {
      isPlayer: () => true, isPlayerBot: () => false, isRegistered: () => true,
      getLocation: () => location,
      getAttribute: (key) => attributes.get(key),
      getInventory: () => ({
        getValidItems: () => received, getFreeSlots: () => 28,
        contains: () => false, adds() {}, addItem: (item) => received.push(item),
      }),
      getPacketSender: () => ({ sendMessage() {} }),
      sendMessage: () => assert.ok(keysEnabled, "ground loot must not announce suppressed preset drops"),
    };
    const victim = {
      isPlayer: () => true, isPlayerBot: () => true,
      getLocation: () => location, setAttribute() {},
    };
    const protectedDrop = { player: victim, killer, item: drops[0], location, dropEligible: false, handled: false };
    lootKeys._test.queueDrop(protectedDrop);
    botDeathLoot.handleBotDeathItemDrop(protectedDrop);
    assert.equal(protectedDrop.handled, true, "protected items cannot reach the ground or a key");
    assert.equal(ground.length, 0);
    for (const item of drops) {
      const event = { player: victim, killer, item, location, dropEligible: true, handled: false };
      lootKeys._test.queueDrop(event);
      botDeathLoot.handleBotDeathItemDrop(event);
    }
    lootKeys._test.createLootKey({ killer, victim });
    if (keysEnabled) {
      assert.equal(ground.length, 0);
      assert.equal(received.length, 1);
      assert.ok(lootKeys.isLootKey(received[0]));
      assert.deepEqual(lootKeys.keyItems(received[0]), drops.map((item) => ({
        id: item.getId(), amount: item.getAmount(), meta: item.getMeta(),
      })));
    } else {
      assert.deepEqual(ground.map((item) => item.getId()), drops.map((item) => item.getId()));
      assert.equal(received.length, 0);
    }
    botDeathLoot.clearBotDeathLootPlan(victim);
  }
}

test("disabled presets leave bot inventory and equipment lootable on the ground or in keys", () => {
  assert.equal(presets.isEnabled(), false);
  assertBotPresetLoot();
});

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
  assert.deepEqual(persisted, ["pvp:custom-presets"]);

  const customSlot = uid(PRESET_ROW_START + GLOBAL_ROW_COUNT);
  const source = playerWithAttributes();
  onButton({ player: source.player, buttonId: customSlot });
  source.player.getEnteredSyntaxAction().execute("saved build");

  const stored = source.attributes.get("pvp:custom-presets");
  assert.equal(stored[0].name, "Saved Build");
  assert.equal(typeof stored[0].getName, "undefined");

  const restored = playerWithAttributes(new Map([
    ["pvp:custom-presets", JSON.parse(JSON.stringify(stored))],
  ]));
  onButton({ player: restored.player, buttonId: customSlot });
  assert.equal(restored.player.getAttribute("pvp:current-preset").getName(), "Saved Build");
  assert.ok(restored.strings.includes("<col=ffffff>Saved Build</col>"));

  const messages = [];
  const event = {
    player: { sendMessage: (message) => messages.push(message) },
    item: { isUnbankable: () => true },
    allow: true,
  };
  onCanBankItem(event);
  assert.equal(event.allow, false);
  assert.deepEqual(messages, ["Preset items cannot be banked."]);
});

test("custom presets survive the player save round trip", () => {
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const { Item } = require("../dist/game/model/Item");
  const jsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");
  jsonPersistence.register({
    getSkillManager: () => SkillManager,
    setPlayerPersistence: () => {},
    log: () => {},
  });

  // Register the attribute through the same api the plugin uses.
  presets.register({
    getPrayerHandler: () => ({}),
    getCombatFactory: () => ({}),
    getSkillManager: () => SkillManager,
    persistAttribute: (key) => PlayerSave.persistAttribute(key),
    registerCustomInterface() {},
    onCanBankItem() {},
    onInterfaceActionButton() {},
  });
  assert.equal(PlayerSave.persistentAttributeKeys.has("pvp:custom-presets"), true);

  const records = [{
    name: "Saved Build",
    inventory: [{ id: 1135, amount: 1, meta: { [Item.PRESET_META]: true } }],
    equipment: [],
    stats: [99, 99, 99, 99, 99, 99, 99],
    spellbookId: 1151,
    autocastSpellId: -1,
  }];
  const save = new PlayerSave();
  save.attributes = { "pvp:custom-presets": records };

  const restored = new jsonPersistence.JsonPlayerPersistence().hydratePlayerSave(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(restored.attributes["pvp:custom-presets"], records);
});

test("server-owned items inherit gameplay and deliver external models before definitions", async () => {
  const fs = require("node:fs");
  const { inflateSync } = require("node:zlib");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
  const { ContentApi } = require("../dist/net/http/ContentApi");
  const { encodeContentData } = require("../dist/net/protocol/ClientProtocol");
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

test("preset-spawned items carry the untradeable, unbankable and preset metadata", () => {
  const { Item } = require("../dist/game/model/Item");
  const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
  const item = presets._test.spawnPresetItem(
    new Item(ItemIdentifiers.COINS),
    presets.getGlobalPresetPool()[0],
  );

  assert.equal(item.getMetaValue(Item.UNTRADEABLE_META), true);
  assert.equal(item.getMetaValue(Item.UNBANKABLE_META), true);
  assert.equal(item.getMetaValue(Item.PRESET_META), true);
  assert.equal(item.isTradeable(), false);
  assert.equal(item.isLostOnDeath(), true);
  assert.equal(item.isUnbankable(), true);
  assert.equal(item.isPresetItem(), true);
});

test("loading a preset banks carried items but leaves preset items behind", () => {
  const { Item } = require("../dist/game/model/Item");
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const banked = [];
  const bank = { add: (item) => banked.push(item.getId()) };
  const player = {
    getInventory: () => ({ getCopiedItems: () => [new Item(1135, 1)] }),
    getEquipment: () => ({
      getCopiedItems: () => [new Item(1163, 1), new Item(4151, 1, { [Item.PRESET_META]: true })],
    }),
    getBank: () => bank,
  };
  const original = Bank.getTabForItem;
  Bank.getTabForItem = () => 0;
  try {
    assert.equal(presets._test.bankCarriedItems(player), true);
    assert.deepEqual(banked, [1135, 1163], "real items go to the bank, preset items do not");
  } finally {
    Bank.getTabForItem = original;
  }
});

test("loading a preset only puts on what the preset's own levels can wear", () => {
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const { Equipment } = require("../dist/game/model/container/impl/Equipment");
  const { PrayerHandler } = require("../dist/game/content/PrayerHandler");
  const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  // applyPreset reads requirements off ItemDefinition, which only the loader fills in.
  require("../plugins/items/ItemDefinitionLoader.plugin").register({
    log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
  });

  const preset = presets.getGlobalPresetByName("Obby Mauler");
  assert.ok(preset, "1 Attack/1 Magic/60 Ranged: two of its pieces are unwearable");

  const messages = [];
  const worn = new Map();
  const sender = {
    closeSubInterface() { return sender; },
    sendString() { return sender; },
    sendItemOnInterfaces() { return sender; },
    sendInterfaceDisplayState() { return sender; },
    sendTabInterface() { return sender; },
    sendConfig() { return sender; },
    sendTotalExp() { return sender; },
    sendMessage: (message) => messages.push(message),
  };
  const container = (onSet) => {
    const items = [];
    const api = {
      getCopiedItems: () => items,
      getAmount: () => 0,
      containsItem: () => false,
      deletes: () => {},
      addItem: (item) => items.push(item),
      resetItems: () => api,
      refreshItems: () => api,
      setItem: (slot, item) => { onSet(slot, item); return api; },
    };
    return api;
  };
  const skillManager = {
    setCurrentLevels: () => skillManager,
    setMaxLevel: () => skillManager,
    setExperience: () => skillManager,
    getMaxLevel: () => 99,
    getCombatLevel: () => 126,
  };
  const player = {
    getInterfaceId: () => -1,
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    getInventory: () => container(() => assert.fail("preset gear must not land in the inventory")),
    getEquipment: () => container((slot, item) => worn.set(slot, item)),
    getBank: () => ({ add: () => {}, getAmount: () => 0, deletes: () => {} }),
    getSkillManager: () => skillManager,
    getSpellbook: () => MagicSpellbook.NORMAL,
    setSpellbook: () => {},
    getLocation: () => null,
    getUpdateFlag: () => ({ flag: () => {} }),
    isPlayerBot: () => false,
    setAttribute: () => {},
    getAttribute: () => null,
    setSpecialPercentage: () => {},
    resetAttributes: () => {},
  };

  const patched = [
    [Bank, "getTabForItem", () => 0],
    [PrayerHandler, "canUse", () => false],
    [CombatSpecial, "updateBar", () => {}],
  ];
  patched.forEach(([owner, name]) => owner[`_${name}_original`] = owner[name]);
  patched.forEach(([owner, name, replacement]) => { owner[name] = replacement; });
  let loaded;
  try {
    loaded = presets.applyPreset(player, preset);
    assert.ok(worn.get(Equipment.WEAPON_SLOT).isPresetItem(), "human preset gear keeps its restrictions");
    messages.length = 0;
    player.isPlayerBot = () => true;
    assert.equal(presets.applyPreset(player, preset), true);
    assert.ok([...worn.values()].every((item) => !item.isPresetItem() && !item.isUnbankable() && !item.isLostOnDeath()),
      "bots receive ordinary equipment through the real preset loader");
  } finally {
    patched.forEach(([owner, name]) => { owner[name] = owner[`_${name}_original`]; delete owner[`_${name}_original`]; });
  }

  assert.equal(loaded, true, "the preset still loads");
  assert.deepEqual(messages.filter((message) => /to wear/.test(message)), [
    "You need a Magic level of at least 60 to wear your Zamorak cape.",
    "You need a Ranged level of at least 70 to wear your Black d'hide chaps.",
  ]);
  assert.ok(!worn.has(Equipment.CAPE_SLOT), "no cape at 1 Magic");
  assert.ok(!worn.has(Equipment.LEG_SLOT), "no chaps at 60 Ranged");
  assert.equal(worn.size, preset.getEquipment().length - 2, "everything else goes on");
  assert.ok(messages.includes("Preset loaded!"));
});

test("quest requirements validate the whole preset before changing gear and allow later switches", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { Item } = require("../dist/game/model/Item");
  const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");
  const { Skill } = require("../dist/game/model/Skill");
  const { Equipment } = require("../dist/game/model/container/impl/Equipment");
  const { Inventory } = require("../dist/game/model/container/impl/Inventory");
  const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
  require("../plugins/items/ItemDefinitionLoader.plugin").register({
    log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
  });
  const api = PluginManager.createApi("PresetQuestRequirementsTest");
  const incomplete = new Set(["Monkey Madness I", "Lost City"]);
  let requirementsEnabled = true;
  api.onCustomEvent("quest:is-complete", request => { request.complete = !incomplete.has(request.name); });
  require("../plugins/quests/Equipment.Quests")({
    ...api,
    getPluginConfig: (_key, fallback) => requirementsEnabled ?? fallback,
  });
  presets.register(api);

  const messages = [];
  const sender = new Proxy({
    sendMessage: text => messages.push(text),
    getVarbit: () => 0, getVarp: () => 0,
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const player = new Player(null);
  player.setSkullTimer(0);
  player.getPacketSender = () => sender;
  player.resetAttributes = () => {};
  player.getInventory().addItem(new Item(Items.COINS, 500));
  player.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(Items.BRONZE_SWORD, 1));
  player.setSpellbook(MagicSpellbook.LUNAR);
  const items = container => container.getItems().map(item => [item.getId(), item.getAmount()]);
  const snapshot = () => ({
    inventory: items(player.getInventory()), equipment: items(player.getEquipment()),
    banks: player.getBanks().map(bank => bank ? items(bank) : null),
    attack: player.getSkillManager().getMaxLevel(Skill.ATTACK), spellbook: player.getSpellbook(),
  });
  const before = snapshot();
  const preset = presets.getGlobalPresetByName("DDS Pure (M)");
  assert.ok(preset);
  assert.equal(presets.applyPreset(player, preset), false, "the worn scimitar requires Monkey Madness I");
  assert.deepEqual(snapshot(), before, "a refusal preserves inventory, equipment, bank, levels and spellbook");
  assert.ok(messages.includes("You need to complete the Monkey Madness I quest first."));

  incomplete.delete("Monkey Madness I");
  messages.length = 0;
  assert.equal(presets.applyPreset(player, preset), false, "the inventory dagger also requires Lost City");
  assert.deepEqual(snapshot(), before);
  assert.ok(messages.includes("You need to complete the Lost City quest first."));

  const switchWeapon = id => {
    const slot = player.getInventory().getItems().findIndex(item => item.getId() === id);
    assert.ok(slot >= 0, `weapon ${id} is available to switch to`);
    EquipPacketListener.equip(player, id, slot, Inventory.INTERFACE_ID);
    assert.equal(player.getEquipment().get(Equipment.WEAPON_SLOT).getId(), id);
  };
  incomplete.clear();
  assert.equal(presets.applyPreset(player, preset), true);
  assert.equal(player.getEquipment().get(Equipment.WEAPON_SLOT).getId(), Items.DRAGON_SCIMITAR);
  switchWeapon(Items.DRAGON_DAGGER_P_PLUS_PLUS_);
  switchWeapon(Items.DRAGON_SCIMITAR);

  requirementsEnabled = false;
  incomplete.add("Monkey Madness I");
  incomplete.add("Lost City");
  assert.equal(presets.applyPreset(player, preset), true, "the config override also applies to preset loads");
  switchWeapon(Items.DRAGON_DAGGER_P_PLUS_PLUS_);
  switchWeapon(Items.DRAGON_SCIMITAR);

  const { Presetable } = require("../dist/game/content/presets/Presetable");
  require("../plugins/items/CapeOfSkulls.plugin").register(api);
  let dialogues = 0;
  const manager = player.getDialogueManager();
  const startDialogues = manager.startDialogues.bind(manager);
  manager.startDialogues = (...args) => { dialogues++; return startDialogues(...args); };
  player.getInventory().resetItems().addItem(new Item(Items.CAPE_OF_SKULLS, 1));
  player.getEquipment().resetItems().refreshItems();
  requirementsEnabled = true;
  incomplete.add("Lost City");
  const cape = new Item(Items.CAPE_OF_SKULLS, 1);
  const stats = [99, 99, 99, 99, 99, 99, 99];
  const blocked = new Presetable("Cape and locked switch", [cape, new Item(Items.DRAGON_DAGGER, 1)], [], stats, MagicSpellbook.NORMAL, false);
  const beforeRefusal = snapshot();
  assert.equal(presets.applyPreset(player, blocked), false);
  assert.deepEqual(snapshot(), beforeRefusal);
  assert.equal(dialogues, 0, "a refused preset must not open the inventory cape's wear confirmation");
  assert.equal(player.getSkullTimer(), 0);

  const inventoryCape = new Presetable("Inventory cape", [cape], [], stats, MagicSpellbook.NORMAL, false);
  assert.equal(presets.applyPreset(player, inventoryCape), true, "carrying a cape is not wearing it");
  assert.equal(dialogues, 0);
  assert.equal(player.getEquipment().get(Equipment.CAPE_SLOT).getId(), -1);
  assert.equal(player.getInventory().getAmount(Items.CAPE_OF_SKULLS), 1);
  assert.equal(player.getSkullTimer(), 0);
  EquipPacketListener.equip(player, Items.CAPE_OF_SKULLS, player.getInventory().getSlotForItemId(Items.CAPE_OF_SKULLS), Inventory.INTERFACE_ID);
  assert.equal(dialogues, 1, "an actual Wear click still opens the normal confirmation");
  assert.equal(player.getSkullTimer(), 0);
});

test("dropping a preset item destroys it without the confirmation interface", () => {
  const destroy = require("../plugins/interface/DestroyItem.plugin");
  let onDrop;
  destroy.register({
    registerCustomInterface() {},
    onItemDropPolicy(handler) { onDrop = handler; },
    onInterfaceActionButton() {},
  });

  const deleted = [];
  const presetEvent = {
    player: { getInventory: () => ({ deleteAtSlot: (slot, amount) => deleted.push([slot, amount]) }) },
    item: { isPresetItem: () => true, isDropable: () => false, getAmount: () => 3 },
    slot: 4,
    handled: false,
  };
  onDrop(presetEvent);
  assert.equal(presetEvent.handled, true, "preset drops are handled");
  assert.deepEqual(deleted, [[4, 3]], "the preset item is destroyed in place");

  const realEvent = {
    player: {
      getInventory: () => ({ deleteAtSlot: () => assert.fail("real untradeables keep the prompt") }),
      setAttribute: () => {},
      getPacketSender: () => {
        const sender = {
          sendChatboxInterface: () => sender,
          sendItemOnInterface: () => sender,
          sendString: () => sender,
        };
        return sender;
      },
    },
    item: { isPresetItem: () => false, isDropable: () => false, getId: () => 1, getAmount: () => 1, getDefinition: () => ({ getName: () => "Thing" }) },
    slot: 0,
    handled: false,
  };
  onDrop(realEvent);
  assert.equal(realEvent.handled, true, "an untradeable still opens the destroy prompt");
  assert.equal(deleted.length, 1);
});

test("deposit booth slot actions reach Bank.deposit", () => {
  const booth = require("../plugins/objects/BankDepositBooth.plugin");
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  let onInterfaceActionClick;
  booth.register({
    onObjectInteraction() {},
    onCustomEvent() {},
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

test("quest-owned deposit boxes open the native bank deposit interface", () => {
  const booth = require("../plugins/objects/BankDepositBooth.plugin");
  let openQuestDeposit;
  const calls = [];
  booth.register({
    onObjectInteraction() {},
    onInterfaceActionClick() {},
    onInterfaceActionButton() {},
    onItemOnObject() {},
    onCustomEvent(name, handler) {
      if (name === "bank:open-deposit-box") openQuestDeposit = handler;
    },
    emitCanBank: () => null,
  });
  const player = {
    setInterfaceId: (id) => calls.push(["interface", id]),
    getInventory: () => ({ getItems: () => [] }),
    getPacketSender: () => new Proxy({}, { get: () => (...args) => calls.push(args) }),
  };
  assert.equal(typeof openQuestDeposit, "function");
  openQuestDeposit({ player });
  assert.deepEqual(calls[0], ["interface", 192]);
  assert.ok(calls.some((call) => call[0] === (161 << 16 | 16)), "the native deposit modal is opened");
});

test("enabled presets leave bot inventory and equipment lootable on the ground or in keys", () => {
  assert.equal(presets.isEnabled(), true);
  assertBotPresetLoot();
});

test('preset combat levels in the list match the skill manager formula', () => {
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const pool = presets.getGlobalPresetPool();
  assert.equal(pool.length, 18, 'the global preset pool is the eighteen player presets');
  for (const preset of pool) {
    const stats = preset.getStats();
    const expected = SkillManager.prototype.getCombatLevel.call({ skills: { maxLevel: stats } });
    assert.equal(
      presets._test.presetCombatLevel(preset),
      expected,
      `${preset.getName()} shows its combat level`
    );
  }
});
