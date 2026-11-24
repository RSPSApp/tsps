import { GameState } from "@runelite/api/GameState";
import { TRADEMAIN } from "@runelite/api/gameval/InterfaceID";
import { INSIDE_WILDERNESS, PVP_AREA_CLIENT } from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { toRuneLiteGameState } from "../../../runelite/impl/GameStateMapping";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetDisplayText, WidgetOverlay, WidgetTextEvent } from "../ClientPluginManager";
import { prependColorTag, stripTags } from "../npcindicators/npcMatching";
import { type HighlightSetting, PlayerIndicatorsConfig } from "./PlayerIndicatorsConfig";
import { PlayerIndicatorsOverlay } from "./PlayerIndicatorsOverlay";

/** The trade screen title's prefix; matched without case, as the title reads "Trading With: ". */
const TRADING_WITH = /^trading with: /i;

/** A highlighted player: its player store index, display name and highlight colour (0xRRGGBB). */
export type HighlightedPlayer = { index: number; name: string; color: number };
type Social = { friends: Set<string>; friendsChat: Set<string>; clan: Set<string> };

/** Names as the game compares them: no case, and underscores, hyphens and nbsp as spaces. */
export function jagexName(name: string): string {
    return stripTags(name).replace(/[  _-]/g, " ").trim().toLowerCase();
}

/**
 * RuneLite's Player Indicators. Highlights your own player, friends, friends chat members, team
 * members, clan members and everyone else, each with its own colour, by tile, by name (above the
 * head, at the model's centre or to its right) and by name on the minimap, and colours their
 * right-click menu entries and the trade screen's title.
 */
export class PlayerIndicatorsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Player Indicators",
        description: "Highlight players on-screen and/or on the minimap",
        tags: ["highlight", "minimap", "overlay", "players"],
        enabledByDefault: false,
        configKey: "playerindicatorsplugin",
    };

    static config = PlayerIndicatorsConfig;

    readonly config = inject(ConfigManager).getConfig(PlayerIndicatorsConfig);
    private readonly osrsClient: OsrsClient;
    /** The scene overlay, then the minimap overlay. */
    readonly overlays: readonly WidgetOverlay[];

    constructor(osrsClient?: OsrsClient) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.overlays = [new PlayerIndicatorsOverlay(this, false), new PlayerIndicatorsOverlay(this, true)];
    }

    widgetOverlays(): WidgetOverlay[] {
        return this.isStarted() ? [...this.overlays] : [];
    }

    getClient(): OsrsClient {
        return this.osrsClient;
    }

    isLoggedIn(): boolean {
        return toRuneLiteGameState((this.osrsClient as any)?.gameState) === GameState.LOGGED_IN;
    }

    localPlayerIndex(): number | undefined {
        const client: any = this.osrsClient;
        return client.playerEcs?.getIndexForServerId?.(client.controlledPlayerServerId);
    }

    private enabled(setting: HighlightSetting): boolean {
        if (setting === "ENABLED") return true;
        if (setting !== "PVP") return false;
        const vars: any = (this.osrsClient as any).varManager;
        return (vars?.getVarbit?.(INSIDE_WILDERNESS) | 0) === 1 || (vars?.getVarbit?.(PVP_AREA_CLIENT) | 0) === 1;
    }

    /** The friends list, friends chat members and the player's own clan, as normalised names. */
    social(): Social {
        const context: any = (this.osrsClient as any).cs2Vm?.context ?? {};
        const names = (list: { name?: string }[] | undefined) => new Set((list ?? []).map((m) => jagexName(m.name ?? "")));
        return {
            friends: names(context.friendList),
            friendsChat: names(context.clanMembers),
            clan: new Set<string>((context.clanChannel?.userNames ?? []).map(jagexName)),
        };
    }

    /**
     * RuneLite's PlayerIndicatorsService.getDecorations colour: the first group the player is in
     * whose highlight is on (own player, friend, friends chat, team, clan, others), or undefined.
     */
    colorFor(index: number, social: Social = this.social()): number | undefined {
        const players: any = (this.osrsClient as any).playerEcs;
        const name = players?.getName(index);
        if (!name) return undefined;
        const c = this.config;
        const local = this.localPlayerIndex();
        if (index === local) {
            return this.enabled(c.highlightOwnPlayer()) ? Number(c.ownPlayerColor()) & 0xffffff : undefined;
        }
        const key = jagexName(name);
        const inFriendsChat = social.friendsChat.has(key);
        const inClan = social.clan.has(key);
        const team = players.getTeam(index) | 0;
        let color: unknown;
        if (social.friends.has(key) && this.enabled(c.highlightFriends())) color = c.friendColor();
        else if (inFriendsChat && this.enabled(c.highlightFriendsChat())) color = c.friendsChatMemberColor();
        else if (team > 0 && local !== undefined && (players.getTeam(local) | 0) === team && this.enabled(c.highlightTeamMembers())) {
            color = c.teamMemberColor();
        } else if (inClan && this.enabled(c.highlightClanMembers())) color = c.clanMemberColor();
        else if (!inFriendsChat && !inClan && this.enabled(c.highlightOthers())) color = c.othersColor();
        return color === undefined ? undefined : Number(color) & 0xffffff;
    }

    /** Every highlighted player on the local player's level, outside world entities (boats). */
    highlightedPlayers(): HighlightedPlayer[] {
        if (!this.isStarted() || !this.isLoggedIn()) return [];
        const players: any = (this.osrsClient as any).playerEcs;
        const local = this.localPlayerIndex();
        if (!players || local === undefined) return [];
        const plane = players.getLevel(local) | 0;
        const out: HighlightedPlayer[] = [];
        const social = this.social();
        for (const index of players.getAllActiveIndices()) {
            if ((players.getLevel(index) | 0) !== plane || players.getIsHidden(index)) continue;
            if ((players.getWorldViewId(index) | 0) >= 0) continue;
            const color = this.colorFor(index, social);
            if (color !== undefined) out.push({ index, name: players.getName(index).replace(/ /g, " "), color });
        }
        return out;
    }

    private colorForServerId(serverId: number, social: Social): number | undefined {
        const index = (this.osrsClient as any).playerEcs?.getIndexForServerId?.(serverId);
        return index === undefined ? undefined : this.colorFor(index, social);
    }

    /** RuneLite's onClientTick menu pass: player entries take the player's colour. */
    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (!this.isStarted() || context.surface !== "world" || this.config.colorPlayerMenu() !== true) return entries;
        let out: SimpleMenuEntry[] | undefined;
        let social: Social | undefined;
        entries.forEach((entry, i) => {
            if (entry.targetType !== MenuTargetType.PLAYER || typeof entry.playerServerId !== "number") return;
            const color = this.colorForServerId(entry.playerServerId, (social ??= this.social()));
            if (color === undefined) return;
            out ??= entries.slice();
            out[i] = { ...entry, target: decorateTarget(String(entry.target ?? ""), color) };
        });
        return out ?? entries;
    }

    /** RuneLite recolours the name in the trade screen's title for a highlighted player. */
    widgetDisplayText(event: WidgetTextEvent): WidgetDisplayText | undefined {
        if (!this.isStarted() || event.groupId !== TRADEMAIN) return undefined;
        const prefix = event.text.match(TRADING_WITH)?.[0];
        if (!prefix) return undefined;
        const name = event.text.slice(prefix.length);
        const players: any = (this.osrsClient as any).playerEcs;
        const index = players?.findIndexByName?.(name);
        const color = index === undefined ? undefined : this.colorFor(index);
        if (color === undefined) return undefined;
        return { text: `${prefix}${prependColorTag(name, color)}</col>` };
    }
}

/**
 * RuneLite's decorateTarget: keeps a "<item> -> " prefix, drops the name's leading colour tag
 * and colours the rest (the name and its level) in the player's colour.
 */
export function decorateTarget(target: string, rgb: number): string {
    let prefix = "";
    let rest = target;
    const arrow = rest.indexOf("->");
    if (arrow !== -1) {
        prefix = rest.slice(0, arrow + 3);
        rest = rest.slice(arrow + 3);
    }
    if (rest.startsWith("<")) rest = rest.slice(rest.indexOf(">") + 1);
    return prefix + prependColorTag(rest, rgb);
}
