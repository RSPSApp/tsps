import { runLandscapeRequest, landscapeRegionInputs, landscapeObjectIds } from "./LandscapeRequest";

export type LandscapeRegion = { terrainData: Uint8Array; objectData: Uint8Array };
export type LandscapeObject = { models?: unknown[]; types?: number[]; actions?: (string | undefined)[]; name?: string; sizeX?: number; sizeY?: number };
export type LandscapeSnapshot = {
    revision: number;
    regions: [number, LandscapeRegion][];
    objects: [number, LandscapeObject][];
    occupied: number[];
};
export type LocalLandscapeSource = {
    revision: () => number;
    readRegion: (id: number) => Promise<LandscapeRegion | undefined>;
    occupiedRegionIds: () => readonly number[] | Promise<readonly number[]>;
    getObject: (id: number) => LandscapeObject | undefined;
    settled?: () => Promise<void>;
};

async function generate(snapshot: LandscapeSnapshot, part: string): Promise<any> {
    // Tests and older embedded browsers can execute the exact planner without a worker.
    if (typeof Worker === "undefined" || !/^\/(?:preview|scene|packs)(?:\?|$)/.test(part)) {
        return runLandscapeRequest(snapshot, part);
    }
    const worker = new Worker(new URL("./LandscapeWorker.ts", import.meta.url));
    try {
        return await new Promise((resolve, reject) => {
            worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result);
            worker.onerror = () => reject(new Error("The landscape generator worker failed to load"));
            worker.postMessage({ snapshot, part });
        });
    } finally {
        worker.terminate();
    }
}

export function createLocalLandscapeData(source: LocalLandscapeSource): (part?: string) => Promise<any> {
    return async (part = "") => {
        const regions = (await Promise.all(landscapeRegionInputs(part).map(async (id: number) => {
            const region = await source.readRegion(id);
            return region ? [id, region] as [number, LandscapeRegion] : undefined;
        }))).filter((entry): entry is [number, LandscapeRegion] => entry !== undefined);
        const ids = landscapeObjectIds(regions.map(([, region]) => region));
        const readObjects = () => ids.flatMap(id => {
            try {
                const object = source.getObject(id);
                return object ? [[id, { name: object.name, sizeX: object.sizeX, sizeY: object.sizeY,
                    models: object.models?.length ? [1] : [], types: object.types, actions: object.actions }] as [number, LandscapeObject]] : [];
            } catch { return []; }
        });
        const needsObjects = /^\/(?:scenery|preview|scene|packs)(?:\?|$)/.test(part);
        let objects = needsObjects ? readObjects() : [];
        if (needsObjects && source.settled) { await source.settled(); objects = readObjects(); }
        const operation = part.split("?")[0];
        const occupied = operation && operation !== "/" && operation !== "/scenery" ? [...await source.occupiedRegionIds()] : [];
        const snapshot = { revision: source.revision(), regions, objects, occupied };
        return generate(snapshot, part);
    };
}
