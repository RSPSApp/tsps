/**
 * ClientPacket - Re-exports shared packet definitions for client use
 *
 * All packet IDs are now defined in src/common/network/ClientPacketId.ts
 * to ensure client and server stay in sync.
 */
import { ClientPacketId } from "../../common/network/ClientPacketId";

export {
    ClientPacketId,
    CLIENT_PACKET_LENGTHS,
    getPacketLength,
    isVariableLength,
    isVariableShort,
} from "../../common/network/ClientPacketId";

/**
 * Semantic packet type aliases for clearer code
 */
export const ClientPacket = {
    // Location/Object interactions
    OPLOC1: ClientPacketId.OPLOC1,
    OPLOC2: ClientPacketId.OPLOC2,
    OPLOC3: ClientPacketId.OPLOC3,
    OPLOC4: ClientPacketId.OPLOC4,
    OPLOC5: ClientPacketId.OPLOC5,
    OPLOC_T: ClientPacketId.OPLOC_T,
    OPLOC_T_ALT: ClientPacketId.OPLOC_T_ALT,

    // NPC interactions
    OPNPC1: ClientPacketId.OPNPC1,
    OPNPC1_ALT: ClientPacketId.OPNPC1_ALT,
    OPNPC2: ClientPacketId.OPNPC2,
    OPNPC3: ClientPacketId.OPNPC3,
    OPNPC4: ClientPacketId.OPNPC4,
    OPNPC5: ClientPacketId.OPNPC5,
    OPNPC_T: ClientPacketId.OPNPC_T,
    OPNPC_U: ClientPacketId.OPNPC_U,
    EXAMINE_NPC: ClientPacketId.EXAMINE_NPC,

    // Player interactions
    OPPLAYER1: ClientPacketId.OPPLAYER1,
    OPPLAYER2: ClientPacketId.OPPLAYER2,
    OPPLAYER3: ClientPacketId.OPPLAYER3,
    OPPLAYER4: ClientPacketId.OPPLAYER4,
    OPPLAYER5: ClientPacketId.OPPLAYER5,
    OPPLAYER6: ClientPacketId.OPPLAYER6,
    OPPLAYER7: ClientPacketId.OPPLAYER7,
    OPPLAYER8: ClientPacketId.OPPLAYER8,
    OPPLAYER_T: ClientPacketId.OPPLAYER_T,
    OPPLAYER_U: ClientPacketId.OPPLAYER_U,

    // Ground item interactions
    OPOBJ1: ClientPacketId.OPOBJ1,
    OPOBJ2: ClientPacketId.OPOBJ2,
    OPOBJ3: ClientPacketId.OPOBJ3,
    OPOBJ4: ClientPacketId.OPOBJ4,
    OPOBJ5: ClientPacketId.OPOBJ5,
    OPOBJ_T: ClientPacketId.OPLOC_T_ALT,
    OPOBJ_U: ClientPacketId.OPOBJ_U,

    // Use-on aliases
    OPLOCU: ClientPacketId.OPLOCU,
    OPLOCT: ClientPacketId.OPLOC_T,
    OPNPCU: ClientPacketId.OPNPC_U,
    OPNPCT: ClientPacketId.OPNPC_T,
    OPPLAYERU: ClientPacketId.OPPLAYER_U,
    OPPLAYERT: ClientPacketId.OPPLAYER_T,
    OPOBJU: ClientPacketId.OPOBJ_U,
    OPOBJT: ClientPacketId.OPLOC_T_ALT,

    // Examine
    EXAMINE_LOC: ClientPacketId.EXAMINE_LOC,
    EXAMINE_OBJ: ClientPacketId.EXAMINE_OBJ,
    EXAMINE_OBJECT: ClientPacketId.EXAMINE_LOC,

    // Widget interactions
    IF_BUTTON: ClientPacketId.IF_BUTTON,
    IF_BUTTON1: ClientPacketId.IF_BUTTON1,
    IF_BUTTON2: ClientPacketId.IF_BUTTON2,
    IF_BUTTON3: ClientPacketId.IF_BUTTON3,
    IF_BUTTON4: ClientPacketId.IF_BUTTON4,
    IF_BUTTON5: ClientPacketId.IF_BUTTON5,
    IF_BUTTON6: ClientPacketId.IF_BUTTON6,
    IF_BUTTON7: ClientPacketId.IF_BUTTON7,
    IF_BUTTON8: ClientPacketId.IF_BUTTON8,
    IF_BUTTON9: ClientPacketId.IF_BUTTON9,
    IF_BUTTON10: ClientPacketId.IF_BUTTON10,
    IF_TRIGGEROPLOCAL: ClientPacketId.IF_TRIGGEROPLOCAL,
    IF_BUTTOND: ClientPacketId.IF_BUTTOND,
    IF_BUTTONT: ClientPacketId.IF_BUTTONT,

    // Movement
    MOVE_GAMECLICK: ClientPacketId.MOVE_GAMECLICK,
    WORLD_MAP_CLICK: ClientPacketId.WORLD_MAP_CLICK,

    // Dialog
    RESUME_PAUSEBUTTON: ClientPacketId.RESUME_PAUSEBUTTON,

    // Interface close
    IF_CLOSE: ClientPacketId.IF_CLOSE,
} as const;
