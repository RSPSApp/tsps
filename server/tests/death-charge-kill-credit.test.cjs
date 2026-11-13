// Run after `yarn build`: node --test tests/death-charge-kill-credit.test.cjs
// Wiki (Death Charge): the restore goes to the player who landed the killing blow (in multicombat, the last
// player to hit the creature), not the player who dealt it the most damage.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");

const MAN = 3106;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

let next = 9700;
function fighter(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername("charger" + player.getIndex()); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new Location(3222, 3218, 0));
  player.setSpecialPercentage(50);
  t.after(() => player.setRegistered(false));
  return player;
}

test("Death Charge restores for the last player to hit the kill, not the top damager", (t) => {
  const npc = new NPC(MAN, new Location(3223, 3218, 0));
  const top = fighter(t);
  const last = fighter(t);
  for (const player of [top, last]) player.setAttribute(ArceuusSpells.DEATH_CHARGE_UNTIL, World.getProcessCycle() + 100);
  npc.getCombat().addDamage(top, 6);
  npc.getCombat().addDamage(last, 1);
  const death = new NPCDeathTask(npc);
  t.mock.method(death, "remove", () => {});
  death.execute();
  death.execute();
  assert.equal(last.getSpecialPercentage(), 65, "the last hitter gets 15%");
  assert.equal(ArceuusSpells.hasDeathCharge(last), false);
  assert.equal(top.getSpecialPercentage(), 50, "the top damager gets nothing");
  assert.equal(ArceuusSpells.hasDeathCharge(top), true, "and keeps the charge");
});
