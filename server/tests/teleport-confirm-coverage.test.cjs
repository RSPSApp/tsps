// Run: node --test tests/teleport-confirm-coverage.test.cjs
// A teleport the player chooses goes through TeleportHandler.confirm (or the spell engine's "spell:teleport-confirm"),
// so content can ask first: the boat-at-sea warning (All Settings 471). This lists every source file that starts a
// teleport (TeleportHandler.teleport or the home-teleport cast) and fails for one that neither asks nor is listed
// below as a move the player doesn't choose as a teleport. A new teleport item or spell: wrap it in
// TeleportHandler.confirm (see boat-teleport-warning-items.test.cjs), or add it here with the reason it needn't ask.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SOURCES = ["plugins", "src/main/typescript"];
const STARTS = /TeleportHandler\.teleport\(|startHomeTeleport\(/;
const ASKS = /TeleportHandler\.confirm\(|"spell:teleport-confirm"/;

/** Files that start a teleport without asking, and why that's right. */
const NOT_ASKED = new Map([
  ["plugins/combat/HomeTeleportSequence.js", "the home-teleport cast itself; its callers ask"],
  ["plugins/bosses/abyssalsire/Nexus.AbyssalSire.js", "the Abyssal Nexus's own exits"],
  ["plugins/bots/behaviours/nodes/pvp/PvpDefensiveActionNode.PlayerBots.js", "player bots"],
  ["plugins/commands/PlayerCommands.plugin.js", "::home, a server command"],
  ["plugins/interface/TeleportInterface.plugin.js", "::teleports, the server's own teleport list"],
  ["plugins/interface/Teleports.plugin.js", "the server's own home, training, PvP and boss teleport buttons"],
  ["plugins/items/RingOfLife.plugin.js", "the ring's save fires on a hit, not on a click"],
  ["plugins/minigames/castlewars/Cloaks.CastleWars.js", "Surrender, inside the game"],
  ["plugins/objects/Levers.plugin.js", "levers"],
  ["plugins/quests/quests/LostCity.Quest.js", "the shed into Zanaris"],
  ["plugins/quests/quests/MyArmsBigAdventure.Quest.js", "the quest's boat trip"],
  ["plugins/quests/quests/Pandemonium.Quest.js", "the quest's own moves"],
  ["plugins/skills/construction/JewelleryBox.Construction.js", "house furniture"],
  ["plugins/skills/construction/Mounted.Construction.js", "house furniture"],
  ["plugins/skills/construction/Portals.Construction.js", "house portals"],
  ["src/main/typescript/elvarg/game/entity/impl/npc/NpcInteractionManager.ts", "NPCs' teleports"],
]);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(js|cjs|ts)$/.test(entry.name) ? [full] : [];
  });
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const starting = SOURCES.flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
  .map((file) => ({ file: relative(file), text: fs.readFileSync(file, "utf8") }))
  .filter(({ text }) => STARTS.test(text));

test("every file that starts a teleport asks first, or is listed with why it needn't", () => {
  const unasked = starting.filter(({ file, text }) => !ASKS.test(text) && !NOT_ASKED.has(file)).map(({ file }) => file);
  assert.deepEqual(unasked, [], "these start a teleport without TeleportHandler.confirm: wrap it, or list why not");
});

test("the list only names files that still start a teleport without asking", () => {
  const byFile = new Map(starting.map((entry) => [entry.file, entry]));
  const stale = [...NOT_ASKED.keys()].filter((file) => !byFile.has(file) || ASKS.test(byFile.get(file).text));
  assert.deepEqual(stale, []);
});

test("the item and spell teleports this covers ask first", () => {
  for (const file of [
    "plugins/combat/SpellTeleports.plugin.js", "plugins/items/Jewellery.plugin.js", "plugins/items/escapecrystal/Activation.EscapeCrystal.js",
    "plugins/modes/leaguerelics/Teleports.LeagueRelics.js", "src/main/typescript/elvarg/game/content/combat/magic/LunarSpells.ts",
    "src/main/typescript/elvarg/game/content/combat/magic/ArceuusSpells.ts", "plugins/combat/HomeTeleports.plugin.js",
  ]) {
    assert.ok(ASKS.test(fs.readFileSync(path.join(ROOT, file), "utf8")), file);
  }
});
