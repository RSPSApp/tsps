/**
 * Instructions for features this client doesn't have: Jagex platform services (CRM views,
 * marketing, Steam, federated login), hiscore lookups, entity overlays, and the client-op
 * target queries. Each pops its declared inputs and pushes a neutral result (an empty string,
 * -1 for ids, coords and handles, 0 for counts and booleans), so a script carries on instead of
 * stopping at "Unknown opcode". Signatures from zwyz/osrs-cache (data/commands).
 */
import type { HandlerMap } from "./HandlerTypes";

type Signature = [opcode: number, name: string, inputs: string[], outputs: string[]];

const SIGNATURES: Signature[] = [
    [103, "cc_create_entityoverlay", ["entityoverlay", "iftype", "int"], []],
    [104, "cc_deleteall_entityoverlay", ["entityoverlay"], []],
    [1129, "cc_sethttpsprite", ["string"], []],
    [1131, "cc_crmview_settextfont", ["int", "graphic"], []],
    [1132, "cc_crmview_setservertargets", ["string", "int"], []],
    [1151, "cc_crmview_init_v2", ["string", "string", "string"], []],
    [1152, "cc_crmview_dismiss", [], ["boolean"]],
    [1434, "cc_crmview_setonupdated", ["clientscript", "argument_list"], []],
    [1610, "cc_getblendtrans", [], ["int"]],
    [1615, "cc_getarcstart", [], ["int"]],
    [1616, "cc_getarcend", [], ["int"]],
    [1624, "cc_input_getfocus", [], ["boolean"]],
    [1628, "cc_input_getcaretposition", [], ["int"]],
    [1707, "cc_crmview_gethasresponse", [], ["boolean"]],
    [1708, "cc_crmview_getint", ["string"], ["int"]],
    [2124, "if_setblendtrans", ["int", "component"], []],
    [2125, "if_setblendmode", ["blendmode", "component"], []],
    [2624, "if_input_getfocus", ["component"], ["boolean"]],
    [3120, "setdrawplayernames_friends", ["boolean"], []],
    [3121, "setdrawplayernames_clanmates", ["boolean"], []],
    [3129, "setfreecamspeed", ["int", "int"], []],
    [3137, "setkeyinputmode_interface", ["boolean"], []],
    [3170, "notifications_sendlocal", ["string", "string", "int", "int"], ["int"]],
    [3171, "notifications_sendgroupedlocal", ["string", "string", "string", "int", "int", "int"], ["int"]],
    [3172, "notifications_cancellocal", ["int"], []],
    [3173, "notifications_islocalscheduled", ["int"], ["boolean"]],
    [6231, "sidebar_setwidth", ["int", "int"], []],
    [6232, "sidebar_clearwidth", ["int"], []],
    [6800, "loc_name", [], ["string"]],
    [3122, "setdrawplayernames_others", ["boolean"], []],
    [3124, "resetdrawplayernames", [], []],
    [3157, "shop_opencategories", ["int", "int"], []],
    [3177, "marketing_initanalytics", [], []],
    [3178, "marketing_sendanalyticsevent", ["string"], []],
    [3179, "marketing_initattribution", [], []],
    [3180, "marketing_sendattributionevent", ["string"], []],
    [3189, "seq_prefetch", ["seq"], []],
    [3329, "idletimer_reset", [], []],
    [3330, "destinationcoord", [], ["coord"]],
    [3648, "friendschat_sort_lastworldchange", ["boolean"], []],
    [3652, "friendschat_sort_online_world", ["boolean"], []],
    [3700, "steam_setachievement", ["string", "boolean", "boolean"], ["boolean"]],
    [3701, "steam_setstat", ["string", "int", "boolean"], ["boolean"]],
    [3702, "steam_storestats", [], ["boolean"]],
    [5631, "federated_login", ["string", "string"], []],
    [5632, "federated_login_state", [], ["int"]],
    [5633, "federated_shop", ["string", "string"], []],
    [6527, "platformtype", [], ["platformtype"]],
    [6750, "npc_name", [], ["string"]],
    [6751, "npc_uid", [], ["npc_uid"]],
    [6752, "npc_creationcycle", [], ["int"]],
    [6753, "npc_type", [], ["npc"]],
    [6758, "npc_finduid", ["npc_uid"], ["boolean"]],
    [6761, "nc_getopbase", ["npc", "boolean", "boolean"], ["string"]],
    [6762, "nc_getop", ["npc", "int", "boolean"], ["string"]],
    [6801, "loc_coord", [], ["coord"]],
    [6802, "loc_type", [], ["loc"]],
    [6803, "loc_find", ["coord", "loc"], ["boolean"]],
    [6806, "lc_getopbase", ["loc", "boolean"], ["string"]],
    [6807, "lc_getop", ["loc", "int", "boolean"], ["string"]],
    [6851, "obj_coord", [], ["coord"]],
    [6852, "obj_type", [], ["obj"]],
    [6854, "obj_find", ["coord", "obj"], ["boolean"]],
    [6857, "oc_getopbase", ["obj", "boolean"], ["string"]],
    [6858, "oc_getop", ["obj", "int", "boolean"], ["string"]],
    [6859, "obj_findbyindex", ["coord", "int"], ["boolean"]],
    [6860, "obj_despawntime", [], ["int"]],
    [6861, "obj_revealtime", [], ["int"]],
    [6863, "obj_owner", [], ["objowner"]],
    [6900, "p_name", [], ["string"]],
    [6902, "p_routelength", [], ["int"]],
    [6903, "p_route", ["int"], ["coord"]],
    [6904, "uid", [], ["player_uid"]],
    [6905, "self_player_uid", [], ["player_uid"]],
    [6950, "tile_coord", [], ["coord"]],
    [6951, "tile_find", ["coord"], ["boolean"]],
    [7120, "objstack_size", ["coord"], ["int"]],
    [7121, "objstack_obj", ["coord", "int"], ["obj"]],
    [7122, "objstack_count", ["coord", "int"], ["int"]],
    [7200, "entityoverlay_create_npc", ["int", "overlaytype", "int", "int", "int"], ["entityoverlay"]],
    [7201, "entityoverlay_create_loc", ["int", "overlaytype", "int", "int", "int"], ["entityoverlay"]],
    [7203, "entityoverlay_create_player", ["int", "overlaytype", "int", "int", "int"], ["entityoverlay"]],
    [7204, "entityoverlay_create_coord", ["coord", "int", "overlaytype", "int", "int", "int"], ["entityoverlay"]],
    [7206, "entityoverlay_get_loc", ["int"], ["entityoverlay"]],
    [7209, "entityoverlay_get_coord", ["coord", "int"], ["entityoverlay"]],
    [7211, "entityoverlay_delete_loc", ["int"], []],
    [7213, "entityoverlay_delete_player", ["int"], []],
    [7214, "entityoverlay_delete_coord", ["coord", "int"], []],
    [7613, "loottracker_clear", [], []],
    [7800, "hiscore_lookup", ["string", "int"], []],
    [7801, "hiscore_getrank", ["string"], ["int"]],
    [7802, "hiscore_getvalue", ["string"], ["int"]],
    [7803, "hiscore_getskillrank", ["int"], ["int"]],
    [7804, "hiscore_getgamerank", ["int"], ["int"]],
    [7805, "hiscore_getskillxp", ["int"], ["int"]],
    [7806, "hiscore_getgamecompletions", ["int"], ["int"]],
    [7807, "hiscore_getoverallrank", [], ["int"]],
    [7808, "hiscore_getoverallxp", [], ["int", "int"]],
    [7810, "hiscore_clear", [], []],
    [7811, "hiscore_geterror", [], ["string"]],
    [7812, "hiscore_setapi", ["int"], []],
    [7813, "hiscore_getbossrank", ["varp"], ["int"]],
    [7814, "hiscore_getbosskills", ["varp"], ["int"]],
    [7816, "hiscore_getgrouptotalxp", [], ["int"]],
    [7819, "hiscore_getmemberlevel", ["string"], ["int"]],
    [7820, "hiscore_getmembercontributedxp_byname", ["string"], ["int"]],
    [7823, "hiscore_getmembername", ["int"], ["string"]],
    [7824, "hiscore_getmemberhiscores", ["int"], []],
];

const ZERO_TYPES = new Set(["int", "boolean", "count"]);
const isString = (type: string) => type === "string";
const isLong = (type: string) => type === "long";
const isArray = (type: string) => type.endsWith("array"); // a stringvector is an int handle

export function registerUnsupportedOps(handlers: HandlerMap): void {
    for (const [opcode, , inputs, outputs] of SIGNATURES) {
        if (handlers.has(opcode)) continue;
        handlers.set(opcode, (ctx) => {
            for (const type of [...inputs].reverse()) {
                // A listener's arguments, as every cc_seton* takes them: the VM parses them off.
                if (type === "argument_list") (ctx.cs2Vm as any).parseTriggerArgs();
                else if (type === "clientscript") continue;
                else if (isString(type) || isArray(type)) ctx.stringStackSize--;
                else if (isLong(type)) ctx.popLong();
                else ctx.intStackSize--;
            }
            for (const type of outputs) {
                if (isString(type)) ctx.pushString("");
                else if (isArray(type)) ctx.pushString(null);
                else if (isLong(type)) ctx.pushLong(0n);
                else ctx.pushInt(ZERO_TYPES.has(type) ? 0 : -1);
            }
        });
    }
}

export const UNSUPPORTED_OPCODES = SIGNATURES.map(([opcode]) => opcode);
