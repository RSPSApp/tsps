// Run after `yarn build`: node --test tests/player-save.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

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
