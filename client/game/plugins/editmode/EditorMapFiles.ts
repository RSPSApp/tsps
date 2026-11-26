import { parseRegionPack } from "./RegionPack";

type Picker = (options: { id: string; mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
type DirectoryEntries = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
type Destination = { folder: "definitions" | "regions"; name: string };
type BackupFile = { path: string; existed: boolean };
type LayerFile = { path: string; exists: boolean };

const editableDefinitions = new Set(["object-spawns.json", "npc-spawns-custom.json", "map-warps.json", "ground-items-custom.json", "world.local.json", "map-zones.json", "map-spawn.json"]);
const regionName = /^\d{1,5}\.(?:pack|terrain\.dat|objects\.dat)$/;
const snapshotName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f\d-]+$/;

function picker(): Picker | undefined {
    return (window as Window & { showDirectoryPicker?: Picker }).showDirectoryPicker?.bind(window);
}

function destination(path: string): Destination {
    const [folder, name, extra] = path.split("/");
    if (!extra && name && ((folder === "regions" && regionName.test(name)) ||
        (folder === "definitions" && editableDefinitions.has(name)))) return { folder, name };
    throw new Error("The map editor cannot write this file");
}

export function mapEditLayerId(latest?: string): string {
    const previous = latest?.slice(0, 24).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
    return `${new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
}

async function directoryAt(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | undefined> {
    try {
        return await dir.getDirectoryHandle(name);
    } catch (error) {
        if ((error as DOMException)?.name !== "NotFoundError") throw error;
    }
}

async function fileAt(dir: FileSystemDirectoryHandle, name: string): Promise<File | undefined> {
    try {
        return await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
        if ((error as DOMException)?.name !== "NotFoundError") throw error;
    }
}

async function write(dir: FileSystemDirectoryHandle, name: string, data: Blob): Promise<void> {
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    try {
        await stream.write(data);
        await stream.close();
    } catch (error) {
        await stream.abort().catch(() => undefined);
        throw error;
    }
}

async function fingerprint(file: File | undefined): Promise<string> {
    if (!file) return "";
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class EditorMapFiles {
    private readonly baseline = new Map<string, File>();
    private readonly hashes = new Map<string, string>();

    private constructor(
        private readonly root: FileSystemDirectoryHandle,
        private readonly definitions: FileSystemDirectoryHandle,
        private readonly regions: FileSystemDirectoryHandle,
    ) {}

    static supported(): boolean {
        return typeof picker() === "function" && !!crypto.subtle;
    }

    static async open(): Promise<EditorMapFiles> {
        const choose = picker();
        if (!choose) throw new Error("This browser cannot save directly to a server folder");
        const selected = await choose({ id: "ghostscape-map-data", mode: "readwrite" });
        const data = selected.name === "data" ? selected : await selected.getDirectoryHandle("data");
        const definitions = await data.getDirectoryHandle("definitions");
        if (!await fileAt(definitions, "world.json") || !await fileAt(definitions, "object-spawns.json")) {
            throw new Error("Choose the world server folder or its data folder");
        }
        const regions = await data.getDirectoryHandle("regions", { create: true });
        const editor = new EditorMapFiles(data, definitions, regions);
        const layers = await editor.readLayers();
        const paths = new Set(layers.files.keys());
        for (const folder of ["definitions", "regions"] as const) {
            for await (const entry of (editor[folder] as DirectoryEntries).values()) {
                if (entry.kind !== "file" || !(folder === "definitions" ? editableDefinitions.has(entry.name) : regionName.test(entry.name))) continue;
                paths.add(`${folder}/${entry.name}`);
            }
        }
        for (const path of paths) await editor.setBaseline(path, await editor.effectiveFile(path, layers.files));
        return editor;
    }

    private async readLayers(): Promise<{ latest?: string; files: Map<string, FileSystemDirectoryHandle | null> }> {
        const files = new Map<string, FileSystemDirectoryHandle | null>();
        const directory = await directoryAt(this.root, "map-edits") as DirectoryEntries | undefined;
        if (!directory) return { files };
        const names: string[] = [];
        for await (const entry of directory.values()) {
            if (entry.kind === "directory" && snapshotName.test(entry.name)) names.push(entry.name);
        }
        let latest: string | undefined;
        for (const id of names.sort()) {
            const layer = await directory.getDirectoryHandle(id);
            const manifest = await fileAt(layer, "manifest.json");
            if (!manifest?.size) continue;
            const entries: LayerFile[] = JSON.parse(await manifest.text());
            if (!Array.isArray(entries)) throw new Error(`Invalid map edit manifest: ${id}`);
            for (const entry of entries) {
                const { folder } = destination(entry.path);
                if (typeof entry.exists !== "boolean") throw new Error(`Invalid map edit manifest: ${id}`);
                files.set(entry.path, entry.exists ? await layer.getDirectoryHandle(folder) : null);
            }
            latest = id;
        }
        return { latest, files };
    }

    private async effectiveFile(path: string, files: ReadonlyMap<string, FileSystemDirectoryHandle | null>): Promise<File | undefined> {
        const { folder, name } = destination(path);
        const layer = files.get(path);
        if (layer === null) return undefined;
        const file = await fileAt(layer ?? this[folder], name);
        if (layer && !file) throw new Error(`Map edit file is missing: ${path}`);
        return file;
    }

    async listBackups(): Promise<string[]> {
        let directory: FileSystemDirectoryHandle;
        try {
            directory = await this.root.getDirectoryHandle("map-editor-backups");
        } catch (error) {
            if ((error as DOMException)?.name === "NotFoundError") return [];
            throw error;
        }
        const names: string[] = [];
        for await (const entry of (directory as DirectoryEntries).values()) {
            if (entry.kind !== "directory" || !snapshotName.test(entry.name)) continue;
            const snapshot = entry as FileSystemDirectoryHandle;
            if (await fileAt(snapshot, "manifest.json")) names.push(entry.name);
        }
        return names.sort().reverse();
    }

    async listOriginals(): Promise<string[]> {
        let original: FileSystemDirectoryHandle;
        try {
            original = await (await this.root.getDirectoryHandle("map-editor-backups")).getDirectoryHandle("originals");
        } catch (error) {
            if ((error as DOMException)?.name === "NotFoundError") return [];
            throw error;
        }
        const paths: string[] = [];
        for (const folder of ["definitions", "regions"] as const) {
            let directory: FileSystemDirectoryHandle;
            try {
                directory = await original.getDirectoryHandle(folder);
            } catch (error) {
                if ((error as DOMException)?.name === "NotFoundError") continue;
                throw error;
            }
            for await (const entry of (directory as DirectoryEntries).values()) {
                const name = entry.name.replace(/\.missing$/, "");
                if (entry.kind === "file" && (folder === "regions" ? regionName.test(name) : editableDefinitions.has(name))) {
                    paths.push(`${folder}/${name}`);
                }
            }
        }
        return [...new Set(paths)].sort();
    }

    async checkLoadedWorld(name: string, loaded: unknown): Promise<void> {
        const file = this.baseline.get(`definitions/${name}`);
        if (file && JSON.stringify(JSON.parse(await file.text())) !== JSON.stringify(loaded)) {
            throw new Error("The server folder has newer gameplay zones or world spawn settings. Load the saved world and refresh the editor first.");
        }
    }

    async checkLoadedRegion(id: number, loaded?: { terrainData: Uint8Array; objectData?: Uint8Array }): Promise<void> {
        const pack = this.baseline.get(`regions/${id}.pack`);
        const terrain = this.baseline.get(`regions/${id}.terrain.dat`);
        if (!pack && !terrain) return;
        const expected = pack ? parseRegionPack(new Uint8Array(await pack.arrayBuffer()))
            : { terrainData: new Uint8Array(await terrain!.arrayBuffer()), objectData: undefined };
        const equal = (first: Uint8Array, second?: Uint8Array) => second?.length === first.length &&
            first.every((byte, i) => second[i] === byte);
        if (!loaded || !equal(expected.terrainData, loaded.terrainData) ||
            (expected.objectData && !equal(expected.objectData, loaded.objectData))) {
            throw new Error(`Map square ${id} has a different save in this folder. Load the saved world and refresh the editor before editing it.`);
        }
    }

    async checkLoadedDefinition(name: string, contents: string): Promise<void> {
        const file = this.baseline.get(`definitions/${name}`);
        const disk = file ? JSON.parse(await file.text()) : [];
        if (JSON.stringify(disk) !== JSON.stringify(JSON.parse(contents))) {
            throw new Error(`${name} differs from the data loaded in this editor. Reopen the editor against the selected world before saving.`);
        }
    }

    async save(files: ReadonlyMap<string, Blob | null>, newFiles: ReadonlySet<string> = new Set()): Promise<string> {
        return navigator.locks
            ? navigator.locks.request("ghostscape-map-editor-save", () => this.saveExclusive(files, newFiles))
            : this.saveExclusive(files, newFiles);
    }

    private async saveExclusive(files: ReadonlyMap<string, Blob | null>, newFiles: ReadonlySet<string>): Promise<string> {
        if (!files.size) throw new Error("No files to save");
        const layers = await this.readLayers();
        const current = new Map<string, File | undefined>();
        const checked = new Set(files.keys());
        for (const path of files.keys()) {
            if (path.startsWith("regions/") && path.endsWith(".pack")) {
                checked.add(path.replace(/\.pack$/, ".terrain.dat"));
                checked.add(path.replace(/\.pack$/, ".objects.dat"));
            }
        }
        for (const path of checked) {
            const file = await this.effectiveFile(path, layers.files);
            const pack = path.replace(/\.(?:terrain|objects)\.dat$/, ".pack");
            if (file && newFiles.has(pack)) throw new Error(`${pack} already exists in the selected server folder`);
            if (await fingerprint(file) !== (this.hashes.get(path) ?? "")) {
                throw new Error(`${path} changed on disk. Keep an export, then reopen the editor to load those changes.`);
            }
            if (files.has(path)) current.set(path, file);
        }
        const id = mapEditLayerId(layers.latest);
        const backups = await this.root.getDirectoryHandle("map-editor-backups", { create: true });
        const original = await backups.getDirectoryHandle("originals", { create: true });
        const layerRoot = await this.root.getDirectoryHandle("map-edits", { create: true });
        const manifest: BackupFile[] = [];
        const layerManifest: LayerFile[] = [];
        const next = new Map<string, File | undefined>();
        try {
            const snapshot = await backups.getDirectoryHandle(id, { create: true });
            const layer = await layerRoot.getDirectoryHandle(id, { create: true });
            for (const [path, before] of current) {
                const { folder, name } = destination(path);
                const initial = await original.getDirectoryHandle(folder, { create: true });
                if (!await fileAt(initial, name) && !await fileAt(initial, `${name}.missing`)) {
                    await write(initial, before ? name : `${name}.missing`, before ?? new Blob());
                }
                if (before) await write(await snapshot.getDirectoryHandle(folder, { create: true }), name, before);
                manifest.push({ path, existed: !!before });
                const contents = files.get(path)!;
                layerManifest.push({ path, exists: contents !== null });
                if (contents !== null) {
                    const target = await layer.getDirectoryHandle(folder, { create: true });
                    await write(target, name, contents);
                    const file = await fileAt(target, name);
                    if (!file) throw new Error(`Could not write ${path}`);
                    next.set(path, file);
                } else next.set(path, undefined);
            }
            await write(snapshot, "manifest.json", new Blob([JSON.stringify(manifest)]));
            const latest = await this.readLayers();
            for (const path of checked) {
                if (await fingerprint(await this.effectiveFile(path, latest.files)) !== (this.hashes.get(path) ?? "")) {
                    throw new Error(`${path} changed while saving. Reopen the editor to load those changes.`);
                }
            }
            if (latest.latest && latest.latest >= id) throw new Error("Another edit saved while you were saving. Try again.");
            await write(layer, "manifest.json", new Blob([JSON.stringify(layerManifest)]));
        } catch (error) {
            await layerRoot.removeEntry(id, { recursive: true }).catch(() => undefined);
            await backups.removeEntry(id, { recursive: true }).catch(() => undefined);
            throw error;
        }
        for (const [path, file] of next) await this.setBaseline(path, file);
        return id;
    }

    private async setBaseline(path: string, file: File | undefined): Promise<void> {
        if (file) {
            this.baseline.set(path, file);
            this.hashes.set(path, await fingerprint(file));
        } else {
            this.baseline.delete(path);
            this.hashes.delete(path);
        }
    }

    async restore(id: string): Promise<void> {
        if (!snapshotName.test(id)) throw new Error("Choose a map backup");
        const root = await this.root.getDirectoryHandle("map-editor-backups");
        const snapshot = await root.getDirectoryHandle(id);
        const manifest = await fileAt(snapshot, "manifest.json");
        const entries: BackupFile[] = JSON.parse(await manifest!.text());
        const files = new Map<string, Blob | null>();
        for (const entry of entries) {
            const { folder, name } = destination(entry.path);
            const file = entry.existed ? await fileAt(await snapshot.getDirectoryHandle(folder), name) : null;
            if (file === undefined) throw new Error(`Backup file ${entry.path} is missing`);
            files.set(entry.path, file);
        }
        await this.save(files);
    }

    async restoreOriginal(path: string): Promise<void> {
        const { folder, name } = destination(path);
        const backups = await this.root.getDirectoryHandle("map-editor-backups");
        const original = await (await backups.getDirectoryHandle("originals")).getDirectoryHandle(folder);
        const file = await fileAt(original, name);
        if (!file && !await fileAt(original, `${name}.missing`)) throw new Error("No original is saved for that file");
        await this.save(new Map([[path, file ?? null]]));
    }
}
