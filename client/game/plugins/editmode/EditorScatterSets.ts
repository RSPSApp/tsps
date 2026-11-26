export type EditorScatterSet = { name: string; ids: number[] };

const STORAGE_KEY = "map-editor:scatter-sets:v1";

export function readScatterSets(): EditorScatterSet[] {
    try {
        const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
        if (!Array.isArray(stored)) return [];
        return stored.flatMap((set) => {
            if (typeof set?.name !== "string" || !set.name.trim() || !Array.isArray(set.ids)) return [];
            const ids = [...new Set<number>(set.ids.filter((id: unknown) =>
                typeof id === "number" && Number.isInteger(id) && id >= 0 && id <= 65535))];
            return ids.length ? [{ name: set.name, ids }] : [];
        });
    } catch {
        return [];
    }
}

export function writeScatterSets(sets: readonly EditorScatterSet[]): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
}
