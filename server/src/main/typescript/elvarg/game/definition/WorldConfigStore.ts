import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

type JsonObject = Record<string, unknown>;

/** world.json and world.local.json as they are on disk, kept apart. */
export interface WorldConfigLayers {
    shipped: JsonObject;
    local: JsonObject;
    localExists: boolean;
    /** sha256 of world.local.json raw bytes; "" when the file is absent. */
    localHash: string;
    /** Set (and local left empty) when world.local.json does not parse: the page goes read-only. */
    localError?: string;
}

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export class WorldConfigStore {
    /** Reads both layers from `dir` (default: data/definitions under the working directory). Never throws for a bad local file. */
    public static read(dir: string = path.resolve("data/definitions")): WorldConfigLayers {
        const shippedParsed = JSON.parse(fs.readFileSync(path.join(dir, "world.json"), "utf8"));
        if (!isObject(shippedParsed)) throw new Error("world.json must be an object");
        const localFile = path.join(dir, "world.local.json");
        if (!fs.existsSync(localFile)) {
            return { shipped: shippedParsed, local: {}, localExists: false, localHash: "" };
        }
        const raw = fs.readFileSync(localFile);
        const localHash = crypto.createHash("sha256").update(raw).digest("hex");
        try {
            const parsed = JSON.parse(raw.toString("utf8"));
            if (!isObject(parsed)) throw new Error("world.local.json must be an object");
            return { shipped: shippedParsed, local: parsed, localExists: true, localHash };
        } catch (err) {
            return {
                shipped: shippedParsed,
                local: {},
                localExists: true,
                localHash,
                localError: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
