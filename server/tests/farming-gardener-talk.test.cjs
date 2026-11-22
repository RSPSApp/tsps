// Run after `yarn build`: node --test tests/farming-gardener-talk.test.cjs
//
// A gardener's Talk-to, Pay and Trade (issue #6429) with the real plugins, cache and map: talks are packets.
// rsprox captures: Elstan's menu (local 1001683 tick 9331, 1002189 tick 1506), Fayeth's "Can you sell me
// something?" into the Farming Supplies shop (1000149 tick 1863), Garth's (03030 tick 4108). docs/farming.md.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
// Loaded once the plugin has filled in Core.Farming (setup).
let Patches;
let Data;

const FAYETH = [3193, 3233, 0];
const BY_FAYETH = [3192, 3233, 0];
const ELSTAN = [3055, 3305, 0];
const BY_ELSTAN = [3055, 3304, 0];
const MENU = "Would you look after my crops for me?|Can you give me any farming advice?|Can you sell me something?|I'll come back another time.";
const NO_SAPLING = "You don't have a sapling planted in that patch. Plant one and I might agree to look after it for you.";
const SELL_REPLY = "That depends on whether I have it to sell. What is it that you're looking for?";

let N;
before(async () => {
  await h.setup([[3193, 3233], [3055, 3305]]);
  // The game builder's shops, which the harness does not load: shops.json and the plugins' own.
  new ShopDefinitionLoader().load();
  ShopManager.initialize();
  const open = ShopManager.open;
  ShopManager.open = function (player, shopId, ...rest) {
    const result = open.call(this, player, shopId, ...rest);
    if (result) opened.set(player, h.core.ShopDefinition.forId(shopId)?.getName());
    return result;
  };
  N = h.core.NpcIdentifiers;
  Patches = require("../plugins/skills/farming/Patches.Farming");
  Data = require("../plugins/skills/farming/Data.Farming");
});
after(() => h.teardown());

/** The shop last opened for the player, by name (ShopManager.open, as the dialogue and Trade call it). */
const opened = new Map();
const shop = (f) => opened.get(f.player) ?? null;
const treePatch = (tile) => Data.CACHE.patches.find((p) => p.type === "TREE" && Math.abs(p.x - tile[0]) <= 10 && Math.abs(p.y - tile[1]) <= 10);

test("Talk-to on Fayeth with nothing planted opens her menu, not the protection answer (#6429)", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  await h.talk(f, fayeth);
  assert.deepEqual(h.shown(f), { who: "menu", text: MENU, title: "Select an option" }, JSON.stringify(f.said));
  assert.ok(!f.said.some((s) => s.text === NO_SAPLING));
});

test("'Can you sell me something?': the line, Fayeth's answer, then Farming Supplies on the Continue (1000149 tick 1863)", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  await h.talk(f, fayeth);
  await h.choose(f, "Can you sell me something?");
  assert.deepEqual(h.shown(f), { who: "PLAYER", text: "Can you sell me something?", npcId: h.shown(f).npcId });
  await h.continueLine(f);
  assert.equal(h.shown(f).who, "Fayeth");
  assert.equal(h.shown(f).text, SELL_REPLY);
  assert.equal(shop(f), null, "not before the Continue");
  await h.continueLine(f);
  assert.equal(shop(f), "Farming Supplies");
});

test("'Would you look after my crops for me?' says the line, then gives the protection answer", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  const said = await h.converse(f, () => h.talk(f, fayeth), ["Would you look after my crops for me?"]);
  assert.deepEqual(said.slice(1), ["PLAYER: Would you look after my crops for me?", `Fayeth: ${NO_SAPLING}`]);
});

test("'I'll come back another time.' is the player's line and the end", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  const said = await h.converse(f, () => h.talk(f, fayeth), ["I'll come back another time."]);
  assert.deepEqual(said.slice(1), ["PLAYER: I'll come back another time."]);
  assert.equal(h.shown(f), null);
});

test("Elstan, with no Wiki transcript: the same menu, a tip for the advice, then the menu again", async (t) => {
  const f = h.actor(t, { at: BY_ELSTAN, stage: 100 });
  const elstan = h.spawn(f, N.ELSTAN, ELSTAN);
  await h.talk(f, elstan);
  assert.equal(h.shown(f).text, MENU);
  await h.choose(f, "Can you give me any farming advice?");
  assert.equal(h.shown(f).text, "Can you give me any farming advice?");
  await h.continueLine(f);
  assert.equal(h.shown(f).who, "Elstan");
  assert.ok(h.shown(f).text.length > 20, h.shown(f).text);
  for (let i = 0; i < 6 && h.shown(f)?.who !== "menu"; i++) await h.continueLine(f);
  assert.equal(h.shown(f)?.text, MENU);
});

test("Pay still makes the protection answer straight away, and Trade opens Farming Supplies", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  await h.talk(f, fayeth, 3);
  assert.equal(h.shown(f).text, NO_SAPLING);
  f.player.getDialogueManager().reset();
  f.player.getPacketSender().sendInterfaceRemoval();
  h.tick(f);
  await h.talk(f, fayeth, 5);
  for (let i = 0; i < 5 && !shop(f); i++) h.tick(f);
  assert.equal(shop(f), "Farming Supplies");
});

test("a grown tree: 'Would you chop my tree down for me?' in place of the protection question (Wiki, Transcript: Fayeth)", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const patch = treePatch(FAYETH);
  assert.ok(patch, "Lumbridge tree patch");
  Object.assign(Patches.stateFor(f.player, patch), { crop: "OAK", status: "grown" });
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  await h.talk(f, fayeth);
  assert.equal(h.shown(f).text, MENU.replace("Would you look after my crops for me?", "Would you chop my tree down for me?"));
  await h.choose(f, "Would you chop my tree down for me?");
  await h.continueLine(f);
  // The felling offer is the Pay option's (Patches.choose, an OptionDialogue).
  const offer = f.player.getDialogueManager().getCurrent();
  assert.equal(offer?.constructor.name, "OptionDialogue", JSON.stringify(f.said));
  assert.equal(offer.getTitle(), "Pay 200 Coins to have your tree chopped down?");
});
