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
  await h.setup([[3193, 3233], [3055, 3305], [1235, 3752]]);
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

test("Guppa and Argo, whose Wiki menus have no advice question, leave it out (Transcript:Guppa)", () => {
  const Gardeners = require("../plugins/skills/farming/Gardeners.Farming");
  for (const name of ["Guppa", "Argo"]) {
    assert.deepEqual(Gardeners.menu(name)[0].options.map((o) => o.text),
      ["Would you look after my crops for me?", "Can you sell me something?", "I'll come back another time."], name);
  }
  assert.equal(Gardeners.menu("Elstan")[0].options.length, 4, "no page: the captured menu");
  assert.equal(Gardeners.menu("Fayeth")[0].options.length, 4);
});

const OAK = () => Data.CROPS.get("OAK");
/** Fayeth's tree patch with a growing oak, and the basket of tomatoes she wants when `pay`. */
function oakFor(f, { pay = true, protectedPatch = false } = {}) {
  const patch = treePatch(FAYETH);
  Object.assign(Patches.stateFor(f.player, patch), { crop: "OAK", status: "growing", stage: 1, protected: protectedPatch });
  if (pay) f.player.getInventory().add(new h.core.Item(OAK().payment[0][0], 1), false);
  return Patches.stateFor(f.player, patch);
}
const DEAL_MENU = "Okay, it's a deal.|No, that's too much.|Okay, it's a deal and don't ask again.";
const ASK = "If you like, but I want one basket of tomatoes for that.";

test("look after a growing oak: her price, the deal menu, then paid and protected (Aub, 1001562; Wiki, Transcript:Fayeth)", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const state = oakFor(f);
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  const said = await h.converse(f, () => h.talk(f, fayeth), ["Would you look after my crops for me?", "Okay, it's a deal."]);
  assert.deepEqual(said.slice(1), [
    "PLAYER: Would you look after my crops for me?", `Fayeth: ${ASK}`, `MENU[Select an option]: ${DEAL_MENU}`,
    "PLAYER: Okay, it's a deal.", "Fayeth: That'll do nicely, sir. Leave it with me - I'll make sure that patch grows for you."]);
  assert.equal(state.protected, true);
  assert.equal(f.player.getInventory().getAmount(OAK().payment[0][0]), 0);
  assert.ok(f.messages.some((m) => m.text === "You pay the gardener one basket of tomatoes to protect the patch."), JSON.stringify(f.messages));
});

test("'No, that's too much.' and no payment held: 'Well, I'm not wasting my time for free.', nothing taken (Wiki)", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const state = oakFor(f);
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  let said = await h.converse(f, () => h.talk(f, fayeth), ["Would you look after my crops for me?", "No, that's too much."]);
  assert.deepEqual(said.slice(-2), ["PLAYER: No, that's too much.", "Fayeth: Well, I'm not wasting my time for free."]);
  assert.equal(state.protected, false);
  assert.equal(f.player.getInventory().getAmount(OAK().payment[0][0]), 1);
  f.player.getInventory().deleteNumber(OAK().payment[0][0], 1);
  assert.equal(f.player.getInventory().getAmount(OAK().payment[0][0]), 0);
  said = await h.converse(f, () => h.talk(f, fayeth), ["Would you look after my crops for me?"]);
  assert.deepEqual(said.slice(1), ["PLAYER: Would you look after my crops for me?", `Fayeth: ${ASK}`,
    "PLAYER: I'm afraid I don't have any of those at the moment.", "Fayeth: Well, I'm not wasting my time for free."]);
});

test("'Okay, it's a deal and don't ask again.' pays and turns the confirmation off; already protected is the Wiki answer", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const state = oakFor(f);
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  const said = await h.converse(f, () => h.talk(f, fayeth), ["Would you look after my crops for me?", "Okay, it's a deal and don't ask again."]);
  assert.equal(said.at(-1), "Fayeth: That'll do nicely, sir. Leave it with me - I'll make sure that patch grows for you.");
  assert.equal(state.protected, true);
  assert.equal(f.player.getPacketSender().getVarbit(98), 1, "settings_warning_confirmation_farming_protection");
  const again = await h.converse(f, () => h.talk(f, fayeth), ["Would you look after my crops for me?"]);
  assert.deepEqual(again.slice(2), ["Fayeth: I don't know what you're talking about - I'm already looking after that patch for you.", "PLAYER: Oh sorry, I forgot."]);
});

test("Elstan's two allotments: 'which one', the patches by their Pay directions, then the empty-patch answer (Dantaera, 1000296)", async (t) => {
  const f = h.actor(t, { at: BY_ELSTAN, stage: 100 });
  const elstan = h.spawn(f, N.ELSTAN, ELSTAN);
  const said = await h.converse(f, () => h.talk(f, elstan), ["Would you look after my crops for me?", "The northwestern allotment"]);
  assert.deepEqual(said.slice(1), ["PLAYER: Would you look after my crops for me?", "Elstan: I might - which one were you thinking of?",
    "MENU[Select an option]: The northwestern allotment|The southeastern allotment",
    "Elstan: You don't have any seeds planted in that patch. Plant some and I might agree to look after it for you."]);
});

test("a grown tree and a patch still to protect: both questions, as Alexandra's Wiki menu has them", () => {
  const Gardeners = require("../plugins/skills/farming/Gardeners.Farming");
  assert.deepEqual(Gardeners.menu("Elstan", { chop: true, lookAfter: true })[0].options.map((o) => o.text).slice(0, 2),
    ["Would you look after my crops for me?", "Would you chop my tree down for me?"]);
  assert.deepEqual(Gardeners.menu("Fayeth", { chop: true, lookAfter: false })[0].options[0].text, "Would you chop my tree down for me?");
});

const guildPatch = (x, y) => Data.CACHE.patches.find((p) => p.x === x && p.y === y && p.z === 0);

test("Farming Guild: Taylor keeps to her celastrus; Nikkie's grown apple tree is not hers to chop (Pay (Celastrus tree))", async (t) => {
  const f = h.actor(t, { at: [1246, 3752, 0], stage: 100, farming: 99 });
  const apple = guildPatch(1242, 3758);
  assert.equal(apple?.type, "FRUIT_TREE");
  Object.assign(Patches.stateFor(f.player, apple), { crop: "APPLE", status: "grown" });
  const taylor = h.spawn(f, 8629, [1246, 3753, 0]);
  await h.talk(f, taylor);
  assert.equal(h.shown(f).text, MENU);
  const said = await h.converse(f, async () => {}, ["Would you look after my crops for me?"]);
  assert.deepEqual(said.slice(0, 2), ["PLAYER: Would you look after my crops for me?",
    "Taylor: You don't have a sapling planted in that patch. Plant one and I might agree to look after it for you."], JSON.stringify(said));
});

test("Farming Guild: Alexandra looks after her redwood only, so no 'which one' (Pay (Redwood tree))", async (t) => {
  const f = h.actor(t, { at: [1236, 3752, 0], stage: 100, farming: 99 });
  const alexandra = h.spawn(f, 8536, [1235, 3752, 0]);
  const said = await h.converse(f, () => h.talk(f, alexandra), ["Would you look after my crops for me?"]);
  assert.ok(!said.some((line) => line.includes("which one")), JSON.stringify(said));
  assert.ok(said.at(-1).startsWith("Alexandra: You don't have a sapling planted"), JSON.stringify(said));
});

test("a deal whose payment left at the menu: the Wiki's no-payment answer, nothing protected, 'don't ask again' not kept", async (t) => {
  const f = h.actor(t, { at: BY_FAYETH, stage: 100 });
  const state = oakFor(f);
  const fayeth = h.spawn(f, N.FAYETH, FAYETH);
  await h.converse(f, () => h.talk(f, fayeth), ["Would you look after my crops for me?"]);
  assert.equal(h.shown(f).text, DEAL_MENU);
  f.player.getInventory().deleteNumber(OAK().payment[0][0], 1);
  const said = await h.converse(f, () => h.choose(f, "Okay, it's a deal and don't ask again."));
  assert.deepEqual(said.slice(-2), ["PLAYER: I'm afraid I don't have any of those at the moment.", "Fayeth: Well, I'm not wasting my time for free."]);
  assert.equal(state.protected, false);
  assert.notEqual(f.player.getPacketSender().getVarbit(98), 1);
});
