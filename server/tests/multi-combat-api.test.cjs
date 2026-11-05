const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { ContentApi } = require("../dist/net/http/ContentApi");
const plugin = require("../plugins/world/MultiCombatApi.plugin");

test("production exposes only gameplay multicombat bounds through the content API", (t) => {
  const previous = Server.PRODUCTION;
  Server.PRODUCTION = true;
  t.after(() => { Server.PRODUCTION = previous; ContentApi.clear(); });
  const zones = [
    { minX: 1, maxX: 2, minY: 3, maxY: 4, tags: ["multi-combat"], secret: "omit" },
    { minX: 5, maxX: 6, minY: 7, maxY: 8, z: 2, tags: ["multi-combat"] },
    { minX: 9, maxX: 10, minY: 11, maxY: 12, tags: ["pvp"] },
  ];
  plugin.register({
    core: { WorldDefinition: { getWorldDefinition: () => ({ zones, pluginConfig: { credentials: "private" } }) } },
    registerContentEndpoint: (name, handler) => ContentApi.register(name, handler),
  });
  assert.deepEqual(JSON.parse(ContentApi.resolve("GET", "/api/multi-combat").body), [
    { minX: 1, maxX: 2, minY: 3, maxY: 4, z: 0 },
    { minX: 5, maxX: 6, minY: 7, maxY: 8, z: 2 },
  ]);
  zones.push({ tags: ["multi-combat"] });
  const global = JSON.parse(ContentApi.resolve("GET", "/api/multi-combat").body).slice(2);
  assert.deepEqual(global, [0, 1, 2, 3].map((z) => ({ minX: 0, maxX: 0x3fff, minY: 0, maxY: 0x3fff, z })));
  assert.equal(ContentApi.resolve("GET", "/api/multi-combat/unknown").status, 404);
  assert.equal(ContentApi.resolve("POST", "/api/multi-combat").status, 405);
});
