import {
    ACCOUNT_NAME_PATTERN,
    MAX_ACCOUNT_NAME_LENGTH,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
} from "../../common/authentication";
import {
    getBrowserHostWorldConfig,
    getConfiguredDefaultServer,
    getConfiguredServers,
    getDefaultServerAddress,
    getDefaultServerName,
    getDefaultServerSecure,
    isMapEditorUrl,
} from "../../config/clientEnv";
import { isIosStandalonePwa } from "../../common/utils/DeviceUtil";
import {
    getClientPreference,
    setClientPreference,
    updateClientPreferences,
    type RememberedLoginPreference,
} from "../preferences/ClientPreferences";
import { readLocalStorageJson, removeLocalStorageItem } from "../../common/utils/localStorage";
import { LoginIndex } from "./GameState";

const STORAGE_KEY_IOS_PWA_LOGIN_STATE = "osrs:iosPwaLoginState";
const IOS_PWA_LOGIN_STATE_VERSION = 2;

/** Where the removed Remember Login plugin kept the username and plain password. */
const LEGACY_REMEMBER_LOGIN_KEY = "osrs.plugin.remember_login.v1";

type PersistedIosPwaLoginState = {
    version: number;
    username: string;
    rememberUsername: boolean;
    isUsernameHidden: boolean;
};

function isLocalOnlyServerAddress(address: string): boolean {
    const normalized = address.trim().toLowerCase();
    return (
        normalized === "localhost" ||
        normalized.startsWith("localhost:") ||
        normalized === "127.0.0.1" ||
        normalized.startsWith("127.0.0.1:") ||
        normalized === "[::1]" ||
        normalized.startsWith("[::1]:") ||
        normalized === "::1"
    );
}

function serverAddressAuthority(address: string): string {
    return address.trim().toLowerCase().split(/[/?#]/, 1)[0] ?? "";
}

function serverAddressHasRootPath(address: string): boolean {
    const path = address.trim().match(/^[^/?#]+([^?#]*)/)?.[1];
    return !path || path === "/";
}

function isLegacyBareServerAddress(address: string): boolean {
    return /^[^/?#]+\/?$/.test(address.trim());
}

function isPageRunningLocally(): boolean {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/**
 * Login state instance class.
 * Holds all mutable state for the login screen.
 */
export class LoginState {
    constructor() {
        this.serverName = getDefaultServerName();
        // Load persisted settings from localStorage
        this.loadPersistedSettings();
        this.loadPersistedLoginState();
        this.restoreLegacyRememberedPassword();
        this.showRememberedLogin();
    }

    /** Load settings that should persist between sessions */
    private loadPersistedSettings(): void {
        this.titleMusicDisabled = getClientPreference("titleMusicDisabled");
        const browserHostWorld = getBrowserHostWorldConfig();
        if (browserHostWorld) {
            this.serverName = "Browser World";
            this.serverAddress = new URL(browserHostWorld.signalUrl).host;
            this.serverSecure = true;
            this.serverTransport = "webrtc";
            this.serverSignalUrl = browserHostWorld.signalUrl;
            this.serverWorldId = browserHostWorld.worldId;
            this.serverIceServers = browserHostWorld.iceServers;
            return;
        }
        let lastServer = getClientPreference("lastServer");
        if (!lastServer) return;

        // A saved "localhost" target is only valid when the page itself is local.
        // Otherwise remote clients (e.g. iPhone on xrsps.online) dial ws://localhost and fail.
        if (isLocalOnlyServerAddress(lastServer.address) && !isPageRunningLocally()) {
            updateClientPreferences({ lastServer: undefined });
            return;
        }

        const configuredDefault = getConfiguredDefaultServer();
        if (
            configuredDefault &&
            lastServer.transport !== "webrtc" &&
            lastServer.name === configuredDefault.name &&
            lastServer.secure === configuredDefault.secure &&
            isLegacyBareServerAddress(lastServer.address) &&
            !serverAddressHasRootPath(configuredDefault.address) &&
            serverAddressAuthority(lastServer.address) === serverAddressAuthority(configuredDefault.address) &&
            lastServer.address !== configuredDefault.address
        ) {
            const previousAddress = lastServer.address;
            const rememberedLogins = getClientPreference("rememberedLogins");
            const rememberedLogin = rememberedLogins[previousAddress];
            lastServer = { ...lastServer, address: configuredDefault.address };
            if (rememberedLogin && !rememberedLogins[configuredDefault.address]) {
                const migratedLogins = {
                    ...rememberedLogins,
                    [configuredDefault.address]: rememberedLogin,
                };
                delete migratedLogins[previousAddress];
                updateClientPreferences({ lastServer, rememberedLogins: migratedLogins });
            } else {
                updateClientPreferences({ lastServer });
            }
        }

        // A saved local server from another dev runner must not override this
        // runner's explicit server list. Remote and browser-host choices stay valid.
        const configured = process.env.NODE_ENV === "development" ? getConfiguredServers() : undefined;
        if (
            isPageRunningLocally() &&
            isLocalOnlyServerAddress(lastServer.address) &&
            lastServer.transport !== "webrtc" &&
            configured?.length &&
            !configured.some((server) => server.address === lastServer.address)
        ) {
            updateClientPreferences({ lastServer: undefined });
            return;
        }

        this.serverName = lastServer.name;
        this.serverAddress = lastServer.address;
        this.serverSecure = lastServer.secure;
        this.serverTransport = lastServer.transport ?? "websocket";
        this.serverSignalUrl = lastServer.signalUrl;
        this.serverWorldId = lastServer.worldId;
        this.serverIceServers = lastServer.iceServers ?? [];
    }

    /** Save title music disabled setting to localStorage */
    saveTitleMusicSetting(): void {
        setClientPreference("titleMusicDisabled", this.titleMusicDisabled);
    }

    private supportsPersistedLoginState(): boolean {
        return (
            isIosStandalonePwa() &&
            typeof window !== "undefined" &&
            typeof window.localStorage !== "undefined"
        );
    }

    private loadPersistedLoginState(): void {
        if (!this.supportsPersistedLoginState()) {
            return;
        }

        try {
            const raw = window.localStorage.getItem(STORAGE_KEY_IOS_PWA_LOGIN_STATE);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw) as Partial<PersistedIosPwaLoginState>;
            if (parsed.version !== IOS_PWA_LOGIN_STATE_VERSION) {
                // Clear version 1 data, which included a plaintext password.
                window.localStorage.removeItem(STORAGE_KEY_IOS_PWA_LOGIN_STATE);
                return;
            }

            if (typeof parsed.rememberUsername === "boolean") {
                this.rememberUsername = parsed.rememberUsername;
            }
            if (typeof parsed.isUsernameHidden === "boolean") {
                this.isUsernameHidden = parsed.isUsernameHidden;
            }

            if (!this.rememberUsername) {
                this.username = "";
                this.password = "";
                return;
            }

            if (typeof parsed.username === "string") {
                this.username = parsed.username.slice(0, 320);
            }

            if (this.username.length > 0) {
                this.loginIndex = LoginIndex.LOGIN_FORM;
                this.currentLoginField = this.username.length > 0 ? 1 : 0;
                this.setResponse("", "Enter your username & password.", "", "");
            }
        } catch {
            // localStorage unavailable or corrupted
        }
    }

    savePersistedLoginState(): void {
        if (!this.supportsPersistedLoginState()) {
            return;
        }

        try {
            const payload: PersistedIosPwaLoginState = {
                version: IOS_PWA_LOGIN_STATE_VERSION,
                username: this.rememberUsername ? this.username.slice(0, 320) : "",
                rememberUsername: this.rememberUsername,
                isUsernameHidden: this.isUsernameHidden,
            };
            window.localStorage.setItem(STORAGE_KEY_IOS_PWA_LOGIN_STATE, JSON.stringify(payload));
        } catch {
            // localStorage unavailable
        }
    }
    // ========== UI Dialog State ==========

    /** Current login screen index (which dialog to show) */
    loginIndex: LoginIndex = LoginIndex.WELCOME;

    // ========== Network Protocol State ==========

    /** Network handshake state (0-22, matches reference loginState) */
    networkState: number = 0;

    // ========== Credentials ==========

    /** Player account name input */
    private usernameValue = "";
    readonly usernameChangedListeners = new Set<() => void>();
    get username(): string { return this.usernameValue; }
    set username(value: string) {
        if (this.usernameValue === value) return;
        this.usernameValue = value;
        for (const listener of this.usernameChangedListeners) listener();
    }

    /** Password input */
    password: string = "";

    /** Authenticator OTP code */
    otp: string = "";

    /** Display name (for Jagex accounts) */
    displayName: string = "";

    // ========== Response Messages ==========

    /** Response line 0 (title/header) */
    response0: string = "";

    /** Response line 1 */
    response1: string = "";

    /** Response line 2 */
    response2: string = "";

    /** Response line 3 */
    response3: string = "";

    // ========== UI State ==========

    /** Current focused login field (0=username, 1=password) */
    currentLoginField: number = 0;

    /** Remember username checkbox state */
    rememberUsername: boolean = true;

    /** Remember username checkbox hover state */
    rememberUsernameHover: boolean = false;

    /** The current login attempt uses the remembered token instead of a password. */
    loginWithToken: boolean = false;

    /** Hide username checkbox state */
    isUsernameHidden: boolean = false;

    /** Hide username checkbox hover state */
    hideUsernameHover: boolean = false;

    /** Trust this computer checkbox state (authenticator) */
    trustComputer: boolean = false;

    /** Trust checkbox hover state */
    trustComputerHover: boolean = false;

    /** Ban type (-1 = not banned) */
    banType: number = -1;

    /** Login field type (1=normal, 2=having trouble) */
    loginFieldType: number = 1;

    // ========== Date of Birth ==========

    /** DOB input fields (8 digits: DD/MM/YYYY) */
    dobFields: (string | null)[] = new Array(8).fill(null);

    /** Current DOB field index */
    dobFieldIndex: number = 0;

    /** DOB entry available (desktop only) */
    dobEntryAvailable: boolean = true;

    // ========== Server List ==========

    /** Server list overlay open */
    serverListOpen: boolean = false;

    /** Currently hovered server index (-1 = none) */
    hoveredServerIndex: number = -1;

    /** Current server address displayed on the button */
    serverAddress: string = getDefaultServerAddress();

    /** Current server name displayed on the button, and in the page title */
    private currentServerName = "";
    get serverName(): string {
        return this.currentServerName;
    }
    set serverName(name: string) {
        this.currentServerName = name;
        // Edit mode keeps its own title (OsrsClient sets it).
        if (typeof document === "undefined" || isMapEditorUrl()) return;
        document.title = name.trim() ? `${name.trim()} - RSPS.app` : "RSPS.app";
    }

    /** Whether the current server uses secure WebSocket */
    serverSecure: boolean = getDefaultServerSecure();

    serverTransport: "websocket" | "webrtc" = "websocket";
    serverSignalUrl?: string;
    serverWorldId?: string;
    serverIceServers: RTCIceServer[] = [];

    /** Persist the last selected server to localStorage */
    // ========== Remembered login ==========

    /** A token only works on the server that issued it, so each server keeps its own. */
    private get rememberedLoginKey(): string {
        return this.serverTransport === "webrtc"
            ? `webrtc:${this.serverWorldId ?? ""}@${this.serverSignalUrl ?? ""}`
            : this.serverAddress;
    }

    getRememberedLogin(): RememberedLoginPreference | undefined {
        return getClientPreference("rememberedLogins")[this.rememberedLoginKey];
    }

    rememberLogin(username: string, token: string): void {
        updateClientPreferences({
            rememberedLogins: {
                ...getClientPreference("rememberedLogins"),
                [this.rememberedLoginKey]: { username, token },
            },
        });
    }

    forgetRememberedLogin(): void {
        const logins = { ...getClientPreference("rememberedLogins") };
        if (!(this.rememberedLoginKey in logins)) return;
        delete logins[this.rememberedLoginKey];
        updateClientPreferences({ rememberedLogins: logins });
    }

    /**
     * The Play screen for the account kept signed in on this server, in place of the welcome
     * screen or an untouched login form; back to the welcome screen when there is none.
     */
    showRememberedLogin(): void {
        const remembered = this.getRememberedLogin();
        const replaceable =
            this.loginIndex === LoginIndex.WELCOME ||
            this.loginIndex === LoginIndex.WELCOME_DISPLAY_NAME ||
            (this.loginIndex === LoginIndex.LOGIN_FORM && this.password.length === 0);
        if (remembered && replaceable) {
            this.loginIndex = LoginIndex.WELCOME_DISPLAY_NAME;
            this.displayName = remembered.username;
        } else if (!remembered && this.loginIndex === LoginIndex.WELCOME_DISPLAY_NAME) {
            this.loginIndex = LoginIndex.WELCOME;
            this.displayName = "";
        }
    }

    /**
     * Fills in the password the removed Remember Login plugin kept, ticking "Remember username"
     * so the next login swaps it for a token. clearLegacyRememberedPassword deletes it then.
     */
    private restoreLegacyRememberedPassword(): void {
        if (this.getRememberedLogin()) return;
        const legacy = readLocalStorageJson<{ enabled?: unknown; username?: unknown; password?: unknown }>(
            LEGACY_REMEMBER_LOGIN_KEY,
        );
        if (legacy?.enabled !== true) return;
        if (typeof legacy.username !== "string" || typeof legacy.password !== "string") return;
        if (!legacy.username || !legacy.password) return;
        this.username = legacy.username.slice(0, MAX_ACCOUNT_NAME_LENGTH);
        this.password = legacy.password.slice(0, MAX_PASSWORD_LENGTH);
        this.currentLoginField = 1;
        this.rememberUsername = true;
    }

    clearLegacyRememberedPassword(): void {
        removeLocalStorageItem(LEGACY_REMEMBER_LOGIN_KEY);
    }

    saveLastServer(): void {
        if (getBrowserHostWorldConfig()) return;
        setClientPreference("lastServer", {
            name: this.serverName,
            address: this.serverAddress,
            secure: this.serverSecure,
            transport: this.serverTransport,
            signalUrl: this.serverSignalUrl,
            worldId: this.serverWorldId,
            iceServers: this.serverIceServers,
        });
    }

    // ========== World Select ==========

    /** World selection overlay open */
    worldSelectOpen: boolean = false;

    /** Hovered world ID (not index - survives re-sorting) */
    hoveredWorldId: number = -1;

    /** Current world select page */
    worldSelectPage: number = 0;

    /** Total world select pages */
    worldSelectPagesCount: number = 1;

    /** Selected world ID */
    worldId: number = 1;

    /** World request loading state */
    worldRequestLoading: boolean = false;

    // ========== Mobile World Select ==========

    /** Scroll offset for mobile world select list view (in pixels) */
    mobileWorldSelectScrollOffset: number = 0;

    /** Touch scroll velocity for momentum scrolling */
    mobileWorldSelectScrollVelocity: number = 0;

    /** Filter text for mobile world search */
    mobileWorldSelectFilter: string = "";

    /** Virtual keyboard is currently visible */
    virtualKeyboardVisible: boolean = false;

    // ========== Client Flags ==========

    /** Client language (0=EN) - world select only shows for English */
    clientLanguage: number = 0;

    /** Whether client is on mobile (affects DOB screen) */
    onMobile: boolean = false;

    /** Title music disabled */
    titleMusicDisabled: boolean = false;

    // ========== Loading State ==========

    /** Loading progress percentage (0-100) */
    loadingPercent: number = 10;

    /** Loading status text */
    loadingText: string = "";

    // ========== Download State ==========

    /** Download progress current bytes */
    downloadCurrent: number = 0;

    /** Download progress total bytes */
    downloadTotal: number = 0;

    /** Download progress label (optional custom text) */
    downloadLabel: string = "";

    // ========== Methods ==========

    /**
     * Reset all login state to defaults.
     */
    reset(): void {
        this.loginIndex = LoginIndex.WELCOME;
        this.networkState = 0;
        this.username = "";
        this.password = "";
        this.otp = "";
        this.displayName = "";
        this.response0 = "";
        this.response1 = "";
        this.response2 = "";
        this.response3 = "";
        this.currentLoginField = 0;
        this.serverListOpen = false;
        this.hoveredServerIndex = -1;
        this.worldSelectOpen = false;
        this.hoveredWorldId = -1;
        this.worldSelectPage = 0;
        this.banType = -1;
        this.dobFields = new Array(8).fill(null);
        this.dobFieldIndex = 0;
        this.trustComputer = false;
        this.trustComputerHover = false;
        this.loadingPercent = 10;
        this.loadingText = "";
        // Download state
        this.downloadCurrent = 0;
        this.downloadTotal = 0;
        this.downloadLabel = "";
        // Mobile state
        this.mobileWorldSelectScrollOffset = 0;
        this.mobileWorldSelectScrollVelocity = 0;
        this.mobileWorldSelectFilter = "";
        this.virtualKeyboardVisible = false;
        this.loginWithToken = false;
        this.loadPersistedLoginState();
        this.showRememberedLogin();
    }

    /**
     * Set response messages for display.
     */
    setResponse(r0: string, r1: string, r2: string, r3: string): void {
        this.response0 = r0;
        this.response1 = r1;
        this.response2 = r2;
        this.response3 = r3;
    }

    /**
     * Prompt for credentials - switch to login form.
     */
    promptCredentials(preserveUsername: boolean = true): void {
        this.loginIndex = LoginIndex.LOGIN_FORM;
        if (!preserveUsername) {
            this.username = "";
            this.password = "";
        }
        this.currentLoginField = this.username.length > 0 ? 1 : 0;
        this.setResponse("", "Enter your username & password.", "", "");
    }

    /**
     * Get masked password string for display.
     */
    getMaskedPassword(): string {
        return "*".repeat(this.password.length);
    }

    /**
     * Get masked OTP string for display.
     */
    getMaskedOtp(): string {
        return "*".repeat(this.otp.length);
    }

    /**
     * Check if credentials are valid for login attempt.
     */
    canAttemptLogin(): boolean {
        return this.getCredentialValidationMessage() === undefined;
    }

    /** Get the client-side validation error for the current login credentials. */
    getCredentialValidationMessage(): string | undefined {
        if (this.username.trim().length === 0) {
            return "Please enter your username.";
        }
        const accountName = this.username.trim().toLowerCase();
        if (
            accountName.length > MAX_ACCOUNT_NAME_LENGTH ||
            !ACCOUNT_NAME_PATTERN.test(accountName)
        ) {
            return `Username must be 1-${MAX_ACCOUNT_NAME_LENGTH} characters using letters, numbers, spaces, _ or -.`;
        }
        if (this.password.length === 0) {
            return "Please enter your password.";
        }
        if (this.password.length < MIN_PASSWORD_LENGTH) {
            return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        }
        if (this.password.length > MAX_PASSWORD_LENGTH) {
            return `Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`;
        }
        return undefined;
    }

    /** Show the current credential validation error on the login form. */
    showCredentialValidationError(): void {
        const message = this.getCredentialValidationMessage();
        if (message) {
            this.setResponse("", message, "", "");
        }
    }
}
