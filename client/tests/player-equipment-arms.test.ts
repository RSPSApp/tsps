import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFromPayload } from "../common/gamemode/GamemodeContentStore";
import { CustomItemRegistry } from "../custom/items/CustomItemRegistry";
import { CustomModelRegistry } from "../custom/items/CustomModelRegistry";
import { CustomObjTypeLoader } from "../custom/items/CustomObjTypeLoader";
import { ObjType } from "../rs/config/objtype/ObjType";
import { ObjModelLoader } from "../rs/config/objtype/ObjModelLoader";
import { IndexModelLoader } from "../rs/model/ModelLoader";

import { EquipmentSlot } from "../rs/config/player/Equipment";
import { Gender, PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerModelLoader } from "../rs/config/player/PlayerModelLoader";
import { PlayerChatheadFactory } from "../render/PlayerChatheadFactory";

function composedKits(wearPos: number, wearPos2: number, wearPos3 = -1): number[] {
    const item = { wearPos, wearPos2, wearPos3 };
    const loader = new PlayerModelLoader(
        { getCount: () => 0 } as any,
        { load: () => item } as any,
        {} as any,
        {} as any,
    );
    let result: PlayerAppearance | undefined;
    (loader as any).buildStaticModel = (appearance: PlayerAppearance) => {
        result = appearance;
        return {};
    };
    const equip = new Array(14).fill(-1);
    equip[wearPos === 0 ? EquipmentSlot.HEAD : EquipmentSlot.BODY] = 100;
    loader.buildStaticModelFromEquipment(
        new PlayerAppearance(Gender.MALE, [0, 0, 0, 0, 0], [10, 11, 12, 13, 14, 15, 16], equip),
        equip,
    );
    assert.ok(result);
    return result.kits;
}

function composedEquipment(): { ids: number[]; layers: number[] } {
    const items = new Map([
        [100, { id: 100, wearPos: 2, wearPos2: -1, wearPos3: -1 }],
        [101, { id: 101, wearPos: 3, wearPos2: -1, wearPos3: -1 }],
        [102, { id: 102, wearPos: 4, wearPos2: -1, wearPos3: -1 }],
        [103, { id: 103, wearPos: 1, wearPos2: -1, wearPos3: -1 }],
        [104, { id: 104, wearPos: 0, wearPos2: -1, wearPos3: -1 }],
    ]);
    const loader = new PlayerModelLoader(
        { getCount: () => 0 } as any,
        { load: (id: number) => items.get(id) } as any,
        {} as any,
        {} as any,
    );
    let result = { ids: [] as number[], layers: [] as number[] };
    (loader as any).buildStaticModel = (
        _appearance: PlayerAppearance,
        extras: any[],
        layers: number[],
    ) => {
        result = { ids: extras.map((item) => item.id), layers };
        return {};
    };
    const equip = new Array(14).fill(-1);
    equip[EquipmentSlot.AMULET] = 100;
    equip[EquipmentSlot.WEAPON] = 101;
    equip[EquipmentSlot.BODY] = 102;
    equip[EquipmentSlot.CAPE] = 103;
    equip[EquipmentSlot.HEAD] = 104;
    loader.buildStaticModelFromEquipment(
        new PlayerAppearance(Gender.MALE, [0, 0, 0, 0, 0], new Array(7).fill(-1), equip),
        equip,
    );
    return result;
}

function firstPersonEquipment(): { kits: number[]; ids: number[] } {
    const items = new Map([
        [100, { id: 100 }],
        [101, { id: 101 }],
        [102, { id: 102 }],
        [103, { id: 103 }],
    ]);
    const loader = new PlayerModelLoader(
        { getCount: () => 0 } as any,
        { load: (id: number) => items.get(id) } as any,
        {} as any,
        {} as any,
    );
    let result = { kits: [] as number[], ids: [] as number[] };
    (loader as any).buildStaticModel = (appearance: PlayerAppearance, extras: any[]) => {
        result = { kits: appearance.kits, ids: extras.map((item) => item.id) };
        return {};
    };
    const equip = new Array(14).fill(-1);
    equip[EquipmentSlot.WEAPON] = 100;
    equip[EquipmentSlot.SHIELD] = 101;
    equip[EquipmentSlot.GLOVES] = 102;
    equip[EquipmentSlot.BODY] = 103;
    loader.buildFirstPersonModel(
        new PlayerAppearance(Gender.MALE, [0, 0, 0, 0, 0], [10, 11, 12, 13, 14, 15, 16], equip),
    );
    return result;
}

assert.deepEqual(composedKits(4, -1).slice(2, 4), [-1, 13], "chainbody must retain arms");
assert.deepEqual(composedKits(4, 6).slice(2, 4), [-1, -1], "platebody must hide arms");
assert.deepEqual(composedKits(0, 8, 11).slice(0, 2), [-1, -1], "full helmets must hide hair and jaw");
assert.deepEqual(composedKits(0, 11).slice(0, 2), [10, -1], "masks must retain the head kit");
assert.deepEqual(composedEquipment(), {
    ids: [104, 103, 102, 101, 100],
    layers: [7, 7, 0, 7, 4],
});
assert.deepEqual(firstPersonEquipment(), {
    kits: [-1, -1, -1, 13, -1, -1, -1],
    ids: [100, 101, 102],
});

// Exercise real external .dat assets through the same loaders used by icons and players.
const rows = JSON.parse(readFileSync(resolve(__dirname, "../../server/data/definitions/custom-items.json"), "utf8"));
const definition = rows[0];
const modelRows = Object.entries(definition.models).map(([id, file]) => ({
    id: Number(id),
    data: readFileSync(resolve(__dirname, "../../server/data/models", file as string)).toString("base64"),
}));
loadFromPayload({ gamemodeId: "test", datasets: [
    { key: "customModels", rows: modelRows }, { key: "customItems", rows },
] });
const info = { name: "test", game: "oldschool", environment: "live", revision: 235, timestamp: 0, size: 0 } as const;
const base = new ObjType(definition.baseItemId, info);
base.name = "Dragon scimitar";
base.wearPos = 3;
const itemLoader = new CustomObjTypeLoader({ load: () => base, getCount: () => 30000, clearCache() {} }, info);
const custom = itemLoader.load(definition.id);
assert.equal(custom.name, "Dragonic katana");
assert.equal(custom.model, 1000000, "base-item delivery must retain model overrides");
assert.equal(custom.wearPos, 3, "custom equipment inherits the base slot");
assert.equal(base.name, "Dragon scimitar", "custom definitions must not mutate the base item");
let cacheReads = 0;
const modelLoader = new IndexModelLoader({ getFile() { cacheReads++; return undefined; } } as any);
const first = modelLoader.getModel(custom.model!)!;
assert.equal(first.faceCount, 780);
const originalColour = first.faceColors[0];
first.faceColors[0] ^= 1;
assert.equal(modelLoader.getModel(custom.model!)!.faceColors[0], originalColour,
    "recolouring one item must not mutate the registered model");
const groundLoader = new ObjModelLoader(itemLoader, modelLoader, {} as any);
const initialGround = groundLoader.getModel(definition.id, 1)!;
assert.equal(initialGround.faceCount, 780);
CustomModelRegistry.register({ id: custom.model!, data: modelRows[1].data });
assert.notDeepEqual(groundLoader.getModel(definition.id, 1)!.verticesX, initialGround.verticesX,
    "changing worlds must invalidate rendered model caches for reused custom IDs");
CustomModelRegistry.register(modelRows[0]);
for (const gender of [Gender.MALE, Gender.FEMALE]) {
    const appearance = new PlayerAppearance(gender, [0, 0, 0, 0, 0], new Array(7).fill(-1), []);
    const playerLoader = new PlayerModelLoader({} as any, itemLoader, modelLoader, {} as any);
    assert.equal(playerLoader.buildStaticModel(appearance, [custom])!.faceCount, 780,
        "both genders must load the external equipped model");
}
assert.equal(cacheReads, 0, "custom assets must never require cache packing");
const headParts: number[] = [];
const chathead = new PlayerChatheadFactory({
    getModel(id: number) { headParts.push(id); return modelLoader.getModel(custom.model!); },
} as any, {} as any, {
    getCount: () => 15,
    load: (id: number) => id === 0 ? { ifModelIds: [custom.model!], modelIds: [999] }
        : { ifModelIds: [-1, -1, -1, -1, -1], modelIds: [246] },
} as any);
assert.ok(chathead.get(new PlayerAppearance(Gender.MALE, [0, 0, 0, 0, 0], [0, 14, 12, 13, 14, 15, 16], [])));
assert.deepEqual(headParts, [custom.model!], "clean-shaven chat heads must never include the floating wearable jaw model");
CustomItemRegistry.register({ ...definition, objType: { ...definition.objType, name: "Updated katana" } });
assert.equal(itemLoader.load(definition.id).name, "Updated katana", "definition replacement invalidates cached items");
loadFromPayload({ gamemodeId: "other-world", datasets: [
    { key: "customItems", rows: [] }, { key: "customModels", rows: [] },
] });
assert.equal(CustomItemRegistry.has(definition.id), false);
assert.equal(CustomModelRegistry.get(custom.model!), undefined);

console.log("Player equipment and custom item regression tests passed");

// #2485: native appearance IDs must reach the existing custom JSON chathead fields.
import { encodePlayerAppearance } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { decodeAppearanceBinary } from "../game/sync/AppearanceDecoder";
import { RUNE_FULL_HELM } from "../runelite/api/gameval/ItemID";

{
    const previousItems = Array.from(CustomItemRegistry.getAll(), item => item.definition);
    const previousModels = CustomModelRegistry.getAll();
    const itemRevision = CustomItemRegistry.revision;
    const modelRevision = CustomModelRegistry.revision;
    let failure: unknown;
    try {
        // Reuse the existing actual external DAT assets; this is a controlled ordinary
        // ObjType definition, not an assertion about Rune full helm's cache geometry.
        const primary = 1000000, secondary = 1000001, customHelmetId = 50001;
        loadFromPayload({ gamemodeId: "test", datasets: [
            { key: "customItems", rows: [] }, { key: "customModels", rows: [] },
        ] });
        const ordinary = new ObjType(RUNE_FULL_HELM, info);
        Object.assign(ordinary, { name: "Controlled ordinary helmet", wearPos: 0, wearPos2: 8, wearPos3: 11,
            maleHeadModel: primary, maleHeadModel2: secondary,
            femaleHeadModel: secondary, femaleHeadModel2: primary });
        const helmetRow = { id: customHelmetId, baseItemId: RUNE_FULL_HELM, objType: {
            name: "Controlled custom helmet", maleHeadModel: secondary, maleHeadModel2: primary,
            femaleHeadModel: primary, femaleHeadModel2: secondary,
        } };
        loadFromPayload({ gamemodeId: "test", datasets: [
            { key: "customModels", rows: modelRows }, { key: "customItems", rows: [helmetRow] },
        ] });
        const baseHelmets = new Map([[RUNE_FULL_HELM, ordinary]]);
        const helmetLoader = new CustomObjTypeLoader({
            load: (id: number) => baseHelmets.get(id) ?? new ObjType(id, info),
            getCount: () => 30000, clearCache() {},
        }, info);
        assert.ok(modelLoader.getModel(primary), "prerequisite: existing primary external DAT decodes");
        assert.ok(modelLoader.getModel(secondary), "prerequisite: existing secondary external DAT decodes");
        const customHelmet = helmetLoader.load(customHelmetId);
        assert.deepEqual([customHelmet.maleHeadModel, customHelmet.maleHeadModel2,
            customHelmet.femaleHeadModel, customHelmet.femaleHeadModel2],
            [secondary, primary, primary, secondary], "prerequisite: all four custom JSON fields survive the normal loader");
        assert.equal(customHelmet.wearPos, 0, "prerequisite: custom helmet inherits the head slot");
        assert.equal(helmetLoader.load(17233).name, "null", "prerequisite: masked ID is not another custom helmet");

        function checkHead(itemId: number, gender: Gender, expected: number[], label: string, legacyHead?: number) {
            const equip = new Array(14).fill(-1); equip[EquipmentSlot.HEAD] = itemId;
            const bytes = encodePlayerAppearance({ gender, colors: [0, 0, 0, 0, 0],
                kits: [0, 14, 12, 13, 14, 15, 16], equip }, "Chathead2485", 3, 1, new Array(7).fill(-1));
            const decoded = decodeAppearanceBinary(bytes);
            assert.ok(decoded, `${label}: prerequisite native appearance decodes`);
            assert.equal(decoded.gender, gender);
            assert.equal(decoded.equipment[EquipmentSlot.HEAD], itemId,
                `${label}: prerequisite native encoder/decoder preserves the actual item ID`);
            // PlayerSyncManager supplies these decoded fields to PlayerAppearance unchanged.
            const appearance = new PlayerAppearance(decoded.gender, decoded.colors,
                decoded.kits.slice(0, 7), decoded.equipment);
            // These explicit legacy/debug controls are not native decoded equipment.
            if (legacyHead !== undefined) appearance.equip[EquipmentSlot.HEAD] = legacyHead;
            const requests: number[] = [];
            const factory = new PlayerChatheadFactory({ getModel(id: number) {
                requests.push(id); return modelLoader.getModel(id);
            } } as any, {} as any, { getCount: () => 15,
                load: () => ({ ifModelIds: [] }) } as any, helmetLoader);
            const head = factory.get(appearance);
            assert.deepEqual(requests, expected, `${label}: literal primary/secondary dialogue head models`);
            assert.ok(head, `${label}: real DAT parts produce a chathead model`);
        }
        checkHead(RUNE_FULL_HELM, Gender.MALE, [primary, secondary, primary, secondary], "ordinary male");
        checkHead(RUNE_FULL_HELM, Gender.FEMALE, [secondary, primary, secondary, primary], "ordinary female");
        for (const [kind, rawHead] of [["encoded", RUNE_FULL_HELM + 512], ["high-bit", RUNE_FULL_HELM + 0x8000]] as const) {
            checkHead(RUNE_FULL_HELM, Gender.MALE, [primary, secondary, primary, secondary], `legacy ${kind} male`, rawHead);
            checkHead(RUNE_FULL_HELM, Gender.FEMALE, [secondary, primary, secondary, primary], `legacy ${kind} female`, rawHead);
        }
        console.log("CUSTOM_HELMET_CHATHEAD_2485_BASE_PASS genders=2 appearance=native");
        checkHead(customHelmetId, Gender.MALE, [secondary, primary, secondary, primary], "custom male");
        checkHead(customHelmetId, Gender.FEMALE, [primary, secondary, primary, secondary], "custom female");
        // A valid masked candidate must not displace the canonical decoded item ID.
        const decoy = new ObjType(17233, info);
        Object.assign(decoy, { name: "Controlled masked-ID helmet", wearPos: 0, wearPos2: 8, wearPos3: 11,
            maleHeadModel: primary, maleHeadModel2: secondary,
            femaleHeadModel: secondary, femaleHeadModel2: primary });
        baseHelmets.set(17233, decoy);
        helmetLoader.clearCache();
        assert.equal(helmetLoader.load(17233).name, "Controlled masked-ID helmet");
        assert.deepEqual([decoy.maleHeadModel, decoy.maleHeadModel2, decoy.femaleHeadModel, decoy.femaleHeadModel2],
            [primary, secondary, secondary, primary], "prerequisite: valid decoy has different head models");
        checkHead(customHelmetId, Gender.MALE, [secondary, primary, secondary, primary], "custom male with valid masked decoy");
        checkHead(customHelmetId, Gender.FEMALE, [primary, secondary, primary, secondary], "custom female with valid masked decoy");
    } catch (error) {
        failure = error;
    } finally {
        try {
            loadFromPayload({ gamemodeId: "test", datasets: [
                { key: "customItems", rows: [] }, { key: "customModels", rows: [] },
            ] });
            loadFromPayload({ gamemodeId: "test", datasets: [
                { key: "customModels", rows: previousModels }, { key: "customItems", rows: previousItems },
            ] });
            CustomItemRegistry.revision = itemRevision;
            CustomModelRegistry.revision = modelRevision;
            assert.deepEqual(Array.from(CustomItemRegistry.getAll(), item => item.definition), previousItems);
            assert.deepEqual(CustomModelRegistry.getAll(), previousModels);
        } catch (error) { failure ??= error; }
    }
    if (failure) {
        console.error("CUSTOM_HELMET_CHATHEAD_2485_FAILURE: " +
            (failure instanceof Error ? failure.message.split(/\r?\n/, 1)[0] : String(failure)));
        console.error(failure);
        process.exitCode = 1;
    } else {
        console.log("CUSTOM_HELMET_CHATHEAD_2485_PASS ordinary=2 custom=2 legacy=4 decoy=2 genders=2 appearance=native+legacy models=DAT");
    }
}
