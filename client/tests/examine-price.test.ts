import { strict as assert } from "node:assert";
import {
    addExaminePriceLine,
    EXAMINE_PRICE_ALCH_VARBIT,
    EXAMINE_PRICE_GE_VARBIT,
    ExaminePriceDefinition,
    examinePriceLine,
} from "../game/examinePrice";
import { alchemyValues, guidePrice, itemPricesPending, loadItemPrices } from "../network/serverConnection/domain/itemPrices";
import { state } from "../network/serverConnection/state";

// Settings rows 234 and 235: the price line after a widget item's examine text.
const r = (n: number | string) => `<col=ff0000>${n}</col>`;
// The cache store values (price) are only there to show they are not used.
const DEFS: Record<number, ExaminePriceDefinition & { price: number }> = {
    1325: { name: "Steel scimitar", price: 400, isTradable: true },
    314: { name: "Feather", price: 2, isTradable: true },
    333: { name: "Trout", price: 10, isTradable: true },
    334: { name: "Trout", price: 10, isTradable: true, noteTemplate: 799, note: 333 },
    455: { name: "Barcrawl card", price: 0, isTradable: false },
    995: { name: "Coins", price: 1, isTradable: true },
    13190: { name: "Old school bond", price: 2_000_000, isTradable: true },
};
const GUIDE: Record<number, number> = { 1325: 67, 314: 3, 333: 19, 13190: 9_968_614 };
// The world's /api/item-alchemy table: no entry for the bond, which the spells refuse.
const ALCHEMY: Record<number, [number, number]> = { 1325: [240, 160], 314: [1, 0], 333: [6, 4] };

function line(
    itemId: number, amount: number, ge: number, alch: number,
    guide: (id: number) => number | undefined = (id) => GUIDE[id] ?? 0,
    alchemy: (id: number) => { ha: number; la: number } | undefined = (id) => {
        const [ha, la] = ALCHEMY[id] ?? [0, 0];
        return { ha, la };
    },
) {
    return examinePriceLine(itemId, amount, {
        definition: (id) => DEFS[id],
        guidePrice: guide,
        alchemy,
        varbit: (id) => (id === EXAMINE_PRICE_GE_VARBIT ? ge : id === EXAMINE_PRICE_ALCH_VARBIT ? alch : 0),
    });
}

assert.equal(line(1325, 1, 1, 0), `Price of Steel scimitar: GE ${r(67)}`);
assert.equal(line(1325, 1, 0, 1), `Price of Steel scimitar: HA ${r(240)}  LA ${r(160)}`);
assert.equal(line(1325, 1, 1, 1), `Price of Steel scimitar: GE ${r(67)}  HA ${r(240)}  LA ${r(160)}`);
assert.equal(line(314, 100, 1, 1), `Price of 100 x Feather: GE ${r(300)} (${r(3)}ea)  HA ${r(100)} (${r(1)}ea)`,
    "a stack shows the total and each; a zero LA is left out");
assert.equal(line(334, 10, 1, 1), `Price of 10 x Trout: GE ${r(190)} (${r(19)}ea)  HA ${r(60)} (${r(6)}ea)  LA ${r(40)} (${r(4)}ea)`,
    "a note is priced as the item it notes");
assert.equal(line(1325, 1, 0, 0), null, "both settings off");
assert.equal(line(455, 1, 1, 1), null, "untradeable");
assert.equal(line(995, 1000, 1, 1), null, "coins have no quote and no alchemy value");
assert.equal(line(1325, 1, 1, 0, () => undefined), null, "no GE part while prices load");
assert.equal(line(13190, 1, 1, 1), `Price of Old school bond: GE ${r("9,968,614")}`,
    "the alchemy spells refuse a bond, whatever its store value");
assert.equal(line(1325, 1, 1, 1, undefined, () => undefined), `Price of Steel scimitar: GE ${r(67)}`,
    "no HA or LA while alchemy values load");
assert.equal(line(1325, 1500, 1, 0), `Price of 1,500 x Steel scimitar: GE ${r("100,500")} (${r(67)}ea)`);

// The first trade examine after a login, with Alchemy on and GE off: the login asks for both tables,
// and an examine made while they load gets its line when they arrive.
const firstExamine = (async () => {
    const originalConfig = state.webRtcConfig;
    const originalSocket = state.socket;
    const requested: string[] = [];
    const replies: Array<() => void> = [];
    try {
        state.webRtcConfig = { signalUrl: "wss://worlds.test", worldId: "examine-test", iceServers: [] };
        state.socket = { fetchContent: (path: string) => {
            requested.push(path);
            return new Promise((resolve) => replies.push(() =>
                resolve(path === "/api/item-alchemy" ? { 1325: [240, 160] } : { 1325: 67 })));
        } } as any;
        loadItemPrices();
        assert.deepEqual(requested.sort(), ["/api/item-alchemy", "/api/item-prices"], "a login asks for both tables");
        const chat: string[] = [];
        const deps = {
            definition: (id: number) => DEFS[id],
            guidePrice,
            alchemy: alchemyValues,
            varbit: (id: number) => (id === EXAMINE_PRICE_ALCH_VARBIT ? 1 : 0),
        };
        const pending = itemPricesPending();
        assert.ok(pending, "still loading");
        const done = addExaminePriceLine(1325, 1, deps, pending, (text) => chat.push(text));
        assert.deepEqual(chat, [], "nothing yet");
        replies.forEach((reply) => reply());
        await done;
        assert.deepEqual(chat, [`Price of Steel scimitar: HA ${r(240)}  LA ${r(160)}`], "the line arrives with the values");
        assert.equal(itemPricesPending(), null, "loaded: later examines add the line at once");
        addExaminePriceLine(1325, 1, deps, null, (text) => chat.push(text));
        assert.equal(chat.length, 2);
        assert.equal(requested.length, 2, "no second request");
    } finally {
        state.webRtcConfig = originalConfig;
        state.socket = originalSocket;
    }
})();

void firstExamine.then(
    () => console.log("examine-price tests passed"),
    (error) => { console.error(error); process.exitCode = 1; },
);
