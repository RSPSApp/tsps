// Run after `yarn build`: node --test tests/player-save.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

test("a snapshot retains trade escrow without changing the live trade", () => {
  const { Item } = require("../dist/game/model/Item");
  const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
  const original = ItemDefinition.forId;
  ItemDefinition.forId = () => ({ isStackable: () => true });
  try {
    const player = new Player(null);
    player.getTrading().getContainer().setItem(0, new Item(995, 100, { source: "escrow" }));
    const save = PlayerSave.fromPlayer(player);
    const coins = save.getInventory().find(item => item.getId() === 995);
    assert.equal(coins.getAmount(), 100);
    assert.deepEqual(coins.getMeta(), { source: "escrow" });
    assert.equal(player.getInventory().getAmount(995), 0);
    assert.equal(player.getTrading().getContainer().getAmount(995), 100);
  } finally {
    ItemDefinition.forId = original;
  }
});

test("bank preferences survive a save and load", () => {
  const player = new Player(null);
  player.setNoteWithdrawal(true);
  player.setInsertMode(true);
  player.setBankQuantityMode(4);
  player.setBankCustomQuantity(137);
  player.setPlaceholders(true);

  const save = PlayerSave.fromPlayer(player);
  const loaded = new Player(null);
  save.applyToPlayer(loaded);

  assert.equal(loaded.withdrawAsNote(), true);
  assert.equal(loaded.insertModeReturn(), true);
  assert.equal(loaded.getBankQuantityMode(), 4);
  assert.equal(loaded.getBankCustomQuantity(), 137);
  assert.equal(loaded.isPlaceholders(), true);

  const resaved = PlayerSave.fromPlayer(loaded);
  assert.deepEqual(resaved.attributes, {
    "bank:note-withdrawal": true,
    "bank:insert-mode": true,
    "bank:quantity-mode": 4,
    "bank:custom-quantity": 137,
    "bank:placeholders": true,
  });
  for (const field of [
    "bankNoteWithdrawal",
    "bankInsertMode",
    "bankQuantityMode",
    "bankCustomQuantity",
    "bankPlaceholders",
  ]) {
    assert.equal(field in resaved, false, `${field} is no longer a dedicated save field`);
  }
});

test("older saves without bank preferences retain the defaults", () => {
  const save = PlayerSave.fromPlayer(new Player(null));

  const loaded = new Player(null);
  save.applyToPlayer(loaded);

  assert.equal(loaded.withdrawAsNote(), false);
  assert.equal(loaded.insertModeReturn(), false);
  assert.equal(loaded.getBankQuantityMode(), 0);
  assert.equal(loaded.getBankCustomQuantity(), 0);
  assert.equal(loaded.isPlaceholders(), false);
  assert.deepEqual(PlayerSave.fromPlayer(loaded).attributes, {});
});

test("legacy dedicated bank fields migrate to persistent attributes", () => {
  const save = Object.assign(PlayerSave.fromPlayer(new Player(null)), {
    bankNoteWithdrawal: true,
    bankInsertMode: true,
    bankQuantityMode: 4,
    bankCustomQuantity: 137,
    bankPlaceholders: true,
  });
  const loaded = new Player(null);
  save.applyToPlayer(loaded);

  assert.equal(loaded.withdrawAsNote(), true);
  assert.equal(loaded.insertModeReturn(), true);
  assert.equal(loaded.getBankQuantityMode(), 4);
  assert.equal(loaded.getBankCustomQuantity(), 137);
  assert.equal(loaded.isPlaceholders(), true);
  assert.deepEqual(PlayerSave.fromPlayer(loaded).attributes, {
    "bank:note-withdrawal": true,
    "bank:insert-mode": true,
    "bank:quantity-mode": 4,
    "bank:custom-quantity": 137,
    "bank:placeholders": true,
  });
});

test("an older save's player fields load as attributes and are saved back as attributes", () => {
  const save = Object.assign(PlayerSave.fromPlayer(new Player(null)), {
    pcPoints: 250,
    recentKills: ["1.2.3.4"],
    xpLocked: true,
  });
  save.attributes["killstreaks:deaths"] = 3;

  const player = new Player(null);
  save.applyToPlayer(player);
  const resaved = PlayerSave.fromPlayer(player);

  assert.deepEqual(resaved.attributes, {
    "pest-control:points": 250,
    "killstreaks:recent-kills": ["1.2.3.4"],
    "skills:xp-locked": true,
    "killstreaks:deaths": 3,
  });
  assert.equal("pcPoints" in resaved, false, "the old field is not written again");
});

test("an attribute already in the save wins over the old field", () => {
  const save = Object.assign(PlayerSave.fromPlayer(new Player(null)), { totalKills: 1 });
  save.attributes["killstreaks:total-kills"] = 9;

  const player = new Player(null);
  save.applyToPlayer(player);

  assert.equal(player.getAttribute("killstreaks:total-kills"), 9);
});

test("camelCase attribute keys from older saves migrate to kebab-case", () => {
  PlayerSave.persistAttribute("warriors-guild:defender");
  const save = PlayerSave.fromPlayer(new Player(null));
  save.attributes["warriorsGuild:defender"] = true;

  const player = new Player(null);
  save.applyToPlayer(player);
  assert.equal(player.getAttribute("warriors-guild:defender"), true);

  const resaved = PlayerSave.fromPlayer(player);
  assert.deepEqual(resaved.attributes, { "warriors-guild:defender": true });
});

test("an attribute equal to its default isn't saved, and loads as the default when missing", () => {
  PlayerSave.persistAttribute("test:keybind", 1);
  const player = new Player(null);
  player.setAttribute("test:keybind", 1);
  const save = PlayerSave.fromPlayer(player);
  assert.equal("test:keybind" in save.attributes, false);

  const loaded = new Player(null);
  save.applyToPlayer(loaded);
  assert.equal(loaded.getAttribute("test:keybind"), 1);

  loaded.setAttribute("test:keybind", 0);
  const resaved = PlayerSave.fromPlayer(loaded);
  assert.equal(resaved.attributes["test:keybind"], 0, "an empty value that isn't the default is kept");
});

test("a saved member rejoins an offline owner's channel with saved settings and rank", () => {
  const { Misc } = require("../dist/util/Misc");
  const { FriendsChatManager, CLAN_CHAT_ATTRIBUTE } = require("../plugins/interface/FriendsChatManager");
  const { GameConstants } = require("../dist/game/GameConstants");
  const { World } = require("../dist/game/World");
  const oldPersistence = GameConstants.PLAYER_PERSISTENCE;
  const oldGetPlayers = World.getPlayers;
  const { channels, membershipByPlayer, temporaryBans, offlinePlayerIds } = FriendsChatManager;
  channels.clear();
  membershipByPlayer.clear();
  temporaryBans.clear();
  offlinePlayerIds.clear();

  const session = { write() {}, sendClientPacket() {} };
  const owner = new Player(session);
  owner.setUsername("Clan Owner");
  owner.setLongUsername(Misc.stringToLongBigInt("clan owner"));
  owner.setIndex(10);
  const friend = Misc.stringToLongBigInt("friend");
  owner.getRelations().getFriendList().push(friend);
  owner.getRelations().loadFriendRanks({ [friend.toString()]: 5 });
  owner.getRelations().setFriendsChatChannelName("My channel");
  owner.getRelations().setFriendsChatRanks(1, 4, 6);
  owner.getRelations().onLogin(owner);
  const ownerSave = PlayerSave.fromPlayer(owner);

  const beforeLogin = new Player(session);
  beforeLogin.setUsername("Friend");
  beforeLogin.setLongUsername(friend);
  beforeLogin.setIndex(11);
  beforeLogin.getRelations().setFriendsChatLastOwner("Clan Owner");
  const memberSave = PlayerSave.fromPlayer(beforeLogin);
  const member = new Player(session);
  memberSave.applyToPlayer(member);
  member.setUsername("Friend");
  member.setLongUsername(friend);
  member.setIndex(11);

  try {
    World.getPlayers = () => ({ search: () => undefined, forEach() {} });
    GameConstants.PLAYER_PERSISTENCE = {
      load: () => ownerSave,
      requestSave() {},
    };
    FriendsChatManager.onLogin(member);

    const channel = FriendsChatManager.channelOf(member);
    assert.equal(channel?.name, "My channel");
    assert.equal(channel?.ownerName, "Clan Owner");
    assert.equal(channel?.rankOf(member), 5);
    assert.equal(member.getRelations().getFriendsChatLastOwner(), "Clan Owner");
    assert.deepEqual(
      [ownerSave.getFriendsChatEntryRank(), ownerSave.getFriendsChatTalkRank(), ownerSave.getFriendsChatKickRank()],
      [1, 4, 6],
    );

    FriendsChatManager.onLogout(member);
    assert.equal(FriendsChatManager.channelOf(member), null);
    assert.equal(member.getAttribute(CLAN_CHAT_ATTRIBUTE), null);
    assert.equal(member.getRelations().getFriendsChatLastOwner(), "Clan Owner");
  } finally {
    channels.clear();
    membershipByPlayer.clear();
    temporaryBans.clear();
    offlinePlayerIds.clear();
    GameConstants.PLAYER_PERSISTENCE = oldPersistence;
    World.getPlayers = oldGetPlayers;
  }
});
