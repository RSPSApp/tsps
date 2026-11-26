/**
 * The World Switcher as OSRS has it: the cache's own interface (69) in the side panel, where the
 * logout tab is, built by the cache's own scripts from the client's world list (worldList.ts).
 *
 * In OSRS the server opens it and answers its buttons. Here the client does: the list of worlds is
 * the client's to know (the login screen's server list), not the world's, and a world that has
 * not been restarted since this was added still gets a working switcher. So nothing pressed in it is sent to the
 * world: Switch hops as choosing a world always has (OsrsClient.switchToServer), Close puts the
 * logout tab back, Logout logs out, and the sort column and the two favourites (varbits 4596 to
 * 4598, which the scripts read) are kept in this browser, per account, with each favourite kept as
 * the world itself and not its number.
 */
import type { ServerListEntry } from "../login/renderer/types";
import { type CurrentServer, type SwitcherWorld, WorldList, currentWorldNumber, switcherWorlds } from "./worldList";

export const WORLDSWITCHER_GROUP = 69;
export const LOGOUT_GROUP = 182;
/** logout:world_switcher (182:3). */
export const LOGOUT_WORLD_SWITCHER_UID = (LOGOUT_GROUP << 16) | 3;
/** The logout tab's stone (stone10) in the modern, classic and fixed layouts (rsprox captures). */
export const LOGOUT_STONE_UIDS: ReadonlySet<number> = new Set([(161 << 16) | 46, (164 << 16) | 34, (548 << 16) | 51]);
/** The side panel's logout tab. */
export const LOGOUT_TAB = 10;

// Interface 69's components (script 747's arguments say which is which).
const COMPONENT_CONFIGURE = 4;
const COMPONENT_CLOSE = 5;
const COMPONENT_SORT_FIRST = 12;
const COMPONENT_SORT_LAST = 16;
const COMPONENT_WORLD_CLICKZONES = 18;
const COMPONENT_FAVOURITE_1 = 23;
const COMPONENT_FAVOURITE_2 = 24;
const COMPONENT_LOGOUT = 25;

export const VARBIT_WORLDSWITCHER_SORT = 4596;
export const VARBIT_WORLDSWITCHER_FAVOURITE_1 = 4597;
export const VARBIT_WORLDSWITCHER_FAVOURITE_2 = 4598;
/** worldswitcher_sort's values run from 0 (by number) to 9. */
const SORT_MAX = 9;

/** The interface click, as the cache's own op script (970) plays it for Switch and Favourite. */
const SOUND_INTERFACE_CLICK = 2266;

const OP_FIRST = 1;
const OP_SECOND = 2;

export const CONFIRM_YES = "Yes";
export const CONFIRM_YES_ALWAYS = "Yes, and don't ask again";
export const CONFIRM_NO = "No";
const CONFIRM_OPTIONS = [CONFIRM_YES, CONFIRM_YES_ALWAYS, CONFIRM_NO];

/** What a world is remembered by: its id on the list, else how it is reached. */
export function worldKey(server: ServerListEntry): string {
    return server.id ? `id:${server.id}` : `${server.transport ?? "websocket"}|${server.address}|${server.worldId ?? ""}`;
}

interface Saved {
    sort: number;
    favourites: [string, string];
}

export interface SwitcherWidget {
    uid: number;
    /** A component made by a script carries its parent's id here. */
    id?: number;
    groupId?: number;
    fileId?: number;
    childIndex?: number;
}

export interface SwitcherAction {
    widget?: SwitcherWidget | null;
    option?: string;
    opIndex?: number;
}

/** What the game does for the switcher (OsrsClient supplies it; the tests supply a fake). */
export interface WorldSwitcherHost {
    servers(): ServerListEntry[];
    current(): CurrentServer;
    /** Whether a first list has been fetched and asked how its worlds are. */
    listLoaded(): boolean;
    /** Fetch the list if need be and ask every world how it is; resolves when the answers are in. */
    refreshList(): Promise<void>;
    /** The group in the logout tab's pane, or undefined when the layout has no such pane now. */
    mountedGroup(): number | undefined;
    /**
     * Put the World Switcher in the logout tab's pane (its own script fills it) with these
     * components hidden, or the logout tab back.
     */
    mountSwitcher(hidden: number[]): void;
    mountLogoutTab(): void;
    showLogoutTab(): void;
    /** Run a component's own op script here, without telling the world. */
    runOp(widget: SwitcherWidget, opIndex: number): void;
    /** Have the switcher's scripts build the rows again (they do when its varps are transmitted). */
    rebuild(): void;
    getVarbit(id: number): number;
    setVarbit(id: number, value: number): void;
    playSound(id: number): void;
    /** Hop to a listed server; it asks first unless told not to. */
    switchToServer(index: number, confirmed: boolean): void;
    /**
     * Turn "World Switcher confirmation" off (varbit 4100, All Settings row 347), and have the
     * world keep it, as the row does; resolves once the world has had it, before a logout.
     */
    stopConfirming(): Promise<void> | void;
    logout(): void;
    /** A question in the chatbox with options to click; `answer` gets the option's place, from 0. */
    askInChatbox(title: string, options: string[], answer: (option: number) => void): void;
    closeChatboxQuestion(): void;
    /** The account's name, for what is remembered per account. */
    account(): string;
    load(key: string): string | null;
    save(key: string, value: string): void;
}

export class WorldSwitcher {
    /** The list the cache's scripts read (Cs2Context.worldList). */
    readonly worldList: WorldList;
    private loadedOnce = false;
    private asking: ServerListEntry | undefined;
    /** A remembered favourite the list does not have just now: shown as none, and still remembered. */
    private missing: [boolean, boolean] = [false, false];

    constructor(private readonly host: WorldSwitcherHost) {
        this.worldList = new WorldList({
            // A list that has been shown before is shown again at once; the new answers follow.
            ready: () => this.loadedOnce || host.listLoaded(),
            worlds: () => this.worlds().worlds,
            current: () => currentWorldNumber(host.servers(), host.current()),
        });
    }

    private worlds(): { worlds: SwitcherWorld[]; current: number } {
        return switcherWorlds(this.host.servers(), this.host.current());
    }

    isOpen(): boolean {
        return this.host.mountedGroup() === WORLDSWITCHER_GROUP;
    }

    /** "World Switcher" on the logout tab or its stone. */
    open(): void {
        const host = this.host;
        this.loadedOnce ||= host.listLoaded();
        this.applySaved();
        host.showLogoutTab();
        if (host.mountedGroup() === undefined) return;
        // The cog opens OSRS's filters (world types and a search), which the server runs and our
        // handful of like worlds has no use for: no button rather than one that does nothing.
        if (!this.isOpen()) host.mountSwitcher([(WORLDSWITCHER_GROUP << 16) | COMPONENT_CONFIGURE]);
        void host.refreshList().then(() => {
            this.loadedOnce = true;
            if (!this.isOpen()) return;
            this.applySaved();
            host.rebuild();
        }, () => {});
    }

    /** The switcher's own Close button: back to the logout tab. */
    close(): void {
        this.dismissQuestion();
        if (this.isOpen()) this.host.mountLogoutTab();
    }

    /**
     * A click or menu option on a component. True when it was the button that opens the World
     * Switcher or one of the switcher's own, and so is not for the world.
     */
    handleAction(event: SwitcherAction): boolean {
        const uid = (event.widget?.uid ?? 0) | 0;
        const option = (event.option ?? "").replace(/<[^>]*>/g, "").trim();
        if (event.widget && (uid === LOGOUT_WORLD_SWITCHER_UID || (option === "World Switcher" && LOGOUT_STONE_UIDS.has(uid)))) {
            this.open();
            return true;
        }
        return this.handleSwitcherAction(event);
    }

    /**
     * A click or menu option on one of the switcher's buttons: answered here, in place of the
     * button's own script (which, for a world's row as for Logout, starts a logout: in OSRS the
     * server then says where to) and of telling the world. False for anything else, the list's
     * scrollbar included.
     */
    handleSwitcherAction(event: SwitcherAction): boolean {
        const widget = event.widget;
        if (!widget) return false;
        const uid = widget.uid | 0;
        const option = (event.option ?? "").replace(/<[^>]*>/g, "").trim();
        // A script-made component (a world's click zone) is known by its parent and its place in it.
        const dynamic = typeof widget.fileId === "number" && widget.fileId < 0;
        const componentUid = (dynamic ? widget.id ?? uid : uid) | 0;
        if (componentUid >>> 16 !== WORLDSWITCHER_GROUP) return false;
        const component = componentUid & 0xffff;
        const op = option === "Favourite" || option === "Clear" ? OP_SECOND
            : option === "Switch" ? OP_FIRST
            : event.opIndex ?? OP_FIRST;

        if (dynamic && component !== COMPONENT_WORLD_CLICKZONES) return false;
        if (component === COMPONENT_CONFIGURE) {
            // Hidden (see open): nothing to do, and nothing to tell the world.
        } else if (component === COMPONENT_CLOSE) {
            this.close();
        } else if (component === COMPONENT_LOGOUT) {
            this.dismissQuestion();
            this.host.logout();
        } else if (component >= COMPONENT_SORT_FIRST && component <= COMPONENT_SORT_LAST) {
            // The header's own script sets the sort column and builds the rows again.
            this.host.runOp(widget, OP_FIRST);
            this.save();
        } else if (component === COMPONENT_WORLD_CLICKZONES) {
            if (!dynamic) return false;
            const number = widget.childIndex ?? -1;
            this.host.playSound(SOUND_INTERFACE_CLICK);
            if (op === OP_SECOND) this.addFavourite(number);
            else this.switchTo(number);
        } else if (component === COMPONENT_FAVOURITE_1 || component === COMPONENT_FAVOURITE_2) {
            const varbit = component === COMPONENT_FAVOURITE_1 ? VARBIT_WORLDSWITCHER_FAVOURITE_1 : VARBIT_WORLDSWITCHER_FAVOURITE_2;
            this.host.playSound(SOUND_INTERFACE_CLICK);
            if (op === OP_SECOND) {
                this.missing[component === COMPONENT_FAVOURITE_1 ? 0 : 1] = false;
                this.host.setVarbit(varbit, 0);
                this.save();
            } else {
                this.switchTo(this.host.getVarbit(varbit));
            }
        } else {
            return false;
        }
        return true;
    }

    private switchTo(number: number): void {
        const { worlds, current } = this.worlds();
        const world = worlds.find((candidate) => candidate.id === number);
        // The world we are on and a number the list no longer has: nothing, as on their rows.
        if (!world || world.index < 0 || number === current) return;
        this.host.switchToServer(world.index, false);
    }

    /**
     * "Are you sure you want to switch to world N?", as OSRS asks in the chatbox. Yes hops to the
     * server it named, wherever the list has it by then; "Yes, and don't ask again" also turns
     * the question off, as All Settings' "World Switcher confirmation" does.
     */
    confirm(server: ServerListEntry): void {
        const { worlds } = this.worlds();
        const number = worlds.find((world) => world.index >= 0 && this.host.servers()[world.index] === server)?.id;
        const world = `world ${number ?? server.name}`;
        this.host.askInChatbox(
            // A world that did not answer can still be chosen, as it always could: the question says so.
            server.playerCount === null ? `World ${number ?? server.name} is not answering. Switch to it anyway?` : `Are you sure you want to switch to ${world}?`,
            CONFIRM_OPTIONS,
            (option) => {
                const asked = this.asking;
                this.dismissQuestion();
                const answer = CONFIRM_OPTIONS[option];
                if (!asked || (answer !== CONFIRM_YES && answer !== CONFIRM_YES_ALWAYS)) return;
                const hop = () => {
                    const index = this.host.servers().findIndex((candidate) => candidate === asked ||
                        (candidate.name === asked.name && candidate.address === asked.address &&
                            candidate.worldId === asked.worldId && candidate.signalUrl === asked.signalUrl));
                    if (index >= 0) this.host.switchToServer(index, true);
                };
                // The hop's logout waits for the world to have kept the setting.
                if (answer === CONFIRM_YES_ALWAYS) void Promise.resolve(this.host.stopConfirming()).then(hop);
                else hop();
            },
        );
        // After it is shown: showing it takes the place of whatever was asked before.
        this.asking = server;
    }

    /** Whether the switch question is in the chatbox. */
    isAsking(): boolean {
        return this.asking !== undefined;
    }

    /** Take the question away unanswered (the switcher closed, the player walked off or logged out). */
    dismissQuestion(): void {
        if (!this.asking) return;
        this.asking = undefined;
        this.host.closeChatboxQuestion();
    }

    /** Something else took the chatbox: the question is gone, and nothing is to be closed. */
    questionReplaced(): void {
        this.asking = undefined;
    }

    private addFavourite(number: number): void {
        const host = this.host;
        if (!this.worlds().worlds.some((world) => world.id === number)) return;
        const first = host.getVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_1);
        const second = host.getVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_2);
        if (number === first || number === second) return;
        // A slot showing none is free, also when it is remembering a world the list lacks just now.
        if (first <= 0) {
            this.missing[0] = false;
            host.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_1, number);
        } else if (second <= 0) {
            this.missing[1] = false;
            host.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_2, number);
        } else {
            // Both taken: the older one makes way.
            host.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_1, second);
            host.setVarbit(VARBIT_WORLDSWITCHER_FAVOURITE_2, number);
        }
        this.save();
    }

    private storageKey(): string {
        return `worldSwitcher:${this.host.account().trim().toLowerCase()}`;
    }

    private saved(): Saved {
        const empty: Saved = { sort: 0, favourites: ["", ""] };
        try {
            const parsed = JSON.parse(this.host.load(this.storageKey()) ?? "null");
            if (!parsed || typeof parsed !== "object") return empty;
            const sort = Number.isInteger(parsed.sort) && parsed.sort >= 0 && parsed.sort <= SORT_MAX ? parsed.sort : 0;
            const key = (value: unknown) => (typeof value === "string" && value.length <= 400 ? value : "");
            return { sort, favourites: [key(parsed.favourites?.[0]), key(parsed.favourites?.[1])] };
        } catch {
            return empty;
        }
    }

    /** Keep the sort column and the favourites as they are now. */
    private save(): void {
        const host = this.host;
        const servers = host.servers();
        const kept = this.saved();
        const { worlds } = this.worlds();
        const keyOf = (slot: 0 | 1, varbit: number): string => {
            const number = host.getVarbit(varbit);
            if (number <= 0) return this.missing[slot] ? kept.favourites[slot] : "";
            const world = worlds.find((candidate) => candidate.id === number);
            return world && world.index >= 0 ? worldKey(servers[world.index]) : kept.favourites[slot];
        };
        const next: Saved = {
            sort: host.getVarbit(VARBIT_WORLDSWITCHER_SORT),
            favourites: [keyOf(0, VARBIT_WORLDSWITCHER_FAVOURITE_1), keyOf(1, VARBIT_WORLDSWITCHER_FAVOURITE_2)],
        };
        try {
            host.save(this.storageKey(), JSON.stringify(next));
        } catch { /* storage is off: the choices last until the page is left */ }
    }

    /** Set the scripts' varbits from what is remembered; a favourite the list lacks shows as none. */
    private applySaved(): void {
        const host = this.host;
        const kept = this.saved();
        const servers = host.servers();
        const { worlds } = this.worlds();
        const numberOf = (key: string): number => {
            if (!key) return 0;
            return worlds.find((world) => world.index >= 0 && worldKey(servers[world.index]) === key)?.id ?? 0;
        };
        const set = (varbit: number, value: number) => {
            if (host.getVarbit(varbit) !== value) host.setVarbit(varbit, value);
        };
        const numbers = [numberOf(kept.favourites[0]), numberOf(kept.favourites[1])];
        this.missing = [kept.favourites[0] !== "" && numbers[0] === 0, kept.favourites[1] !== "" && numbers[1] === 0];
        set(VARBIT_WORLDSWITCHER_SORT, kept.sort);
        set(VARBIT_WORLDSWITCHER_FAVOURITE_1, numbers[0]);
        set(VARBIT_WORLDSWITCHER_FAVOURITE_2, numbers[1]);
    }
}
