package gateway.up

import gateway.coverage.DropCounter
import gateway.session.VarpMirror
import gateway.tsps.TspsClientPacket
import gateway.down.ChatStyle
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.incoming.buttons.If1Button
import net.rsprot.protocol.game.incoming.buttons.If3Button
import net.rsprot.protocol.game.incoming.buttons.IfButtonD
import net.rsprot.protocol.game.incoming.buttons.IfButtonT
import net.rsprot.protocol.game.incoming.buttons.IfScriptTrigger
import net.rsprot.protocol.game.incoming.buttons.IfSubOp
import net.rsprot.protocol.game.incoming.clan.AffinedClanSettingsAddBannedFromChannel
import net.rsprot.protocol.game.incoming.clan.AffinedClanSettingsSetMutedFromChannel
import net.rsprot.protocol.game.incoming.clan.ClanChannelKickUser
import net.rsprot.protocol.game.incoming.friendchat.FriendChatJoinLeave
import net.rsprot.protocol.game.incoming.friendchat.FriendChatKick
import net.rsprot.protocol.game.incoming.friendchat.FriendChatSetRank
import net.rsprot.protocol.game.incoming.locs.OpLoc6
import net.rsprot.protocol.game.incoming.locs.OpLocT
import net.rsprot.protocol.game.incoming.locs.OpLocV2
import net.rsprot.protocol.game.incoming.messaging.MessagePrivate
import net.rsprot.protocol.game.incoming.messaging.MessagePublic
import net.rsprot.protocol.game.incoming.misc.user.ClickWorldMap
import net.rsprot.protocol.game.incoming.misc.user.ClientCheat
import net.rsprot.protocol.game.incoming.misc.user.CloseModal
import net.rsprot.protocol.game.incoming.misc.user.MoveGameClick
import net.rsprot.protocol.game.incoming.misc.user.MoveMinimapClick
import net.rsprot.protocol.game.incoming.misc.user.SendSnapshot
import net.rsprot.protocol.game.incoming.misc.user.SetChatFilterSettings
import net.rsprot.protocol.game.incoming.misc.user.SetHeading
import net.rsprot.protocol.game.incoming.misc.user.Teleport
import net.rsprot.protocol.game.incoming.npcs.OpNpc6
import net.rsprot.protocol.game.incoming.npcs.OpNpcT
import net.rsprot.protocol.game.incoming.npcs.OpNpcV2
import net.rsprot.protocol.game.incoming.objs.OpObj6
import net.rsprot.protocol.game.incoming.objs.OpObjT
import net.rsprot.protocol.game.incoming.objs.OpObjV2
import net.rsprot.protocol.game.incoming.players.OpPlayer
import net.rsprot.protocol.game.incoming.players.OpPlayerT
import net.rsprot.protocol.game.incoming.resumed.ResumePCountDialog
import net.rsprot.protocol.game.incoming.social.FriendListAdd
import net.rsprot.protocol.game.incoming.worldentities.OpWorldEntity
import net.rsprot.protocol.game.incoming.social.FriendListDel
import net.rsprot.protocol.game.incoming.social.IgnoreListAdd
import net.rsprot.protocol.game.incoming.social.IgnoreListDel
import net.rsprot.protocol.game.incoming.resumed.ResumePLongDialog
import net.rsprot.protocol.game.incoming.resumed.ResumePNameDialog
import net.rsprot.protocol.game.incoming.resumed.ResumePStringDialog
import net.rsprot.protocol.game.incoming.resumed.ResumePauseButton
import net.rsprot.protocol.message.IncomingGameMessage

/**
 * The official client's packets as the tsps packets the browser would send for the same
 * action. tsps closes a session on an opcode it doesn't know, so anything without a
 * translation is counted and dropped, never passed on.
 */
class Upstream(
    private val varps: VarpMirror,
    /** Identkits in the cache, to check a character design before passing it on. */
    private val identKitCount: Int,
    /** Buttons a translator takes over (trade); true when it did. */
    private val interceptButton: (combinedId: Int, sub: Int, obj: Int, op: Int) -> Boolean = { _, _, _, _ -> false },
    /** Count-dialog replies a translator asked for itself (trade's Offer-X); true when it did. */
    private val interceptCount: (Int) -> Boolean = { false },
    /** tsps's index for a boat the client names by its world id. */
    private val worldEntityIndex: (Int) -> Int? = { it },
    private val send: (ByteArray) -> Unit,
) {
    fun handle(message: IncomingGameMessage) {
        when (message) {
            is MoveGameClick -> send(TspsClientPacket.move(message.x, message.z, message.keyCombination))
            is MoveMinimapClick -> send(TspsClientPacket.move(message.x, message.z, message.keyCombination))
            is SetHeading -> send(TspsClientPacket.setHeading(message.heading))
            is If1Button -> send(TspsClientPacket.ifButton(message.combinedId))
            is If3Button -> button(message)
            is IfSubOp ->
                send(
                    TspsWriter().i32(message.combinedId).u16(message.sub).u16(message.obj).u8(message.op).u8(message.subop)
                        .fixed(IF_BUTTON_SUB),
                )
            is IfButtonD ->
                if (message.selectedCombinedId == INVENTORY && message.targetCombinedId == INVENTORY) {
                    send(WorldOps.inventoryMove(message.selectedSub, message.targetSub))
                } else {
                    // Onto another slot of the same component the client swaps the slots on screen
                    // before it sends, so the objs come from the swapped slots: the dragged item is the
                    // target's (RuneLite's recorded bank drags). Where nothing is swapped (a bank tab, or
                    // the empty space after a tab's items) the target has no obj and they are as sent.
                    // tsps checks the dragged item against the slot it came from.
                    val swapped = message.selectedCombinedId == message.targetCombinedId && message.targetObj !in NO_OBJS
                    val dragged = if (swapped) message.targetObj else message.selectedObj
                    val droppedOn = if (swapped) message.selectedObj else message.targetObj
                    send(
                    TspsWriter()
                        .u16le(droppedOn)
                        .i32le(message.targetCombinedId)
                        .u16(dragged)
                        .u16AddLE(message.selectedSub)
                        .i32me(message.selectedCombinedId)
                        .u16le(message.targetSub)
                        .fixed(IF_BUTTOND),
                    )
                }
            is IfButtonT ->
                if (message.selectedCombinedId == INVENTORY && message.targetCombinedId == INVENTORY) {
                    send(WorldOps.itemOnItem(message.selectedSub, message.selectedObj, message.targetSub, message.targetObj))
                } else {
                    send(
                    TspsWriter()
                        .i32ime(message.targetCombinedId)
                        .u16AddLE(message.targetSub)
                        .i32le(message.selectedCombinedId)
                        .u16le(message.selectedSub)
                        .u16(message.selectedObj)
                        .u16AddLE(message.targetObj)
                        .fixed(IF_BUTTONT),
                    )
                }
            is IfScriptTrigger -> scriptTrigger(message)
            is ResumePauseButton -> send(TspsWriter().u16AddLE(message.sub).i32(message.combinedId).fixed(RESUME_PAUSEBUTTON))
            is ResumePCountDialog -> if (!interceptCount(message.count)) send(TspsWriter().i32(message.count).fixed(RESUME_COUNTDIALOG))
            is ResumePLongDialog -> send(TspsWriter().i32(message.count.coerceIn(0, Int.MAX_VALUE.toLong()).toInt()).fixed(RESUME_COUNTDIALOG))
            is ResumePNameDialog -> send(TspsWriter().string(message.name).varByte(RESUME_NAMEDIALOG))
            is ResumePStringDialog -> send(TspsWriter().string(message.string).varByte(RESUME_STRINGDIALOG))
            is CloseModal -> send(TspsWriter().fixed(IF_CLOSE))
            is MessagePublic ->
                when {
                    // tsps's clan chat has no colour or effect.
                    message.type == CLAN_CHAT_TYPE ->
                        if (message.clanType == OWN_CLAN) send(TspsClientPacket.clanChat(OWN_CLAN, message.message)) else DropCounter.up(message)
                    message.type == GUEST_CLAN_CHAT_TYPE -> send(TspsClientPacket.clanChat(GUEST_CLAN, message.message))
                    else ->
                        PUBLIC_CHAT_KINDS[message.type]?.let { send(TspsClientPacket.chat(it, message.message, publicChatStyle(message))) } ?: DropCounter.up(message)
                }
            is ClanChannelKickUser -> clanChannelAction(message, message.clanId, KICK_USER, message.name)
            is AffinedClanSettingsAddBannedFromChannel -> clanChannelAction(message, message.clanId, BAN_USER, message.name)
            is AffinedClanSettingsSetMutedFromChannel -> clanChannelAction(message, message.clanId, MUTE_USER, message.name, if (message.muted) 1 else 0)
            // Autocomplete is the client asking for suggestions as you type; tsps has none.
            is ClientCheat -> if (!message.autocomplete) send(TspsClientPacket.command(message.command))
            is MessagePrivate -> send(TspsWriter().string(message.name).string(message.message).varByte(PRIVATE_MESSAGE))
            is FriendListAdd -> social(ADD_FRIEND, message.name)
            is FriendListDel -> social(REMOVE_FRIEND, message.name)
            is IgnoreListAdd -> social(ADD_IGNORE, message.name)
            is IgnoreListDel -> social(REMOVE_IGNORE, message.name)
            is FriendChatJoinLeave -> message.name?.let { social(JOIN, it) } ?: social(LEAVE, "")
            is FriendChatKick -> social(KICK, message.name)
            is FriendChatSetRank -> social(SET_FRIEND_RANK, message.name, message.rank)
            is SetChatFilterSettings ->
                send(TspsWriter().u8(message.publicChatFilter).u8(message.privateChatFilter).u8(message.tradeChatFilter).fixed(CHAT_FILTER))
            is SendSnapshot -> send(TspsWriter().string(message.name).u8(message.ruleId).u8(if (message.mute) 1 else 0).varByte(REPORT_ABUSE))
            is UpdatePlayerModel -> message.design(identKitCount)?.let { send(message.toTsps(it)) } ?: UpdatePlayerModel.logUnknown(message)
            is OpWorldEntity -> {
                val index = worldEntityIndex(message.index)
                if (message.op in 1..5 && index != null) send(WorldOps.worldEntity(message.op, index)) else DropCounter.up(message)
            }
            is ClickWorldMap -> send(WorldOps.worldMapClick(message.level, message.x, message.z))
            is Teleport -> send(WorldOps.teleport(message.level, message.x, message.z))
            is OpPlayer -> send(TspsClientPacket.playerOp(message.op, message.index))
            is OpNpcV2 -> if (message.op in 1..5) send(TspsClientPacket.npcOp(message.op, message.index)) else DropCounter.up(message)
            is OpNpc6 -> send(TspsClientPacket.examineNpc(message.id))
            is OpLocV2 -> if (message.op in 1..5) send(WorldOps.loc(message.op, message.id, message.x, message.z)) else DropCounter.up(message)
            is OpLoc6 -> send(WorldOps.examineLoc(message.id))
            is OpObjV2 -> if (message.op in 1..5) send(WorldOps.obj(message.op, message.id, message.x, message.z)) else DropCounter.up(message)
            is OpObj6 -> send(WorldOps.examineObj(message.id, message.x, message.z))
            // OSRS sends item use and spells as one `T` packet; tsps has one for each.
            is OpLocT ->
                send(
                    if (message.selectedCombinedId == INVENTORY) {
                        WorldOps.itemOnLoc(message.id, message.x, message.z, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    } else {
                        WorldOps.spellOnLoc(message.id, message.x, message.z, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    },
                )
            is OpObjT ->
                send(
                    if (message.selectedCombinedId == INVENTORY) {
                        WorldOps.itemOnObj(message.id, message.x, message.z, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    } else {
                        WorldOps.spellOnObj(message.id, message.x, message.z, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    },
                )
            is OpNpcT ->
                send(
                    if (message.selectedCombinedId == INVENTORY) {
                        WorldOps.itemOnNpc(message.index, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    } else {
                        WorldOps.spellOnNpc(message.index, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    },
                )
            is OpPlayerT ->
                send(
                    if (message.selectedCombinedId == INVENTORY) {
                        WorldOps.itemOnPlayer(message.index, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    } else {
                        WorldOps.spellOnPlayer(message.index, message.selectedCombinedId, message.selectedSub, message.selectedObj)
                    },
                )
            else -> DropCounter.up(message)
        }
    }

    /** FRIENDS_CHAT_ACTION: one packet for the friend, ignore and friends-chat actions. */
    private fun social(action: Int, name: String, rank: Int = 0) =
        send(TspsWriter().u8(action).string(name).u8(rank).varByte(FRIENDS_CHAT_ACTION))

    /** tsps only takes these ops in the player's own clan channel, whichever the client means. */
    private fun clanChannelAction(message: IncomingGameMessage, clanId: Int, action: Int, name: String, value: Int = 0) =
        if (clanId == OWN_CLAN) send(TspsClientPacket.clanChannelAction(action, name, value)) else DropCounter.up(message)

    private fun button(message: If3Button) {
        if (interceptButton(message.combinedId, message.sub, message.obj, message.op)) return
        when (message.combinedId) {
            // The browser sets the run varp itself and transmits it; tsps has no orb handler.
            RUN_ORB -> send(TspsWriter().u16(RUN_VARP).i32(1 - varps[RUN_VARP]).fixed(VARP_TRANSMIT))
            // The browser's CS2 LOGOUT op sends LOGOUT; the official client sends the button.
            LOGOUT_TAB_BUTTON, WORLD_SWITCHER_LOGOUT -> send(TspsWriter().fixed(LOGOUT))
            else -> send(TspsClientPacket.ifButtonX(message.combinedId, message.sub, message.obj, message.op))
        }
    }

    /** IF_TRIGGEROPLOCAL: u16 length, then little-endian crc, sub, component and obj, then the args. */
    /** The colour and effect typed with the message, or none. */
    private fun publicChatStyle(message: MessagePublic): ChatStyle? =
        if (message.colour == 0 && message.effect == 0) null else ChatStyle(message.colour, message.effect, message.pattern?.asByteArray())

    private fun scriptTrigger(message: IfScriptTrigger) {
        val args = ByteArray(message.buffer.readableBytes()).also { message.buffer.getBytes(message.buffer.readerIndex(), it) }
        val body =
            TspsWriter()
                .i32le(message.crc)
                .u16le(message.sub)
                .i32le(message.combinedId)
                .u16le(message.obj)
                .bytes(args)
                .body()
        send(TspsWriter().u16(body.size).bytes(body).varShort(IF_TRIGGEROPLOCAL))
    }

    private companion object {
        const val IF_BUTTOND = 1

        /** A drag's obj field with no item. */
        val NO_OBJS = setOf(-1, 0xFFFF)
        const val IF_TRIGGEROPLOCAL = 30
        const val IF_CLOSE = 55
        const val RESUME_PAUSEBUTTON = 62
        const val IF_BUTTON_SUB = 89
        const val IF_BUTTONT = 90
        const val VARP_TRANSMIT = 191
        const val FRIENDS_CHAT_ACTION = 196
        const val PRIVATE_MESSAGE = 197
        const val CHAT_FILTER = 198
        const val REPORT_ABUSE = 199

        // FRIENDS_CHAT_ACTION's action codes.
        const val JOIN = 0
        const val LEAVE = 1
        const val KICK = 2
        const val ADD_FRIEND = 3
        const val REMOVE_FRIEND = 4
        const val SET_FRIEND_RANK = 5
        const val ADD_IGNORE = 6
        const val REMOVE_IGNORE = 7
        const val RESUME_COUNTDIALOG = 192
        const val RESUME_NAMEDIALOG = 193
        const val RESUME_STRINGDIALOG = 194
        const val LOGOUT = 203

        const val INVENTORY = 149 shl 16
        const val RUN_ORB = (160 shl 16) or 28
        const val RUN_VARP = 173
        const val LOGOUT_TAB_BUTTON = (182 shl 16) or 8
        const val WORLD_SWITCHER_LOGOUT = (69 shl 16) or 25

        /** OSRS public-chat types (0 public, 1 autotyper, 2 friends chat) to tsps chat kinds. */
        val PUBLIC_CHAT_KINDS = mapOf(0 to 0, 1 to 3, 2 to 2)

        /** OSRS public-chat types for clan chat; rsprot only reads a clan type for the first. */
        const val CLAN_CHAT_TYPE = 3
        const val GUEST_CLAN_CHAT_TYPE = 4
        const val OWN_CLAN = 0
        const val GUEST_CLAN = -1

        // CLAN_CHANNEL_ACTION's action codes.
        const val KICK_USER = 0
        const val BAN_USER = 1
        const val MUTE_USER = 2
    }
}
