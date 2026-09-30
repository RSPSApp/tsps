// @ts-nocheck
// Smoke test for the farming plugin: registers it with a fake player and drives
// rake -> plant -> grow -> disease -> harvest, plus compost bins and plant pots.
//
//   yarn test:farming
import path = require("path");

const { ItemIdentifiers } = require(path.resolve(__dirname, "../src/main/typescript/elvarg/util/ItemIdentifiers"));
const { Skill } = require(path.resolve(__dirname, "../src/main/typescript/elvarg/game/model/Skill"));

let failures = 0;
function check(name: string, condition: boolean) {
    console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
    if (!condition) failures++;
}

class FakeInventory {
    slots: Array<{ id: number; amount: number }> = [];
    contains(id: number) {
        return this.slots.some((slot) => slot.id === id);
    }
    adds(id: number, amount = 1) {
        const slot = this.slots.find((entry) => entry.id === id);
        if (slot) slot.amount += amount;
        else this.slots.push({ id, amount });
    }
    deleteNumber(id: number, amount = 1) {
        const slot = this.slots.find((entry) => entry.id === id);
        if (!slot || slot.amount < amount) return false;
        slot.amount -= amount;
        if (slot.amount <= 0) this.slots.splice(this.slots.indexOf(slot), 1);
        return true;
    }
    getAmount(id: number) {
        return this.slots.filter((entry) => entry.id === id).reduce((total, entry) => total + entry.amount, 0);
    }
    full() {
        return false;
    }
    getItems() {
        return this.slots.map((slot) => ({ getId: () => slot.id, getAmount: () => slot.amount }));
    }
}

class FakePlayer {
    attributes = new Map();
    inventory = new FakeInventory();
    varbits: Record<number, number> = {};
    messages: string[] = [];
    totalXp = 0;
    level = 99;
    getAttribute(key: string) {
        return this.attributes.get(key);
    }
    setAttribute(key: string, value: unknown) {
        this.attributes.set(key, value);
    }
    getInventory() {
        return this.inventory;
    }
    getSkillManager() {
        return {
            getCurrentLevel: () => this.level,
            addExperiences: (_skill: unknown, xp: number) => {
                this.totalXp += xp;
            },
        };
    }
    getPacketSender() {
        return {
            sendVarbit: (id: number, value: number) => { this.varbits[id] = value; },
            sendObject: () => {},
            sendObjectRemoval: () => {},
        };
    }
    getLocation() {
        return { getX: () => 3058, getY: () => 3310, getZ: () => 0 };
    }
    performAnimation() {}
    sendMessage(message: string) {
        this.messages.push(message);
    }
}

const handlers: Record<string, (event: any) => void> = {};
const core = {
    Skill,
    ItemIdentifiers,
    Animation: class { constructor(public id: number) {} },
    Sound: class { constructor(..._args: any[]) {} },
    Sounds: { sendSound() {} },
    Location: class { constructor(public x: number, public y: number, public z: number) {} },
    GameObject: class {
        constructor(public id: number, public location: any, public type: number, public face: number, public area: unknown) {}
    },
};
const api = {
    core,
    persistAttribute() {},
    log() {},
    onPlayerProcess: (handler: any) => { handlers.process = handler; },
    onObjectInteraction: (handler: any) => { handlers.object = handler; },
    onItemOnObject: (handler: any) => { handlers.itemOnObject = handler; },
    onItemOnItem: (handler: any) => { handlers.itemOnItem = handler; },
};

const plugin = require(path.resolve(__dirname, "../plugins/skills/Farming.plugin.js"));
const patches = require(path.resolve(__dirname, "../plugins/skills/farming/farmingPatches.js"));
const values = require(path.resolve(__dirname, "../plugins/skills/farming/farmingValues.js"));
plugin.register(api);

const I = ItemIdentifiers;
const KEY = "8150:3058:3311:0";
const HERB_OBJECT = {
    getLocation: () => ({ x: 3058, y: 3311, z: 0 }),
    getDefinition: () => ({ getName: () => "Herb patch" }),
};

function player() {
    const fake = new FakePlayer();
    fake.setAttribute("farming.patches", {});
    return fake;
}

function setEntry(fake: FakePlayer, entry: Record<string, unknown>) {
    fake.setAttribute("farming.patches", { [KEY]: entry });
}

check("catalog has the classic patches", patches.PATCHES.length >= 45);
check("every patch has map placements", patches.PATCHES.every((patch: any) => patch.placements.length > 0));
check("findPatch routes herb tile", patches.findPatch(8150, { x: 3058, y: 3311, z: 0 })?.key === KEY);
check("findPatch routes transformed ids", patches.findPatch(39748, { x: 3058, y: 3311, z: 0 })?.key === KEY);
check("guam profile has four stages", values.profileFor("HERB", "GUAM").stages === 4);
check("guam growing stage 2 value", values.displayValue("HERB", { crop: "GUAM", s: 2, w: 3 }) === 6);
check("oak needs five stages", values.profileFor("TREE", "OAK").stages === 5);

// Rake a weedy patch.
{
    const fake = player();
    setEntry(fake, { w: 1, crop: null });
    fake.inventory.adds(I.RAKE);
    handlers.object({ player: fake, objectId: 8150, object: HERB_OBJECT, clickType: 1, handled: false });
    const entry = fake.getAttribute("farming.patches")[KEY];
    check("rake clears weeds", entry.w === 3);
    check("rake gives weeds", fake.inventory.getAmount(I.WEEDS) === 3);
    check("rake gives xp", fake.totalXp === 24);
}

// Plant guam.
{
    const fake = player();
    setEntry(fake, { w: 3, crop: null });
    fake.inventory.adds(I.SEED_DIBBER);
    fake.inventory.adds(I.GUAM_SEED);
    handlers.itemOnObject({
        player: fake, objectId: 8150, object: HERB_OBJECT,
        itemId: I.GUAM_SEED, handled: false,
    });
    const entry = fake.getAttribute("farming.patches")[KEY];
    check("seed planted", entry.crop === "GUAM" && entry.s === 0);
    check("seed consumed", fake.inventory.getAmount(I.GUAM_SEED) === 0);
    check("planted varbit shown", fake.varbits[4774] === 4);
}

// Growth advances one stage per cycle.
{
    const fake = player();
    setEntry(fake, { w: 3, crop: "GUAM", s: 0, d: 0, f: false, next: Date.now() - 1 });
    handlers.process({ player: fake });
    const entry = fake.getAttribute("farming.patches")[KEY];
    check("growth advanced", entry.s === 1);
    check("growth varbit", fake.varbits[4774] === 5);
}

// Diseased crops die on the next cycle and clear.
{
    const fake = player();
    setEntry(fake, { w: 3, crop: "GUAM", s: 2, d: 1, f: false, next: Date.now() - 1 });
    handlers.process({ player: fake });
    check("disease kills", fake.getAttribute("farming.patches")[KEY].d === 2);
    fake.inventory.adds(I.SPADE);
    handlers.object({ player: fake, objectId: 8150, object: HERB_OBJECT, clickType: 1, handled: false });
    check("clear empties patch", fake.getAttribute("farming.patches")[KEY].crop === null);
}

// Harvest consumes lives and empties the patch.
{
    const fake = player();
    setEntry(fake, { w: 3, crop: "GUAM", s: 3, f: true, c: false, d: 0, h: 0, l: 1 });
    handlers.object({ player: fake, objectId: 8150, object: HERB_OBJECT, clickType: 1, handled: false });
    check("harvest gives guam", fake.inventory.getAmount(I.GUAM_LEAF) === 1);
    check("harvest gives xp", Math.abs(fake.totalXp - 12.5) < 0.001);
    check("patch emptied after last life", fake.getAttribute("farming.patches")[KEY].crop === null);
}

// Compost bin: fill, close, rot, empty.
{
    const fake = player();
    fake.setAttribute("farming.patches", {});
    const binObject = {
        getLocation: () => ({ x: 3056, y: 3312, z: 0 }),
        getDefinition: () => ({ getName: () => "Compost Bin" }),
    };
    fake.inventory.adds(I.WEEDS);
    handlers.itemOnObject({ player: fake, objectId: 7836, object: binObject, itemId: I.WEEDS, handled: false });
    const binKey = "7836:3056:3312:0";
    const bin = fake.getAttribute("farming.patches")[binKey].bin;
    check("bin filled", bin.fill === 1 && bin.state === "open");
    handlers.object({ player: fake, objectId: 7836, object: binObject, clickType: 1, handled: false });
    check("bin closed for rotting", fake.getAttribute("farming.patches")[binKey].bin.state === "rot");
    const entry = fake.getAttribute("farming.patches")[binKey];
    entry.bin.readyAt = Date.now() - 1;
    entry.bin.fill = 15;
    handlers.process({ player: fake });
    check("bin ready", fake.getAttribute("farming.patches")[binKey].bin.state === "ready");
    fake.inventory.adds(I.BUCKET);
    handlers.object({ player: fake, objectId: 7836, object: binObject, clickType: 1, handled: false });
    check("bin gives compost", fake.inventory.getAmount(I.COMPOST) === 1);
}

// Plant pot: acorn needs a trowel and a filled pot, then grows into a sapling.
{
    const fake = player();
    fake.inventory.adds(I.GARDENING_TROWEL);
    fake.inventory.adds(I.FILLED_PLANT_POT);
    fake.inventory.adds(I.ACORN);
    handlers.itemOnItem({
        player: fake, usedItemId: I.ACORN, usedWithItemId: I.FILLED_PLANT_POT,
        usedItem: {}, usedWithItem: {}, handled: false,
    });
    check("acorn potted", fake.inventory.getAmount(I.OAK_SEEDLING) === 1);
    fake.inventory.deleteNumber(I.OAK_SEEDLING, 1);
    fake.inventory.adds(I.OAK_SEEDLING_W_);
    fake.setAttribute("farming.saplings", Date.now() - 10 * 60_000);
    handlers.process({ player: fake });
    check("seedling grew into sapling", fake.inventory.getAmount(I.OAK_SAPLING) === 1);
}

if (failures > 0) {
    console.error(`${failures} farming smoke check(s) failed`);
    process.exit(1);
}
console.log("farming smoke test passed");
