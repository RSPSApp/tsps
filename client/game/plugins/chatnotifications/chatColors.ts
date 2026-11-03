import type { Client } from "@runelite/api/Client";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import * as VarPlayerID from "@runelite/api/gameval/VarPlayerID";

/**
 * RuneLite's ChatMessageManager colours for <colNORMAL> and <colHIGHLIGHT>, with RuneLite's
 * default ChatColorConfig (no RuneLite chat colour settings exist here). NORMAL is the game's
 * own chat colour setting when one is set, else JagexColors' default for the chatbox's
 * opacity; chat types without a NORMAL colour close the tag instead.
 */

// RuneLite's ChatMessageType ids.
const MODCHAT = 1;
const PUBLICCHAT = 2;
const PRIVATECHAT = 3;
const LOGINLOGOUTNOTIFICATION = 5;
const PRIVATECHATOUT = 6;
const MODPRIVATECHAT = 7;
const FRIENDSCHAT = 9;
const FRIENDSCHATNOTIFICATION = 11;
const BROADCAST = 14;
const ITEM_EXAMINE = 27;
const NPC_EXAMINE = 28;
const OBJECT_EXAMINE = 29;
const CLAN_CHAT = 41;
const CLAN_MESSAGE = 43;
const CLAN_GUEST_CHAT = 44;
const CLAN_GUEST_MESSAGE = 46;
const AUTOTYPER = 90;
const MODAUTOTYPER = 91;
const CONSOLE = 99;
const TRADEREQ = 101;
const CHALREQ_TRADE = 103;
const CHALREQ_FRIENDSCHAT = 104;
const CHALREQ_CLANCHAT = 110;

/** JagexColors, [opaque, transparent]. */
const PUBLIC_TEXT = [0x0000ff, 0x9090ff];
const PRIVATE_MESSAGE_TEXT = [0x7f0000, 0xbf2020];
const FC_TEXT = [0x7f0000, 0xef5050];
const GAME_EXAMINE_TEXT = [0x000000, 0xffffff];

/** ChatMessageManager.getDefaultColor. */
function defaultColor(type: number): number[] | undefined {
    switch (type) {
        case PUBLICCHAT: case MODCHAT:
            return PUBLIC_TEXT;
        case PRIVATECHATOUT: case MODPRIVATECHAT: case PRIVATECHAT:
            return PRIVATE_MESSAGE_TEXT;
        case FRIENDSCHAT: case CLAN_CHAT: case CLAN_GUEST_CHAT:
            return FC_TEXT;
        case ITEM_EXAMINE: case OBJECT_EXAMINE: case NPC_EXAMINE: case CONSOLE:
        case FRIENDSCHATNOTIFICATION: case CLAN_MESSAGE: case CLAN_GUEST_MESSAGE:
            return GAME_EXAMINE_TEXT;
    }
    return undefined;
}

/** ChatMessageManager.getSettingsColor: the in-game chat colour varp, [opaque, transparent]. */
function settingsColor(type: number): number[] | undefined {
    switch (type) {
        case PUBLICCHAT: case MODCHAT:
            return [VarPlayerID.OPTION_CHAT_COLOUR_PUBLIC_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_PUBLIC_TRANSPARENT];
        case PRIVATECHATOUT: case MODPRIVATECHAT: case PRIVATECHAT: case LOGINLOGOUTNOTIFICATION:
            return [VarPlayerID.OPTION_CHAT_COLOUR_PRIVATE_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_PRIVATE_TRANSPARENT];
        case AUTOTYPER: case MODAUTOTYPER:
            return [VarPlayerID.OPTION_CHAT_COLOUR_AUTOCHAT_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_AUTOCHAT_TRANSPARENT];
        case BROADCAST:
            return [VarPlayerID.OPTION_CHAT_COLOUR_BROADCAST_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_BROADCAST_TRANSPARENT];
        case FRIENDSCHAT:
            return [VarPlayerID.OPTION_CHAT_COLOUR_FRIENDSCHAT_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_FRIENDSCHAT_TRANSPARENT];
        case CLAN_CHAT:
            return [VarPlayerID.OPTION_CHAT_COLOUR_CLANCHAT_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_CLANCHAT_TRANSPARENT];
        case TRADEREQ:
            return [VarPlayerID.OPTION_CHAT_COLOUR_TRADEREQ_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_TRADEREQ_TRANSPARENT];
        case CHALREQ_TRADE: case CHALREQ_FRIENDSCHAT: case CHALREQ_CLANCHAT:
            return [VarPlayerID.OPTION_CHAT_COLOUR_CHALLENGEREQ_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_CHALLENGEREQ_TRANSPARENT];
        case CLAN_GUEST_CHAT:
            return [VarPlayerID.OPTION_CHAT_COLOUR_GUESTCLAN_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_GUESTCLAN_TRANSPARENT];
        case CLAN_MESSAGE:
            return [VarPlayerID.OPTION_CHAT_COLOUR_CLANBROADCAST_OPAQUE, VarPlayerID.OPTION_CHAT_COLOUR_CLANBROADCAST_TRANSPARENT];
    }
    return undefined;
}

/** ChatColorConfig's default *Highlight colours, [opaque, transparent]; the game message ones otherwise. */
function highlightColor(type: number): number[] {
    switch (type) {
        case PUBLICCHAT: case MODCHAT:
        case FRIENDSCHAT: case CLAN_CHAT: case CLAN_GUEST_CHAT:
            return [0x000000, 0xffffff];
        case PRIVATECHAT: case MODPRIVATECHAT:
            return [0x002783, 0xffffff];
    }
    return [0xef1020, 0xef1020];
}

function tag(rgb: number): string {
    return `<col=${(rgb & 0xffffff).toString(16).padStart(6, "0")}>`;
}

/** RuneLite: transparent when resized with the chatbox transparency setting on. */
function isTransparent(client: Client): boolean {
    return client.isResized() && client.getVarbitValue(VarbitID.CHATBOX_TRANSPARENCY) === 1;
}

/** The tag a highlight opens with (RuneLite's <colHIGHLIGHT>). */
export function highlightTag(client: Client, type: number): string {
    return tag(highlightColor(type)[isTransparent(client) ? 1 : 0]);
}

/** The tag that returns to the line's colour (RuneLite's <colNORMAL>). */
export function normalTag(client: Client, type: number): string {
    const transparent = isTransparent(client) ? 1 : 0;
    const varp = settingsColor(type)?.[transparent];
    // The game stores a chosen colour as rgb + 1; 0 means unset.
    const setting = varp === undefined ? 0 : client.getVarpValue(varp);
    if (setting !== 0) return tag(setting - 1);
    const color = defaultColor(type);
    return color ? tag(color[transparent]) : "</col>";
}
