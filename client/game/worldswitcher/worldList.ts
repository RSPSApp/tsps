/**
 * The world list as the cache's World Switcher (interface 69) reads it through the
 * WORLDLIST_* commands (rs/cs2/handlers/WorldListOps.ts): the worlds the client already lists
 * (the login screen's server list), each given what an OSRS world has: a number, a type, a
 * location (its flag), how many are on it, and its "activity" text, where we show its name.
 *
 * The number: the script draws the world's id as it is and keeps one click zone per id from 0 to
 * 900 (script 747), so these are small numbers in list order: the one the list states, or its
 * place in the list. Numbers from 301 up would be read as OSRS's own worlds (enum 4992 calls some
 * of those "US East" and "US West", enum 1496 gives some a total level).
 */
import type { ServerListEntry } from "../login/renderer/types";

/** A world as WORLDLIST_START / _NEXT / _SPECIFIC push it. */
export interface SwitcherWorld {
    id: number;
    properties: number;
    activity: string;
    location: number;
    population: number;
    host: string;
    /** Its place in the client's server list; -1 for the world we are on when the list lacks it. */
    index: number;
}

/** The highest id the World Switcher has a click zone for (script 747 makes 0 to 900). */
export const MAX_WORLD_NUMBER = 900;
/** World type bit 0: a members' world (a gold star and yellow number). */
export const WORLD_MEMBERS = 1;

/** OSRS's location numbers (enum 1125 gives each its flag); -1 draws the enum's default flag. */
export const WorldLocation = {
    UNITED_STATES: 0, UNITED_KINGDOM: 1, CANADA: 2, AUSTRALIA: 3, NETHERLANDS: 4, SWEDEN: 5, FINLAND: 6, GERMANY: 7, UNKNOWN: -1,
} as const;

// A country by its name or by a city worlds are hosted in; in a stated location, by its code too
// (a world's name is only read for the names: "us" or "de" in a name is a word, not a country).
const LOCATION_NAMES: [RegExp, number][] = [
    [/\b(united kingdom|great britain|england|scotland|wales|london|manchester|coventry|birmingham|portsmouth)\b/, WorldLocation.UNITED_KINGDOM],
    [/\b(germany|deutschland|frankfurt|berlin|falkenstein|nuremberg|dusseldorf|munich)\b/, WorldLocation.GERMANY],
    [/\b(australia|sydney|melbourne|brisbane|perth)\b/, WorldLocation.AUSTRALIA],
    [/\b(canada|toronto|montreal|vancouver|beauharnois)\b/, WorldLocation.CANADA],
    [/\b(netherlands|holland|amsterdam|rotterdam)\b/, WorldLocation.NETHERLANDS],
    [/\b(sweden|stockholm)\b/, WorldLocation.SWEDEN],
    [/\b(finland|helsinki)\b/, WorldLocation.FINLAND],
    [/\b(united states|america|dallas|new york|chicago|miami|los angeles|seattle|atlanta|ashburn|phoenix|denver|las vegas|kansas city|san jose|buffalo|virginia|texas|california|oregon|florida)\b/, WorldLocation.UNITED_STATES],
];
const LOCATION_CODES: [RegExp, number][] = [
    [/\b(uk|gb|gbr)\b/, WorldLocation.UNITED_KINGDOM],
    [/\b(de|deu|ger)\b/, WorldLocation.GERMANY],
    [/\b(au|aus)\b/, WorldLocation.AUSTRALIA],
    [/\b(ca|can)\b/, WorldLocation.CANADA],
    [/\b(nl|nld)\b/, WorldLocation.NETHERLANDS],
    [/\b(se|swe)\b/, WorldLocation.SWEDEN],
    [/\b(fi|fin)\b/, WorldLocation.FINLAND],
    [/\b(us|usa|nyc)\b/, WorldLocation.UNITED_STATES],
];

const words = (text: string | undefined): string => String(text ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
const locationIn = (text: string, table: [RegExp, number][]): number | undefined => table.find(([pattern]) => pattern.test(text))?.[1];

// A country code written in capitals in a world's name ("My World - US SD", "My World - UK") is
// the country, for worlds whose stated location ("SD", a misspelt "United Kindom") names no
// country the tables know. Capitals only: "us" in a name is still a word.
const NAME_CODES: [RegExp, number][] = [
    [/\b(UK|GB)\b/, WorldLocation.UNITED_KINGDOM],
    [/\bDE\b/, WorldLocation.GERMANY],
    [/\bAU\b/, WorldLocation.AUSTRALIA],
    [/\bCA\b/, WorldLocation.CANADA],
    [/\bNL\b/, WorldLocation.NETHERLANDS],
    [/\bSE\b/, WorldLocation.SWEDEN],
    [/\bFI\b/, WorldLocation.FINLAND],
    [/\b(US|USA)\b/, WorldLocation.UNITED_STATES],
];

/**
 * The OSRS location of a world from its stated location ("Dallas, US", "London 2", "United
 * Kingdom", "uk") or, failing that, from a place in its name ("My World New York").
 */
export function worldLocation(location: string | undefined, name?: string): number {
    const stated = words(location);
    return locationIn(stated, LOCATION_NAMES) ?? locationIn(stated, LOCATION_CODES) ?? locationIn(words(name), LOCATION_NAMES)
        ?? locationIn(String(name ?? ""), NAME_CODES) ?? WorldLocation.UNKNOWN;
}

/** Where the client is connected, as LoginState keeps it. */
export interface CurrentServer {
    serverAddress: string;
    serverSecure: boolean;
    serverTransport: "websocket" | "webrtc";
    serverSignalUrl?: string;
    serverWorldId?: string;
    serverName?: string;
    serverWorldFlags?: number;
}

/** Whether a listed server is the one the client is on. */
export function isCurrentServer(server: ServerListEntry | undefined, current: CurrentServer): boolean {
    if (!server) return false;
    const transport = server.transport ?? "websocket";
    if (transport !== current.serverTransport) return false;
    if (transport === "webrtc") {
        return server.worldId === current.serverWorldId && server.signalUrl === current.serverSignalUrl;
    }
    return server.address === current.serverAddress && server.secure === current.serverSecure;
}

/** Each listed server's world number: the one the list states, else the first one free. */
export function worldNumbers(servers: ServerListEntry[]): number[] {
    const used = new Set<number>();
    const numbers = servers.map((server) => {
        const stated = server.number;
        if (typeof stated !== "number" || !Number.isInteger(stated) || stated < 1 || stated > MAX_WORLD_NUMBER || used.has(stated)) return 0;
        used.add(stated);
        return stated;
    });
    let next = 1;
    return numbers.map((number) => {
        if (number) return number;
        while (used.has(next)) next++;
        used.add(next);
        return next <= MAX_WORLD_NUMBER ? next : 0;
    });
}

/** The first number no listed server has: the one a world the list lacks is given. */
function freeNumber(numbers: number[]): number {
    const taken = new Set(numbers);
    let id = 1;
    while (taken.has(id)) id++;
    return id <= MAX_WORLD_NUMBER ? id : 0;
}

/** The number of the world we are on: the listed server's, or the one it gets when the list lacks it. */
export function currentWorldNumber(servers: ServerListEntry[], current: CurrentServer): number {
    const numbers = worldNumbers(servers);
    const listed = servers.findIndex((server, index) => numbers[index] > 0 && isCurrentServer(server, current));
    if (listed >= 0) return numbers[listed];
    return current.serverAddress ? freeNumber(numbers) : 0;
}

/**
 * The servers as worlds, and the number of the one we are on (0 when it cannot be told). A world
 * the list does not have (an unlisted one opened by a link) is added at the end, so the list
 * always shows where the player is.
 */
export function switcherWorlds(servers: ServerListEntry[], current: CurrentServer): { worlds: SwitcherWorld[]; current: number } {
    const numbers = worldNumbers(servers);
    const worlds: SwitcherWorld[] = [];
    const currentNumber = currentWorldNumber(servers, current);
    servers.forEach((server, index) => {
        const id = numbers[index];
        if (!id) return;
        const here = id === currentNumber;
        const offline = server.playerCount === null && !here;
        worlds.push({
            id,
            properties: here && current.serverWorldFlags ? current.serverWorldFlags | 0 : WORLD_MEMBERS,
            // Said first, where the narrow column still shows it: a name is cut short there.
            activity: offline ? `Offline - ${server.name}` : server.name,
            location: worldLocation(server.location, server.name),
            population: typeof server.playerCount === "number" && server.playerCount >= 0 ? server.playerCount : 0,
            host: server.address,
            index,
        });
    });
    if (currentNumber > 0 && !worlds.some((world) => world.id === currentNumber)) {
        worlds.push({
            id: currentNumber,
            properties: current.serverWorldFlags ? current.serverWorldFlags | 0 : WORLD_MEMBERS,
            activity: current.serverName || current.serverAddress,
            location: worldLocation(undefined, current.serverName),
            population: 0,
            host: current.serverAddress,
            index: -1,
        });
    }
    return { worlds, current: currentNumber };
}

/** WORLDLIST_SORT's columns, as the client compares them (the default is the world's number). */
const SORT_POPULATION = 1;
const SORT_LOCATION = 2;
const SORT_ACTIVITY = 3;
const SORT_MEMBERS = 7;

const javaCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareBy(a: SwitcherWorld, b: SwitcherWorld, column: number, descending: boolean): number {
    switch (column) {
        case SORT_POPULATION:
            return a.population - b.population;
        case SORT_LOCATION:
            return a.location - b.location;
        case SORT_ACTIVITY:
            // A world with no activity ("-") goes last, whichever way the column is sorted.
            if (a.activity === "-") return b.activity === "-" ? 0 : descending ? -1 : 1;
            if (b.activity === "-") return descending ? 1 : -1;
            return javaCompare(a.activity, b.activity);
        case SORT_MEMBERS:
            return (a.properties & WORLD_MEMBERS) - (b.properties & WORLD_MEMBERS);
        default:
            return a.id - b.id;
    }
}

/** The worlds in WORLDLIST_SORT's order: by one column, ties by the second (-1: none). */
export function sortWorlds(worlds: SwitcherWorld[], column: number, descending: boolean, second: number, secondDescending: boolean): SwitcherWorld[] {
    return [...worlds].sort((a, b) => {
        const first = compareBy(a, b, column, descending);
        if (first !== 0) return descending ? -first : first;
        if (second === -1) return 0;
        const next = compareBy(a, b, second, secondDescending);
        return secondDescending ? -next : next;
    });
}

/** What the game supplies: whether its list is loaded, the worlds, and the one we are on. */
export interface WorldListSource {
    ready(): boolean;
    worlds(): SwitcherWorld[];
    current(): number;
}

/**
 * The list behind the WORLDLIST_* commands. As in the client, a sort reorders the list and
 * START / NEXT then walk it; the worlds are read again from the game at each sort or start, so a
 * refreshed player count shows the next time the scripts build the rows.
 */
export class WorldList {
    private order: SwitcherWorld[] = [];
    private cursor = 0;
    private sorting: [number, boolean, number, boolean] | undefined;

    constructor(private readonly source: WorldListSource) {}

    /** WORLDLIST_FETCH: true once there is a list to show. */
    fetch(): boolean {
        return this.source.ready();
    }

    /**
     * MAP_WORLD, as the World Switcher's scripts read it: the number of the world we are on.
     * Undefined until the list is loaded (a number taken from the list we start with would change
     * under the scripts when the real one arrives).
     */
    currentWorld(): number | undefined {
        return this.source.ready() ? this.source.current() || undefined : undefined;
    }

    sort(column: number, descending: boolean, second: number, secondDescending: boolean): void {
        this.sorting = [column, descending, second, secondDescending];
    }

    start(): SwitcherWorld | undefined {
        const worlds = this.source.worlds();
        this.order = this.sorting ? sortWorlds(worlds, ...this.sorting) : worlds;
        this.cursor = 0;
        return this.next();
    }

    next(): SwitcherWorld | undefined {
        return this.cursor < this.order.length ? this.order[this.cursor++] : undefined;
    }

    specific(id: number): SwitcherWorld | undefined {
        return this.source.worlds().find((world) => world.id === id);
    }
}
