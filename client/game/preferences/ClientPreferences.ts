import {
    readLocalStorageItem,
    readLocalStorageJson,
    removeLocalStorageItem,
    writeLocalStorageJson,
} from "../../common/utils/localStorage";

const PREFS_KEY = "osrs:clientPreferences";
const PREFS_VERSION = 1;

/** Legacy keys migrated into the preferences blob on first load. */
const LEGACY_TITLE_MUSIC_DISABLED = "osrs:titleMusicDisabled";
const LEGACY_LAST_SERVER = "osrs:lastServer";

export type LastServerPreference = {
    name: string;
    address: string;
    secure: boolean;
    transport?: "websocket" | "webrtc";
    signalUrl?: string;
    worldId?: string;
    iceServers?: RTCIceServer[];
};

/** An account kept signed in on one server ("Stay logged in"): a token, never the password. */
export type RememberedLoginPreference = {
    username: string;
    token: string;
};

export type ClientPreferences = {
    version: number;
    /** Login / title-screen music muted. */
    titleMusicDisabled: boolean;
    /** User dismissed the iOS “Add to Home Screen” hint. */
    iosInstallHintDismissed: boolean;
    /** User dismissed the Chrome/Android install prompt. */
    installPromptDismissed: boolean;
    /** Last selected login server. */
    lastServer?: LastServerPreference;
    /** The account kept signed in on each server, keyed by rememberedLoginKey. */
    rememberedLogins: Record<string, RememberedLoginPreference>;
    /** Settings > Controls: W/A/S/D turn the camera, Enter to chat. */
    wasdCamera: boolean;
};

const DEFAULTS: ClientPreferences = {
    version: PREFS_VERSION,
    titleMusicDisabled: false,
    iosInstallHintDismissed: false,
    installPromptDismissed: false,
    rememberedLogins: {},
    wasdCamera: false,
};

let cache: ClientPreferences | undefined;

function normalizeLastServer(
    value: Partial<LastServerPreference> | undefined,
): LastServerPreference | undefined {
    if (!value) return undefined;
    if (
        typeof value.name !== "string" ||
        typeof value.address !== "string" ||
        typeof value.secure !== "boolean"
    ) {
        return undefined;
    }
    const transport = value.transport === "webrtc" ? "webrtc" : "websocket";
    return {
        name: value.name,
        address: value.address,
        secure: value.secure,
        transport,
        signalUrl: typeof value.signalUrl === "string" ? value.signalUrl : undefined,
        worldId: typeof value.worldId === "string" ? value.worldId : undefined,
        iceServers: Array.isArray(value.iceServers) ? value.iceServers : [],
    };
}

function normalizeRememberedLogins(value: unknown): Record<string, RememberedLoginPreference> {
    const logins: Record<string, RememberedLoginPreference> = {};
    if (!value || typeof value !== "object") return logins;
    for (const [server, login] of Object.entries(value as Record<string, unknown>)) {
        const { username, token } = (login ?? {}) as Partial<RememberedLoginPreference>;
        if (typeof username === "string" && username && typeof token === "string" && token) {
            logins[server] = { username, token };
        }
    }
    return logins;
}

function normalize(raw: Partial<ClientPreferences> | undefined): ClientPreferences {
    return {
        version: PREFS_VERSION,
        titleMusicDisabled: Boolean(raw?.titleMusicDisabled ?? DEFAULTS.titleMusicDisabled),
        iosInstallHintDismissed: Boolean(
            raw?.iosInstallHintDismissed ?? DEFAULTS.iosInstallHintDismissed,
        ),
        installPromptDismissed: Boolean(
            raw?.installPromptDismissed ?? DEFAULTS.installPromptDismissed,
        ),
        lastServer: normalizeLastServer(raw?.lastServer),
        rememberedLogins: normalizeRememberedLogins(raw?.rememberedLogins),
        wasdCamera: raw?.wasdCamera === true,
    };
}

function migrateLegacyKeys(prefs: ClientPreferences): ClientPreferences {
    let next = { ...prefs };
    let changed = false;

    const legacyMusic = readLocalStorageItem(LEGACY_TITLE_MUSIC_DISABLED);
    if (legacyMusic !== undefined) {
        next.titleMusicDisabled = legacyMusic === "true";
        removeLocalStorageItem(LEGACY_TITLE_MUSIC_DISABLED);
        changed = true;
    }

    if (!next.lastServer) {
        const legacyServer = readLocalStorageJson<Partial<LastServerPreference>>(LEGACY_LAST_SERVER);
        const parsed = normalizeLastServer(legacyServer);
        if (parsed) {
            next.lastServer = parsed;
            removeLocalStorageItem(LEGACY_LAST_SERVER);
            changed = true;
        }
    }

    if (changed) {
        writeLocalStorageJson(PREFS_KEY, next);
    }
    return next;
}

/** Load preferences (cached in-memory after first read). */
export function loadClientPreferences(): ClientPreferences {
    if (cache) return cache;

    const stored = readLocalStorageJson<Partial<ClientPreferences>>(PREFS_KEY);
    const prefs = migrateLegacyKeys(normalize(stored));
    cache = prefs;
    return prefs;
}

/** Persist a partial update and refresh the in-memory cache. */
export function updateClientPreferences(
    patch: Partial<Omit<ClientPreferences, "version">>,
): ClientPreferences {
    const next = normalize({ ...loadClientPreferences(), ...patch });
    writeLocalStorageJson(PREFS_KEY, next);
    cache = next;
    return next;
}

export function getClientPreference<K extends keyof ClientPreferences>(
    key: K,
): ClientPreferences[K] {
    return loadClientPreferences()[key];
}

export function setClientPreference<K extends keyof Omit<ClientPreferences, "version">>(
    key: K,
    value: ClientPreferences[K],
): void {
    updateClientPreferences({ [key]: value } as Partial<Omit<ClientPreferences, "version">>);
}

/** Test/HMR helper — clears the in-memory cache. */
export function resetClientPreferencesCache(): void {
    cache = undefined;
}
