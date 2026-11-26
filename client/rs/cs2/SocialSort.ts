/**
 * Ordering of the friend list, the ignore list and the friends chat member list.
 *
 * OSRS scripts build an ordering one rule at a time (friend_sort_*, ignore_sort_*,
 * friendschat_sort_*) and then run a "sort" instruction. Each rule decides a pair or hands it to
 * the rule added after it; a pair no rule decides keeps its place. The rules that compare names
 * or the order of world changes always decide, so nothing can be chained after them.
 */

/** The world this client reports as its own (map_world). */
export const LOCAL_WORLD = 301;

const NAME_MAX_LENGTH = 12;
const isNameSeparator = (ch: string) => ch === " " || ch === "_" || ch === "-" || ch === " ";

const NAME_LETTERS = new Map<string, string>();
function fold(letters: string, plain: string): void {
    for (const letter of letters) NAME_LETTERS.set(letter, plain);
}
fold("ÀÁÂÃÄàáâãä", "a");
fold("Çç", "c");
fold("ÈÉÊËèéêë", "e");
fold("ÍÎÏíîï", "i");
fold("Ññ", "n");
fold("ÒÓÔÕÖòóôõö", "o");
fold("ÙÚÛÜùúûü", "u");
fold("ß", "b");
fold("ÿŸ", "y");
fold(" _- ", "_");

/**
 * A player name in the form OSRS compares names in: outer spaces removed, lower case, accents
 * dropped, and space, hyphen and underscore all read as underscore. Null when it cannot be a
 * name (empty or longer than 12 characters).
 */
export function cleanPlayerName(name: string | null | undefined): string | null {
    if (name == null) return null;
    let start = 0;
    let end = name.length;
    while (start < end && isNameSeparator(name[start])) start++;
    while (end > start && isNameSeparator(name[end - 1])) end--;
    const length = end - start;
    if (length < 1 || length > NAME_MAX_LENGTH) return null;
    let out = "";
    for (let i = start; i < end; i++) {
        const ch = name[i];
        const mapped = NAME_LETTERS.get(ch);
        if (mapped !== undefined) out += mapped;
        else if (/[0-9A-Za-z]/.test(ch)) out += ch.toLowerCase();
        // Any other character is not part of a name and is dropped.
    }
    return out.length === 0 ? null : out;
}

/** Removes a leading rank icon tag (`<img=N>`) from a name as chat shows it. */
export function stripNameIcon(name: string): string {
    const match = /^<img=\d+>/.exec(name);
    return match ? name.substring(match[0].length) : name;
}

/** True when both are the same player name once cleaned. Names that cannot be cleaned match nothing. */
export function samePlayerName(a: string | null | undefined, b: string | null | undefined): boolean {
    const cleanA = cleanPlayerName(a);
    return cleanA !== null && cleanA === cleanPlayerName(b);
}

const cleanNameSets = new WeakMap<object, { size: number; names: Set<string> }>();

/**
 * Whether a list holds a player, by clean name with any leading rank icon ignored. The set of
 * clean names is kept per list array, and every list update from the server is a new array.
 */
export function listHasPlayer(list: readonly { name: string }[] | undefined, name: string | null | undefined): boolean {
    if (!list || list.length === 0 || !name) return false;
    const clean = cleanPlayerName(stripNameIcon(name));
    if (clean === null) return false;
    let cached = cleanNameSets.get(list);
    if (!cached || cached.size !== list.length) {
        const names = new Set<string>();
        for (const entry of list) {
            const entryName = cleanPlayerName(entry.name);
            if (entryName !== null) names.add(entryName);
        }
        cached = { size: list.length, names };
        cleanNameSets.set(list, cached);
    }
    return cached.names.has(clean);
}

/** Clean names in code-unit order, names that cannot be cleaned last. */
function compareCleanNames(a: string | null, b: string | null): number {
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
}

export type SocialSortRule =
    /** The list's own order (see SocialSortList.natural). Always decides. */
    | "natural"
    /** By clean name. Always decides. */
    | "name"
    /** By world number. */
    | "world"
    /** By when the entry last changed world. Always decides. */
    | "worldChange"
    /** Entries that are online on one side. */
    | "online"
    /** By clean name, between two online entries. */
    | "onlineName"
    /** By last world change, between two online entries. */
    | "onlineWorldChange"
    /** Entries on this client's world on one side. */
    | "sameWorld"
    /** By clean name, between two entries on this client's world. */
    | "sameWorldName"
    /** By last world change, between two entries on this client's world. */
    | "sameWorldChange"
    /** By rank. */
    | "rank";

const ALWAYS_DECIDES = new Set<SocialSortRule>(["natural", "name", "worldChange"]);

interface SortEntry {
    name: string;
    world?: number;
    rank?: number;
    isOnline?: boolean;
}

interface Tracked {
    world: number;
    rank: number;
    /** Grows with every world change this client saw; negative for an entry first seen offline. */
    changeOrder: number;
    /** Position the entry first arrived at. */
    arrival: number;
}

export class SocialSortList<T extends SortEntry> {
    private rules: { rule: SocialSortRule; flag: boolean }[] = [];
    private tracked = new Map<string, Tracked>();
    private nextChangeOrder = 0;
    private nextArrival = 0;
    private sorted = false;

    /**
     * @param kind friends order themselves (same world, then online, then world change order)
     * when no rule is set, ignores keep arrival order, friends chat members go by name.
     */
    constructor(
        private readonly kind: "friends" | "ignores" | "friendsChat",
        public localWorld: number = LOCAL_WORLD,
    ) {}

    /** Forgets the rules, as the *_sort_clear instructions do. */
    clearRules(): void {
        this.rules = [];
    }

    /** Forgets everything, for a list that went away (left the friends chat, logged out). */
    reset(): void {
        this.rules = [];
        this.tracked.clear();
        this.nextChangeOrder = 0;
        this.nextArrival = 0;
        this.sorted = false;
    }

    /**
     * Adds a rule after the ones already set. The flag picks the direction; for the name, world
     * and rank rules true is ascending, for the online and same-world rules true puts those
     * entries first.
     */
    addRule(rule: SocialSortRule, flag: boolean): void {
        // A rule that always decides never hands a pair on, so nothing is chained behind it.
        if (this.rules.some((existing) => ALWAYS_DECIDES.has(existing.rule))) return;
        this.rules.push({ rule, flag });
    }

    /** The world an entry counts as being on: 0 while offline. */
    private worldOf(entry: T): number {
        if (entry.isOnline === false) return 0;
        return (entry.world ?? 0) | 0;
    }

    private key(entry: T): string {
        return cleanPlayerName(entry.name) ?? entry.name;
    }

    private track(entry: T): Tracked {
        return this.tracked.get(this.key(entry)) ?? { world: 0, rank: 0, changeOrder: 0, arrival: 0 };
    }

    /**
     * Notes a fresh list from the server: who arrived and who changed world since the last one.
     * Friends and friends chat members are then put in order again, as OSRS does after every
     * update; the ignore list is only re-ordered once a script has sorted it, because a fresh
     * list replaces the order the script left.
     */
    update(list: T[]): T[] {
        const seen = new Map<string, Tracked>();
        for (const entry of list) {
            const key = this.key(entry);
            const world = this.worldOf(entry);
            const rank = (entry.rank ?? 0) | 0;
            let tracked = this.tracked.get(key);
            if (!tracked) {
                tracked = { world, rank, changeOrder: this.nextChangeOrder++, arrival: this.nextArrival++ };
                // A friend first seen offline sorts behind those who have been online.
                if (this.kind === "friends" && world === 0) tracked.changeOrder = -tracked.changeOrder;
            } else if (
                tracked.world !== world ||
                (this.kind === "friendsChat" && tracked.rank !== rank)
            ) {
                tracked.world = world;
                tracked.rank = rank;
                tracked.changeOrder = this.nextChangeOrder++;
            } else {
                tracked.rank = rank;
            }
            seen.set(key, tracked);
        }
        this.tracked = seen;
        if (this.kind !== "ignores" || this.sorted) this.applyOrder(list);
        return list;
    }

    /** Orders the list in place by the rules set, as the *_sort instructions do. */
    sort(list: T[]): T[] {
        this.sorted = true;
        return this.applyOrder(list);
    }

    private applyOrder(list: T[]): T[] {
        return list.sort((a, b) => (this.rules.length === 0 ? this.natural(a, b) : this.compare(a, b, 0)));
    }

    private natural(a: T, b: T): number {
        if (this.kind === "ignores") return this.track(a).arrival - this.track(b).arrival;
        if (this.kind === "friendsChat") {
            return compareCleanNames(cleanPlayerName(a.name), cleanPlayerName(b.name));
        }
        const worldA = this.worldOf(a);
        const worldB = this.worldOf(b);
        const local = this.localWorld;
        if (worldA === local && worldB !== local) return -1;
        if (worldB === local && worldA !== local) return 1;
        if (worldA !== 0 && worldB === 0) return -1;
        if (worldB !== 0 && worldA === 0) return 1;
        const changeA = this.track(a).changeOrder;
        const changeB = this.track(b).changeOrder;
        return worldA !== 0 ? changeA - changeB : changeB - changeA;
    }

    private compare(a: T, b: T, index: number): number {
        if (index >= this.rules.length) return 0;
        const { rule, flag } = this.rules[index];
        const next = () => this.compare(a, b, index + 1);
        const worldA = this.worldOf(a);
        const worldB = this.worldOf(b);
        const local = this.localWorld;
        const byName = () => {
            const order = compareCleanNames(cleanPlayerName(a.name), cleanPlayerName(b.name));
            return flag ? order : -order;
        };
        const byChange = () => {
            const order = this.track(a).changeOrder - this.track(b).changeOrder;
            return flag ? order : -order;
        };
        switch (rule) {
            case "natural": {
                const order = this.natural(a, b);
                return flag ? order : -order;
            }
            case "name":
                return byName();
            case "worldChange":
                return byChange();
            case "world":
                if (worldA === worldB) return next();
                return flag ? worldA - worldB : worldB - worldA;
            case "rank": {
                const rankA = (a.rank ?? 0) | 0;
                const rankB = (b.rank ?? 0) | 0;
                if (rankA === rankB) return next();
                return flag ? rankA - rankB : rankB - rankA;
            }
            case "online":
                if (worldA !== 0 && worldB === 0) return flag ? -1 : 1;
                if (worldA === 0 && worldB !== 0) return flag ? 1 : -1;
                return next();
            case "sameWorld":
                if (worldA === local && worldB !== local) return flag ? -1 : 1;
                if (worldA !== local && worldB === local) return flag ? 1 : -1;
                return next();
            case "onlineName":
                return worldA !== 0 && worldB !== 0 ? byName() : next();
            case "onlineWorldChange":
                return worldA !== 0 && worldB !== 0 ? byChange() : next();
            case "sameWorldName":
                return worldA === local && worldB === local ? byName() : next();
            case "sameWorldChange":
                return worldA === local && worldB === local ? byChange() : next();
        }
    }
}

interface FriendLike extends SortEntry {
    world: number;
    rank: number;
    isOnline: boolean;
}

/** The client's three social lists. */
export const socialSort = {
    friends: new SocialSortList<FriendLike>("friends"),
    ignores: new SocialSortList<SortEntry>("ignores"),
    friendsChat: new SocialSortList<SortEntry>("friendsChat"),
};

/**
 * A fresh set of lists from the server, put in the order the scripts last asked for. Leaving the
 * friends chat (no members list) forgets that list's rules.
 */
export function orderSocialSnapshot<F extends FriendLike, I extends SortEntry, M extends SortEntry>(
    friends: F[],
    ignores: I[],
    members: M[] | null,
): { friends: F[]; ignores: I[]; members: M[] } {
    socialSort.friends.update(friends);
    socialSort.ignores.update(ignores);
    if (members) socialSort.friendsChat.update(members);
    else socialSort.friendsChat.reset();
    return { friends, ignores, members: members ?? [] };
}
