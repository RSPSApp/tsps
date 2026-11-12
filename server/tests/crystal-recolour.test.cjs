// Run after `yarn build`: node --test tests/crystal-recolour.test.cjs
// Elven Clan crystals recolour crystal armour and the corrupted blade and bow (docs/crystal-armour.md).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Item } = require("../dist/game/model/Item");

const Recolour = require("../plugins/items/CrystalRecolour.plugin");

const core = PluginManager.getCoreApi();
const prompts = [];
const handlers = [];
Recolour.register({
  core,
  onItemOnItem: (handler) => handlers.push(handler),
  sendMultiChatboxPrompt: (player, title, ...options) => { prompts.push({ title, options }); return true; },
});
const obj = (name) => CacheDefinitions.getObjId(name);

function createPlayer(items) {
  const player = {
    items: [...items],
    boxes: [], sounds: [], animations: [], graphics: [], dialogues: [],
    getInventory: () => ({
      getItems: () => player.items,
      deleteItem: (item, slot) => { if (player.items[slot] === item) player.items[slot] = null; },
      refreshItems() {},
    }),
    performAnimation: (animation) => player.animations.push(animation.getId()),
    performGraphic: (graphic) => player.graphics.push(graphic.getId()),
    getPacketSender: () => ({
      sendSound: (id) => player.sounds.push(id),
      sendTypedMessage: (_type, text) => player.boxes.push(text),
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.dialogues.push([...chain.getDialogues().values()]) }),
  };
  return player;
}

function use(player, crystal, target) {
  prompts.length = 0;
  const event = { player, usedItem: crystal, usedWithItem: target, handled: false };
  handlers[0](event);
  return event;
}

test("a clan crystal on a crystal helm asks first, then recolours it in place keeping its charges", () => {
  const crystal = new Item(obj("prif_clan_crystal_iorwerth"), 1);
  const helm = new Item(obj("crystal_helmet"), 1);
  helm.setMetaValue("crystal-armour", { charges: 20000 });
  const player = createPlayer([helm, crystal]);
  assert.equal(use(player, crystal, helm).handled, true);
  assert.equal(prompts[0].title, "Are you sure you wish to recolour your Crystal helm?");
  assert.deepEqual(prompts[0].options.filter((o) => typeof o === "string"), ["Yes", "No"]);
  assert.equal(helm.getId(), obj("crystal_helmet"), "nothing changes before the answer");

  prompts[0].options[1]();
  assert.equal(helm.getId(), obj("crystal_helmet_iorwerth"));
  assert.deepEqual(helm.getMetaValue("crystal-armour"), { charges: 20000 });
  assert.equal(player.items[0], helm, "same slot");
  assert.equal(player.items[1], null, "the crystal is used up");
  assert.deepEqual(player.sounds, [144]);
  assert.deepEqual(player.animations, [CacheDefinitions.getSeqId("human_xbow_enchant_arrowtip")]);
  assert.deepEqual(player.graphics, [CacheDefinitions.getSpotanimId("xbows_enchanting_tips_spot")]);
  assert.equal(player.graphics[0], 759);
  assert.deepEqual(player.boxes, ["You use the crystal to colour your Crystal helm."]);
  const [box] = player.dialogues[0];
  assert.deepEqual(box.getItemIds(), [obj("crystal_helmet_iorwerth"), obj("prif_clan_crystal_iorwerth")]);
  assert.equal(box.getText(), "You use the crystal to colour your Crystal helm.");
});

test("No leaves both items alone", () => {
  const crystal = new Item(obj("prif_clan_crystal_iorwerth"), 1);
  const body = new Item(obj("crystal_chestplate"), 1);
  const player = createPlayer([body, crystal]);
  use(player, body, crystal);
  prompts[0].options[3]();
  assert.equal(body.getId(), obj("crystal_chestplate"));
  assert.equal(player.items[1], crystal);
});

test("every clan colours every piece, active or inactive; Meilyr brings back the base colour", () => {
  for (const piece of ["crystal_helmet", "crystal_chestplate", "crystal_platelegs"]) {
    for (const state of ["", "_inactive"]) {
      for (const clan of ["hefin", "ithell", "iorwerth", "trahaearn", "cadarn", "crwys", "amlodd"]) {
        const target = new Item(obj(`${piece}${state}`), 1);
        const crystal = new Item(obj(`prif_clan_crystal_${clan}`), 1);
        const player = createPlayer([target, crystal]);
        use(player, crystal, target);
        prompts[0].options[1]();
        assert.equal(target.getId(), obj(`${piece}${state}_${clan}`), `${piece}${state} ${clan}`);
      }
      const coloured = new Item(obj(`${piece}${state}_cadarn`), 1);
      const meilyr = new Item(obj("prif_clan_crystal_meilyr"), 1);
      const player = createPlayer([coloured, meilyr]);
      use(player, meilyr, coloured);
      prompts[0].options[1]();
      assert.equal(coloured.getId(), obj(`${piece}${state}`));
    }
  }
});

test("the corrupted blade and bow take every clan's colour, and Hefin's brings back their own", () => {
  for (const weapon of ["blade_of_saeldor_infinite", "bow_of_faerdhinen_infinite"]) {
    for (const clan of ["ithell", "iorwerth", "trahaearn", "cadarn", "crwys", "meilyr", "amlodd"]) {
      const target = new Item(obj(weapon), 1);
      const player = createPlayer([target, new Item(obj(`prif_clan_crystal_${clan}`), 1)]);
      use(player, player.items[1], target);
      prompts[0].options[1]();
      assert.equal(target.getId(), obj(`${weapon}_${clan}`), `${weapon} ${clan}`);
    }
    const coloured = new Item(obj(`${weapon}_iorwerth`), 1);
    const player = createPlayer([coloured, new Item(obj("prif_clan_crystal_hefin"), 1)]);
    use(player, player.items[1], coloured);
    prompts[0].options[1]();
    assert.equal(coloured.getId(), obj(weapon));
  }
});

test("charged weapons and other items are left to other handlers", () => {
  const crystal = new Item(obj("prif_clan_crystal_iorwerth"), 1);
  for (const name of ["bow_of_faerdhinen", "blade_of_saeldor", "crystal_bow"]) {
    const player = createPlayer([new Item(obj(name), 1), crystal]);
    assert.equal(use(player, crystal, player.items[0]).handled, false, name);
    assert.equal(prompts.length, 0);
  }
});

test("a crystal or piece moved away before the answer changes nothing", () => {
  const crystal = new Item(obj("prif_clan_crystal_ithell"), 1);
  const legs = new Item(obj("crystal_platelegs"), 1);
  const player = createPlayer([legs, crystal]);
  use(player, crystal, legs);
  player.items[1] = null;
  prompts[0].options[1]();
  assert.equal(legs.getId(), obj("crystal_platelegs"));
  assert.equal(player.sounds.length, 0);
});

test("a piece revived by shards while the question is open takes the active colour", () => {
  const crystal = new Item(obj("prif_clan_crystal_iorwerth"), 1);
  const helm = new Item(obj("crystal_helmet_inactive"), 1);
  const player = createPlayer([helm, crystal]);
  use(player, crystal, helm);
  helm.setId(obj("crystal_helmet"));
  prompts[0].options[1]();
  assert.equal(helm.getId(), obj("crystal_helmet_iorwerth"));
});

test("a crystal of the item's own colour is left unhandled and keeps the crystal", () => {
  for (const [crystalName, targetName] of [
    ["prif_clan_crystal_iorwerth", "crystal_helmet_iorwerth"],
    ["prif_clan_crystal_meilyr", "crystal_chestplate"],
    ["prif_clan_crystal_hefin", "bow_of_faerdhinen_infinite"],
  ]) {
    const crystal = new Item(obj(crystalName), 1);
    const target = new Item(obj(targetName), 1);
    const player = createPlayer([target, crystal]);
    assert.equal(use(player, crystal, target).handled, false, targetName);
    assert.equal(prompts.length, 0);
    assert.equal(player.items[1], crystal);
    assert.equal(target.getId(), obj(targetName));
  }
});
