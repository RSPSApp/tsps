// Writes plugins/interface/clans/data/permissions.json, the Permissions screen's rows, from the cache.
// Usage: TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' ts-node ./scripts/generate-clan-permissions.ts [--check]
// The order is clan_permission_init's (script 4457): Permission access, then each category of enum 3825.
import fs = require("fs");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { SWITCH, hasLongCounts, readScript } from "./cs2-reader";

const OUTPUT = path.resolve(__dirname, "../plugins/interface/clans/data/permissions.json");

const CATEGORIES_ENUM = 3825;
const CATEGORY_TITLE_KEY = -1;
const PERMISSION_ACCESS_STRUCT = 2943;
const PERMISSION_ACCESS_CATEGORY = "Owner";
const PERMISSION_GET_SCRIPT = 4456; // clan_permission_get: a switch from struct to %varclansetting
const GET_CLAN_SETTING_OPCODE = 74;

const PARAM_LABEL = 1251;
const PARAM_MIN_RANK = 1253;
const PARAM_AT_LEAST = 1254; // a row this one mustn't go below
const PARAM_SPECIAL = 1255; // holds a value, not a rank

/** clan_permission_get's cases, each `$int1 = %varclansetting_N`: struct to N. */
function readSettings(): Map<number, number> {
  const index = CacheIndexDat2.fromStore(IndexType.DAT2.clientScript, CachePipeline.getStore());
  const file = index.getFileSmart(PERMISSION_GET_SCRIPT);
  if (!file) throw new Error(`no script ${PERMISSION_GET_SCRIPT}`);
  const { header, instructions } = readScript(new Int8Array(file.data), hasLongCounts(CachePipeline.getActive().revision));
  const at = instructions.findIndex(({ opcode }) => opcode === SWITCH);
  const settings = new Map<number, number>();
  for (const [struct, jump] of header.switches[Number(instructions[at].operand)]) {
    const target = instructions[at + 1 + jump];
    // Talk and Kick read the clan's own talk and kick ranks, so they hold no setting.
    if (target.opcode === GET_CLAN_SETTING_OPCODE) settings.set(struct, Number(target.operand));
  }
  return settings;
}

function main(): void {
  CachePipeline.initialize(path.resolve(__dirname, "..")).then(() => {
    const settings = readSettings();
    const rows: unknown[] = [];
    const add = (struct: number, category: string) => {
      const params = CacheDefinitions.getStructParams(struct);
      rows.push({
        index: rows.length,
        category,
        label: String(params.get(PARAM_LABEL) ?? "").replace(/<br>/g, " "),
        minRank: params.has(PARAM_MIN_RANK) ? Number(params.get(PARAM_MIN_RANK)) : null,
        atLeast: params.has(PARAM_AT_LEAST) ? Number(params.get(PARAM_AT_LEAST)) : null,
        special: Number(params.get(PARAM_SPECIAL) ?? 0) === 1,
        setting: settings.get(struct) ?? null,
        struct,
      });
    };
    add(PERMISSION_ACCESS_STRUCT, PERMISSION_ACCESS_CATEGORY);
    const byKey = (id: number) => [...CacheDefinitions.getEnumValues(id)].sort((a, b) => a[0] - b[0]);
    for (const [, categoryEnum] of byKey(CATEGORIES_ENUM)) {
      if (Number(categoryEnum) < 0) continue;
      const entries = byKey(Number(categoryEnum));
      const title = entries.find(([key]) => key === CATEGORY_TITLE_KEY);
      const category = title ? String(CacheDefinitions.getStructParams(Number(title[1])).get(PARAM_LABEL) ?? "") : "";
      for (const [key, struct] of entries) {
        if (key !== CATEGORY_TITLE_KEY && Number(struct) >= 0) add(Number(struct), category);
      }
    }
    const json = `${JSON.stringify(rows, null, 1)}\n`;
    if (process.argv.includes("--check")) {
      const same = fs.readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") === json;
      console.log(same ? `permissions.json matches the cache: ${rows.length} rows` : "permissions.json differs from the cache");
      process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(OUTPUT, json);
    console.log(`wrote ${rows.length} rows`);
    process.exit(0);
  });
}

main();
