const { buildPresetsInterfaceDefinition } = require("../plugins/modes/pvp/PresetsWidget.PvpMode");

const plugins = [
  "Commands",
  "DestroyItem",
  "TeleportInterface",
  "MaxHitsInterface",
  "SideJournalDefaults",
];

const definitions: Array<{ groupId: number; widgets: unknown[] }> = [buildPresetsInterfaceDefinition()];
const api = new Proxy(
  { registerCustomInterface: (definition: { groupId: number; widgets: unknown[] }) => definitions.push(definition) },
  { get: (target, key) => target[key as keyof typeof target] ?? (() => {}) },
);

for (const name of plugins) require(`../plugins/interface/${name}.plugin`).register(api);

if (new Set(definitions.map((definition) => definition.groupId)).size !== definitions.length) {
  throw new Error("Duplicate browser-host interface group");
}
process.stdout.write(JSON.stringify(definitions));
