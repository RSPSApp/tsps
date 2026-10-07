import { CacheIndexDat2 } from "./codec/rs/cache/CacheIndex";
import { FileStore } from "./codec/rs/cache/store/FileStore";
import { CachePipeline } from "./CachePipeline";

/**
 * Gamevals: the names Jagex ships in the OSRS cache for its own ids (index 24), the names
 * rsprox prints in captures. One archive per kind; each file is one id.
 */
export const GAMEVAL_INDEX = 24;

export enum GamevalKind {
    OBJ = 0,
    NPC = 1,
    INV = 2,
    VARP = 3,
    VARBIT = 4,
    LOC = 6,
    SEQ = 7,
    SPOTANIM = 8,
    DBROW = 9,
    /** DB tables with their column names. */
    DBTABLE = 10,
    /** Interfaces with their components, in the format used from revision 232. */
    INTERFACE = 14,
}

export interface GamevalTable {
    name: string;
    /** Column names by column id. */
    columns: string[];
}

/** A DB table file: a byte, its name, then (non-zero byte, column name) until a zero byte. */
export function decodeGamevalTable(data: Int8Array): GamevalTable {
    let [name, offset] = readString(data, 1);
    const columns: string[] = [];
    while (offset < data.length && data[offset++] !== 0) {
        let column: string;
        [column, offset] = readString(data, offset);
        columns.push(column);
    }
    return { name, columns };
}

export interface GamevalInterface {
    name: string;
    /** Component id -> name. */
    components: Map<number, string>;
}

function readString(data: Int8Array, offset: number): [string, number] {
    let end = offset;
    while (end < data.length && data[end] !== 0) end++;
    return [Buffer.from(data.buffer, data.byteOffset + offset, end - offset).toString("latin1"), end + 1];
}

/** An interface file: its name, then (u16 component, string) pairs until 0xFFFF. */
export function decodeGamevalInterface(data: Int8Array): GamevalInterface {
    let [name, offset] = readString(data, 0);
    const components = new Map<number, string>();
    while (offset + 1 < data.length) {
        const id = ((data[offset] & 0xff) << 8) | (data[offset + 1] & 0xff);
        offset += 2;
        if (id === 0xffff) break;
        let component: string;
        [component, offset] = readString(data, offset);
        components.set(id, component);
    }
    return { name, components };
}

export class Gamevals {
    private interfaces?: Map<number, GamevalInterface>;
    private tables?: Map<number, GamevalTable>;
    private readonly names = new Map<GamevalKind, Map<number, string>>();

    constructor(private readonly store: FileStore = CachePipeline.getStore()) {}

    /** Every named id of one kind (not interfaces): id -> name. */
    public namesOf(kind: GamevalKind): Map<number, string> {
        const cached = this.names.get(kind);
        if (cached) return cached;
        const names = new Map<number, string>();
        const archive = CacheIndexDat2.fromStore(GAMEVAL_INDEX, this.store).getArchive(kind);
        for (const id of archive.fileIds) {
            const data = archive.getFile(id)?.data;
            if (data) names.set(id, Buffer.from(data.buffer, data.byteOffset, data.length).toString("utf8"));
        }
        this.names.set(kind, names);
        return names;
    }

    /** Every interface by group id. */
    public allInterfaces(): Map<number, GamevalInterface> {
        if (this.interfaces) return this.interfaces;
        this.interfaces = new Map();
        const archive = CacheIndexDat2.fromStore(GAMEVAL_INDEX, this.store).getArchive(GamevalKind.INTERFACE);
        for (const group of archive.fileIds) {
            const data = archive.getFile(group)?.data;
            if (data) this.interfaces.set(group, decodeGamevalInterface(data));
        }
        return this.interfaces;
    }

    /** Every DB table by id, with its column names. */
    public allTables(): Map<number, GamevalTable> {
        if (this.tables) return this.tables;
        this.tables = new Map();
        const archive = CacheIndexDat2.fromStore(GAMEVAL_INDEX, this.store).getArchive(GamevalKind.DBTABLE);
        for (const id of archive.fileIds) {
            const data = archive.getFile(id)?.data;
            if (data) this.tables.set(id, decodeGamevalTable(data));
        }
        return this.tables;
    }

    /** A DB table column's id by name, or null when the table has no such column. */
    public tableColumn(table: number, column: string): number | null {
        const index = this.allTables().get(table)?.columns.indexOf(column) ?? -1;
        return index >= 0 ? index : null;
    }

    /** `interface:component` for a packed `(group << 16) | component`, as rsprox prints it. */
    public componentName(uid: number): string | null {
        const iface = this.allInterfaces().get(uid >>> 16);
        const component = iface?.components.get(uid & 0xffff);
        return iface && component !== undefined ? `${iface.name}:${component}` : null;
    }

    /** The packed id of `interface:component`, or null when this cache has no such component. */
    public componentId(name: string): number | null {
        const [ifaceName, componentName] = name.split(":");
        for (const [group, iface] of this.allInterfaces()) {
            if (iface.name !== ifaceName) continue;
            for (const [id, component] of iface.components) {
                if (component === componentName) return (group << 16) | id;
            }
        }
        return null;
    }
}
