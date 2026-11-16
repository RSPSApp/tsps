const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createRequestHandler } = require("../plugins/tools/worldadmin/Http.WorldAdmin");
const sprites = require("../plugins/world/CustomSprites.plugin");

test("the admin saves and resets both images served by the world", async t => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-artwork-"));
  process.chdir(dir);
  t.after(() => { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); });

  const banner = fs.readFileSync(path.resolve(__dirname, "../data/sprites/30000-welcome-banner.png"), "base64");
  const background = fs.readFileSync(path.resolve(__dirname, "../../client/public/images/loading-bg.jpg"), "base64");
  const resources = new Map();
  sprites.register({ registerContentEndpoint: (name, handler) => resources.set(name, handler), log() {} });
  const sprite = () => resources.get("sprites")(null, ["30000"]);
  const title = () => resources.get("client-background")(null, []);
  assert.equal(sprite(), undefined);
  assert.equal(title(), undefined);

  const token = "client-artwork-test-token";
  const access = { token, loopback: true, port: () => server.address().port };
  const server = http.createServer(createRequestHandler(access, {}, []));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${access.port()}/api/client-artwork/`;
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const save = (id, data, extra = {}) => fetch(base + id, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ data }) });

  assert.equal((await fetch(base + "banner")).status, 401);
  assert.equal((await save("background", background, { Origin: "https://unrelated.example" })).status, 403);
  assert.equal((await save("banner", background)).status, 400);
  assert.equal((await save("background", "bad")).status, 400);
  assert.equal((await save("banner", banner)).status, 200);
  assert.equal((await save("background", background)).status, 200);
  assert.deepEqual(await (await fetch(base + "banner", { headers })).json(), { data: banner });
  assert.deepEqual(sprite(), { id: 30000, png: banner });
  assert.deepEqual(title(), { jpg: background });
  assert.equal((await save("banner", null)).status, 200);
  assert.equal((await save("background", null)).status, 200);
  assert.equal(sprite(), undefined);
  assert.equal(title(), undefined);
});
