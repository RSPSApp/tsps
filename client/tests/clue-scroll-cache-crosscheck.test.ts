import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { WorldMapPointManager } from "@runelite/client/ui/overlay/worldmap/WorldMapPointManager";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { Text } from "@runelite/client/util/Text";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { findClueScrollForText } from "../game/plugins/cluescrolls/ClueScrollLookup";
import { ClueScrollPlugin } from "../game/plugins/cluescrolls/ClueScrollPlugin";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { DbRepository } from "../rs/config/db/DbRepository";
import { Inventory } from "../rs/inventory/Inventory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// Every clue text the server can hand out comes from the cache's clue table (dbtable 8: column 1
// the tier, 2 the scroll text, 3 the location, 10 the clue kinds, 13 a Leagues variant of the
// text). The ported RuneLite tables must recognise them; the rows they do not are listed here with
// a reason each, so a regression in the tables fails this test and the gaps stay visible.

const CLUE_TABLE = 8;
const TIER_COLUMN = 1;
const TEXT_COLUMN = 2;
const LEAGUE_TEXT_COLUMN = 13;

/** Rows RuneLite 1.13.6's tables do not cover, as "<row id>: <reason>". */
const EXPECTED_MISSES: string[] = [
    "1257: this cache says 'watching the fights in the Emir's Arena'; RuneLite 1.13.6's CrypticClue row says 'at the Emir's Arena'",
    "1497: the master hot-cold clue handed out by Watson; RuneLite 1.13.6 only knows Jorral's",
];

/** The clue item for a row's tier: HotColdClue.forText needs it to tell the two Leagues Tutor clues apart. */
const TIER_ITEM: Record<number, number> = { 0: ItemID.TRAIL_CLUE_BEGINNER, 5: ItemID.TRAIL_CLUE_MASTER };

const CACHES_JSON = path.resolve(__dirname, "../../server/caches/caches.json");
const hasCache = fs.existsSync(CACHES_JSON) && !process.env.RL_TEST_NO_CACHE;
if (!hasCache) {
    console.log("clue-scroll-cache-crosscheck: no server/caches, skipped");
    console.log("clue-scroll-cache-crosscheck: ok");
} else {
    const info = loadCacheList(loadCacheInfos()).latest;
    const db = new DbRepository(CacheSystem.fromFiles(info, loadCache(info).files));
    const rows = db.getRows(CLUE_TABLE);
    assert.ok(rows.length > 200, `the clue table has its rows (${rows.length})`);

    const osrsClient: any = {
        inventory: new Inventory(28), equipment: new Inventory(14), npcEcs: new NpcEcs(8),
        npcTypeLoader: { load: () => undefined }, objTypeLoader: { load: () => undefined },
        varManager: { getVarbit: () => 0, getVarp: () => 0 }, widgetManager: { getWidgetByUid: () => undefined },
        inputManager: { mouseX: 0, mouseY: 0 }, addGameMessage: () => {},
    };
    const plugin = new ClueScrollPlugin({ client: osrsClient, configManager: inject(ConfigManager), chatboxPanelManager: {} as any, tagManager: undefined, worldMapPointManager: new WorldMapPointManager() });

    const misses: string[] = [];
    let checked = 0;
    for (const row of rows) {
        const tier = Number(row.getColumn(TIER_COLUMN)?.values[0]);
        const clueItemId = TIER_ITEM[tier] ?? null;
        for (const column of [TEXT_COLUMN, LEAGUE_TEXT_COLUMN]) {
            const text = row.getColumn(column)?.values[0];
            if (typeof text !== "string" || !text) continue;
            checked++;
            if (!findClueScrollForText(plugin, text, clueItemId)) {
                misses.push(`${row.id}${column === LEAGUE_TEXT_COLUMN ? " (league text)" : ""}: ${Text.sanitizeMultilineText(text)}`);
            }
        }
    }
    console.log(`clue-scroll-cache-crosscheck: ${checked} texts, ${misses.length} not in the ported tables`);
    assert.deepEqual(
        misses.map((miss) => miss.split(": ")[0]),
        EXPECTED_MISSES.map((miss) => miss.split(": ")[0]),
        `misses changed:\n${misses.join("\n")}`,
    );
    console.log("clue-scroll-cache-crosscheck: ok");
}
