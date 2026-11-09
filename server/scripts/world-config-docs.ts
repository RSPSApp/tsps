// Regenerates the settings reference block in docs/world-configuration.md.
// Run: yarn --cwd server world-config-docs
import fs = require("node:fs");
import path = require("node:path");
import { Server } from "../src/main/typescript/elvarg/Server";
import { WorldConfigStore } from "../src/main/typescript/elvarg/game/definition/WorldConfigStore";
import { WorldConfigCatalog } from "../src/main/typescript/elvarg/plugins/WorldConfigCatalog";
import {
    renderWorldConfigDocs,
    WORLD_CONFIG_DOCS_END,
    WORLD_CONFIG_DOCS_START,
} from "../src/main/typescript/elvarg/plugins/WorldConfigDocs";

const SERVER_ROOT = path.resolve(__dirname, "..");
const DOC = path.resolve(SERVER_ROOT, "..", "docs", "world-configuration.md");

(Server as unknown as { installProductionPathResolver(): void }).installProductionPathResolver();
const shipped = WorldConfigStore.read(path.join(SERVER_ROOT, "data", "definitions")).shipped;
// Shipped world.json only, so the text is the same on every machine.
const catalog = WorldConfigCatalog.build(path.join(SERVER_ROOT, "plugins"), {
    shipped,
    local: {},
    localExists: false,
    localHash: "",
});
const block = `${WORLD_CONFIG_DOCS_START}\n${renderWorldConfigDocs(catalog)}\n${WORLD_CONFIG_DOCS_END}`;
const text = fs.readFileSync(DOC, "utf8");
const start = text.indexOf(WORLD_CONFIG_DOCS_START);
const end = text.indexOf(WORLD_CONFIG_DOCS_END);
if (start < 0 || end < start) throw new Error(`${DOC} is missing the generated-block markers`);
fs.writeFileSync(DOC, text.slice(0, start) + block + text.slice(end + WORLD_CONFIG_DOCS_END.length));
console.log(`Updated ${DOC}`);
