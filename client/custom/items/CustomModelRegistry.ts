export type CustomModelRow = { id: number; data: string };

// Keep encoded bytes: callers recolour/resize decoded ModelData in place.
const models = new Map<number, { row: CustomModelRow; bytes: Int8Array }>();

function decodeModel(row: CustomModelRow) {
    if (!row || !Number.isInteger(row.id) || row.id < 1000000 || row.id > 0x7fffffff ||
        typeof row.data !== "string" || row.data.length > 1400000) {
        throw new Error("Invalid custom model");
    }
    const decoded = atob(row.data);
    if (decoded.length < 18) throw new Error("Custom model is truncated");
    return { row: { id: row.id, data: row.data }, bytes: Int8Array.from(decoded, (byte) => byte.charCodeAt(0)) };
}

export const CustomModelRegistry = {
    revision: 0,
    register(row: CustomModelRow): void {
        const model = decodeModel(row);
        models.set(model.row.id, model);
        this.revision++;
    },
    /** Whole snapshots replace atomically; a malformed model keeps the previous world intact. */
    replace(input: unknown): void {
        if (!Array.isArray(input)) throw new Error("Custom models must be a list");
        const next = new Map<number, ReturnType<typeof decodeModel>>();
        for (const row of input) {
            const model = decodeModel(row);
            if (next.has(model.row.id)) throw new Error("Duplicate custom model");
            next.set(model.row.id, model);
        }
        models.clear();
        for (const [id, model] of next) models.set(id, model);
        this.revision++;
    },
    get(id: number): Int8Array | undefined { return models.get(id)?.bytes; },
    getAll(): CustomModelRow[] { return Array.from(models.values(), ({ row }) => row); },
    clear(): void { models.clear(); this.revision++; },
};
