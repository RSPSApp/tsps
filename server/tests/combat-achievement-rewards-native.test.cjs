const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ForceMovement } = require("../dist/game/model/ForceMovement");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
const Progress = require("../plugins/achievements/combatachievements/Progress.CombatAchievements");
let core,
  next = 100;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2860, 3542);
});
function actor(t) {
  const channel = {
    kind: "test",
    remoteAddress: "127.0.0.1",
    isOpen: () => true,
    send: () => true,
    close() {},
    onData() {},
    onError() {},
    onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("careward" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(2860, 3542, 0));
  p.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (text) => {
    messages.push(text);
    return p.getPacketSender();
  });
  return { p, connection, messages };
}
function earned(f, tier) {
  const words = Data.TASK_VARPS.map(() => 0);
  for (const task of Data.tasks().values())
    words[task.id >>> 5] |= 1 << (task.id & 31);
  f.p.setAttribute("combat-achievements:completed", words);
  f.p.setAttribute(
    "combat-achievements:claimed",
    Data.tiers()
      .filter((t) => t.tier < tier)
      .map((t) => t.tier),
  );
}
function npc(t, f, name = "Ghommal") {
  const id =
      name === "Ghommal"
        ? core.NpcIdentifiers.GHOMMAL_3
        : core.NpcIdentifiers.LAIDEE_GNONOCK,
    npc = core.NPC.create(id, new core.Location(2860, 3543, 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}
function talk(f, npc) {
  f.debug = {
    npc: npc.getCurrentDefinition(f.p)?.getName(),
    id: npc.getId(),
    tiers: Progress.claimableTiers(f.p).map((t) => t.tier),
    variant:
      require("../plugins/achievements/combatachievements/Rewards.CombatAchievements").dialogueVariant(
        { player: f.p, definition: npc.getCurrentDefinition(f.p) },
      ),
  };
  return PluginManager.emitNpcInteraction({
    player: f.p,
    npc,
    npcId: npc.getId(),
    definition: npc.getCurrentDefinition(f.p),
    clickType: 1,
    handled: false,
  });
}
async function resume(f, choice) {
  const group = f.p.getPacketSender().getChatboxGroupId(),
    widgetId =
      choice == null
        ? (group << 16) | ([231, 217].includes(group) ? 5 : 0)
        : core.OptionDialogue.OPTIONS_WIDGET_ID;
  await f.connection.dispatch([
    { type: "dialogue_continue", widgetId, childIndex: choice ?? -1 },
  ]);
  f.connection.processTurnPackets();
}
async function confirmation(f) {
  for (let i = 0; i < 45; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const index = menu.options.findIndex(
        (x) =>
          x.startsWith("I'm here to talk about Combat Achievements") ||
          x.startsWith("I think I've completed a combat tier"),
      );
      assert.ok(index >= 0, "missing reward choice " + JSON.stringify(menu));
      await resume(f, index + 1);
      continue;
    }
    const d = f.p.getDialogueManager().getCurrent();
    assert.ok(
      d,
      "reward dialogue ended before confirmation " +
        JSON.stringify({
          debug: f.debug,
          history: f.history,
          messages: f.messages,
          chatbox: f.p.getPacketSender().getChatboxGroupId(),
        }),
    );
    const raw = d.getText?.(),
      text = (Array.isArray(raw) ? raw.join(" ") : String(raw ?? ""))
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    (f.history ??= []).push(text);
    if (
      text === "Yes please!" ||
      text === "You have come very far. You have earned these rewards."
    )
      return;
    await resume(f);
  }
  throw Error("reward confirmation not reached");
}

function lamp(f, tier) {
  const item = new core.Item(tier.lamp);
  f.p.getInventory().add(item, false);
  const slot = f.p.getInventory().getItems().indexOf(item);
  const actual = f.p
      .getInventory()
      .getItems()
      .find((i) => i.getId() === tier.lamp),
    actualSlot = f.p.getInventory().getItems().indexOf(actual);
  const result = PluginManager.emitItemAction({
    player: f.p,
    item: actual,
    itemId: tier.lamp,
    slot: actualSlot,
    interfaceId: core.CacheDefinitions.getComponentId("inventory:items"),
    option: "Rub",
    clickType: 1,
    handled: false,
  });
  assert.equal(result, true);
  return { item: actual, slot: actualSlot };
}
async function lampConfirm(f) {
  const C = core.CacheDefinitions,
    choice =
      [...C.getEnumValues(681)].find(
        ([k, v]) => v === core.Skill.RUNECRAFTING.getClientId(),
      )[0] - 1;
  await f.connection.dispatch([
    {
      type: "dialogue_continue",
      widgetId: C.getComponentId("xpreward:universe"),
      childIndex: choice,
    },
  ]);
  f.connection.processTurnPackets();
}
function skillLevel(f, level = 20) {
  f.p.getSkillManager().setCurrentLevels(core.Skill.RUNECRAFTING, level);
  f.p.getSkillManager().setMaxLevel(core.Skill.RUNECRAFTING, level);
  f.p
    .getSkillManager()
    .setExperience(
      core.Skill.RUNECRAFTING,
      SkillManager.getExperienceForLevel(level),
    );
  return f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING);
}
function invalidate(f, mode) {
  if (mode === "dead") f.p.setHitpoints(0);
  if (mode === "trade") f.p.setStatus(core.PlayerStatus.TRADING);
  if (mode === "placed") f.p.needsPlacement = true;
  if (mode === "teleport") f.p.setTeleporting(true);
  if (mode === "forced")
    f.p.setForceMovement(
      new ForceMovement(
        f.p.getLocation().clone(),
        f.p.getLocation().clone(),
        1,
        1,
        0,
        -1,
      ),
    );
  if (mode === "remote") f.p.setLocation(new core.Location(3300, 3300, 0));
}

test("both reward NPCs grant their available tiers through canonical native confirmation exactly once", async (t) => {
  for (const name of ["Ghommal", "Laidee Gnonock"])
    for (const tier of Data.tiers().filter(
      (row) => name !== "Ghommal" || row.tier < 6,
    )) {
      const f = actor(t);
      earned(f, tier.tier);
      const target = npc(t, f, name);
      talk(f, target);
      await confirmation(f);
      await resume(f);
      const nextLine = f.p.getDialogueManager().getCurrent()?.getText?.();
      assert.doesNotMatch(
        String(nextLine),
        /need at least.*inventory spaces/i,
        "successful claim must not take the no-space branch",
      );
      assert.equal(Progress.tierStatus(f.p, tier), 2, name + " " + tier.name);
      assert.equal(f.p.getInventory().getAmount(tier.lamp), 1);
      assert.equal(f.p.getInventory().getAmount(tier.hilt), 1);
      if (tier.tier === 5)
        assert.equal(
          f.p
            .getInventory()
            .getAmount(core.ItemIdentifiers.GHOMMALS_LUCKY_PENNY),
          1,
        );
      await resume(f);
      assert.equal(f.p.getInventory().getAmount(tier.lamp), 1);
    }
});

test("a delayed tier confirmation rechecks life, status, movement and the original nearby NPC", async (t) => {
  const tier = Data.tiers()[0];
  for (const mode of [
    "dead",
    "trade",
    "placed",
    "teleport",
    "forced",
    "remote",
    "owner",
  ]) {
    const f = actor(t);
    earned(f, 1);
    const target = npc(t, f);
    talk(f, target);
    await confirmation(f);
    if (mode === "owner") {
      target.setOwner(actor(t).p);
      target.setOwnerOnly(true);
    } else invalidate(f, mode);
    await resume(f);
    assert.equal(f.p.getInventory().getAmount(tier.lamp), 0, mode);
    assert.equal(Progress.claimedTiers(f.p).has(1), false, mode);
  }
});

test("a bag filled after confirmation keeps the entire tier unclaimed, while an exact-fit bag receives both items", async (t) => {
  for (const free of [0, 2]) {
    const f = actor(t),
      tier = Data.tiers()[0];
    earned(f, 1);
    talk(f, npc(t, f));
    await confirmation(f);
    while (f.p.getInventory().getFreeSlots() > free)
      f.p.getInventory().add(new core.Item(core.ItemIdentifiers.SPADE), false);
    await resume(f);
    assert.equal(f.p.getInventory().getAmount(tier.lamp), free === 2 ? 1 : 0);
    assert.equal(f.p.getInventory().getAmount(tier.hilt), free === 2 ? 1 : 0);
    assert.equal(Progress.claimedTiers(f.p).has(1), free === 2);
  }
});

test("native earned lamp confirmation grants its sourced XP once and removes only that slot", async (t) => {
  const f = actor(t),
    tier = Data.tiers()[0];
  earned(f, 2);
  // The lamp is confirmed on Runecraft, which can only be chosen after Rune Mysteries (Wiki: Lamp).
  f.p.setAttribute("quest.rune_mysteries.stage", 6);
  const before = skillLevel(f);
  const { slot } = lamp(f, tier);
  await lampConfirm(f);
  assert.equal(
    f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING),
    before + 5000,
  );
  assert.equal(f.p.getInventory().forSlot(slot).getId(), -1);
  await lampConfirm(f);
  assert.equal(
    f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING),
    before + 5000,
  );
});

test("delayed lamp confirmation refuses dead/trading/moving players and changed item IDs or metadata", async (t) => {
  for (const mode of [
    "dead",
    "trade",
    "placed",
    "teleport",
    "forced",
    "id",
    "meta",
    "replace",
  ]) {
    const f = actor(t),
      tier = Data.tiers()[0];
    earned(f, 2);
    const before = skillLevel(f),
      { item, slot } = lamp(f, tier);
    if (mode === "id") item.setId(core.ItemIdentifiers.SPADE);
    else if (mode === "meta") item.setMetaValue("test:preset", true);
    else if (mode === "replace")
      f.p.getInventory().setItem(slot, new core.Item(tier.lamp));
    else invalidate(f, mode);
    await lampConfirm(f);
    assert.equal(
      f.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING),
      before,
      mode,
    );
    assert.equal(f.p.getInventory().forSlot(slot).getAmount(), 1, mode);
  }
});

test("logout invalidates pending native tier and lamp confirmations", async (t) => {
  const f = actor(t),
    tier = Data.tiers()[0];
  earned(f, 1);
  talk(f, npc(t, f));
  await confirmation(f);
  PluginManager.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  f.p.setRegistered(false);
  await resume(f);
  assert.equal(f.p.getInventory().getAmount(tier.lamp), 0);
  assert.equal(Progress.claimedTiers(f.p).has(1), false);
  const g = actor(t);
  earned(g, 2);
  const before = skillLevel(g),
    item = lamp(g, tier);
  PluginManager.emitPlayerLogout({ player: g.p, username: g.p.getUsername() });
  g.p.setRegistered(false);
  await lampConfirm(g);
  assert.equal(
    g.p.getSkillManager().getExperience(core.Skill.RUNECRAFTING),
    before,
  );
  assert.equal(g.p.getInventory().forSlot(item.slot).getAmount(), 1);
});
