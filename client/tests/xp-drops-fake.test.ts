import assert from "node:assert/strict";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { Dat2CacheLoaderFactory } from "../rs/cache/loader/Dat2CacheLoaderFactory";
import { VarManager } from "../rs/config/vartype/VarManager";
import { ClientScriptLoader } from "../game/cs2/ClientScriptLoader";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { WidgetLoader } from "../widgets/WidgetLoader";
import { WidgetManager } from "../widgets/WidgetManager";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// The server fakes the XP drops Bounty Hunter blocks by running this interface's own scripts.
// Its hardcoded render arguments must stay in step with the cache listener, or the drops
// silently disappear (or the client throws) after a cache update.
const { _test: Area } = require("../../server/plugins/minigames/bountyhunter/Area.BountyHunter");

const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const cache = CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files);
const loaders = new Dat2CacheLoaderFactory(cacheInfo, "dat2", cache);
const scripts = new ClientScriptLoader({ getCacheSystem: () => cache });
const vars = new VarManager(loaders.getVarBitTypeLoader());
const manager = new WidgetManager(cache, new WidgetLoader(cache));
manager.setRootInterface(161);
const group: any = manager.getGroup(122);
assert.ok(group, "the XP drops interface decodes");

const vm = new Cs2Vm({
    loadScript: (id: number) => scripts.load(id),
    enumTypeLoader: loaders.getEnumTypeLoader(),
    varManager: vars,
    widgetManager: manager,
    windowMode: 2,
} as any);

// Script 993 (122:0's onLoad) installs the listener on 122:2. Its WIDGET_ID magic becomes the
// root it is mounted on, and its loop counter ends on the number of drop layers (enum 1163).
const onLoad = group.root.onLoad as number[];
const rootArgs = onLoad.slice(1).map((value) => (value === -2147483645 ? group.root.uid : value));
const layerCount = loaders.getEnumTypeLoader()!.load(1163).outputCount;
vm.run(scripts.load(1003)!, [rootArgs[0], rootArgs[3], rootArgs[4], rootArgs[5], rootArgs[6],
    rootArgs[7], rootArgs[8], rootArgs[9], rootArgs[10], layerCount], []);

const raw = (manager.getWidgetByUid((122 << 16) | 2) as any).onStatTransmit as number[];
assert.equal(raw[0], 1004, "the cache installs its own stat-transmit handler");
assert.equal(raw[1], 0, "a real stat change asks 1004 for its normal path");
assert.deepEqual(raw.slice(2, 12), Area.FAKE_DROP_RENDER_ARGS,
    "the server's fake-drop arguments match the cache listener");

// Queue both skills a three-damage hit awards and render once, as the server now does. With
// Group XP drops on, the client puts both icons on the same counter rather than two counters.
const xps = [0, 2, 4, 6, 1, 3, 5, 16, 15, 17, 12, 20, 14, 13, 10, 7, 11, 8, 9, 18, 19, 22, 21, 23]
    .map(() => 1_000_000);
vars.setVarbit(4702, 1); // the Show/Hide XP drops toggle
vars.setVarbit(4696, 1); // Group skills
vars.setVarcInt(70, 0);
vars.setVarcInt(71, 0);
vars.setVarcInt(76, Date.now() | 0);
vm.run(scripts.load(2091)!, [3, 4], []);
vm.run(scripts.load(2091)!, [2, 12], []);
vm.run(scripts.load(1004)!, [1, ...Area.FAKE_DROP_RENDER_ARGS, ...xps], []);

const layer: any = manager.getWidgetByUid((122 << 16) | 18);
assert.equal(layer.children?.filter(Boolean).length, 2, "both skills share one grouped counter");
assert.equal((manager.getWidgetByUid((122 << 16) | 19) as any).children, undefined,
    "the batch does not spill into a second counter");

console.log("xp drops fake test passed");
