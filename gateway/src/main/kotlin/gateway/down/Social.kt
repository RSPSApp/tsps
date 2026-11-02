package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import net.rsprot.protocol.game.outgoing.clan.MessageClanChannel
import net.rsprot.protocol.game.outgoing.friendchat.MessageFriendChannel
import net.rsprot.protocol.game.outgoing.friendchat.UpdateFriendChatChannelFull.FriendChatEntry
import net.rsprot.protocol.game.outgoing.friendchat.UpdateFriendChatChannelFullV2
import net.rsprot.protocol.game.outgoing.misc.player.ChatFilterSettings
import net.rsprot.protocol.game.outgoing.misc.player.ChatFilterSettingsPrivateChat
import net.rsprot.protocol.game.outgoing.social.FriendListLoaded
import net.rsprot.protocol.game.outgoing.social.MessagePrivate
import net.rsprot.protocol.game.outgoing.social.MessagePrivateEcho
import net.rsprot.protocol.game.outgoing.social.UpdateFriendList
import net.rsprot.protocol.game.outgoing.social.UpdateIgnoreList
import net.rsprot.protocol.message.OutgoingGameMessage

/**
 * Friends, ignores and the friends chat. tsps sends all three as one full snapshot on every
 * change; OSRS has a packet for each, and the friends chat only needs sending when it changed.
 */
class Social(private val send: (OutgoingGameMessage) -> Unit) {
    private var loaded = false
    private var channel: Any? = null
    private var messageCounter = 0

    fun handle(packet: TspsPacket): Boolean {
        val reader = packet.reader()
        when (packet.opcode) {
            TspsServerPacket.FRIENDS_CHAT_UPDATE -> {
                val joined = reader.u8() != 0
                val channel =
                    if (!joined) {
                        null
                    } else {
                        val name = reader.string()
                        val owner = reader.string()
                        val kickRank = reader.u8().toByte().toInt()
                        reader.u8() // the viewer's own rank: the client finds it in the member list
                        val members = List(reader.u16()) { FriendChatEntry(reader.string(), reader.u16(), reader.u8().toByte().toInt(), WORLD_NAME) }
                        Triple(owner, name, kickRank) to members
                    }
                if (channel != this.channel) {
                    this.channel = channel
                    send(
                        UpdateFriendChatChannelFullV2(
                            channel?.let { (header, members) ->
                                UpdateFriendChatChannelFullV2.JoinUpdate(header.first, header.second, header.third, members)
                            } ?: UpdateFriendChatChannelFullV2.LeaveUpdate,
                        ),
                    )
                }
                val friends =
                    List(reader.u16()) {
                        val name = reader.string()
                        val previous = reader.string().ifEmpty { null }
                        val world = reader.u16()
                        val rank = reader.u8()
                        val online = reader.u8() != 0
                        if (online) {
                            UpdateFriendList.OnlineFriend(false, name, previous, world, rank, 0, "", WORLD_NAME, 0, 0)
                        } else {
                            UpdateFriendList.OfflineFriend(false, name, previous, rank, 0, "")
                        }
                    }
                val ignores = List(reader.u16()) { UpdateIgnoreList.AddedIgnoredEntry(reader.string(), reader.string().ifEmpty { null }, "", false) }
                send(UpdateFriendList(friends))
                send(UpdateIgnoreList(ignores))
                if (!loaded) {
                    loaded = true
                    send(FriendListLoaded)
                }
            }
            TspsServerPacket.CHAT_FILTER_SETTINGS -> {
                val public = reader.u8()
                val private = reader.u8()
                val trade = reader.u8()
                send(ChatFilterSettings(public, trade))
                send(ChatFilterSettingsPrivateChat(private))
            }
            else -> return false
        }
        return true
    }

    /** Private, friends-chat and clan lines from CHAT_MESSAGE; false when [chat] is none of them. */
    fun chat(chat: TspsChatMessage): Boolean {
        val name = chat.from.replace(ICON, "")
        when (chat.type) {
            PRIVATE_IN -> send(MessagePrivate(name, WORLD, ++messageCounter, chat.modIcon, chat.text))
            PRIVATE_OUT -> send(MessagePrivateEcho(name, chat.text))
            FRIENDS_CHAT -> send(MessageFriendChannel(name, chat.prefix, WORLD, ++messageCounter, chat.modIcon, chat.text))
            CLAN_CHAT -> send(MessageClanChannel(OWN_CLAN, name, WORLD, ++messageCounter, chat.modIcon, chat.text))
            GUEST_CLAN_CHAT -> send(MessageClanChannel(GUEST_CLAN, name, WORLD, ++messageCounter, chat.modIcon, chat.text))
            else -> return false
        }
        return true
    }

    private companion object {
        const val PRIVATE_IN = 3
        const val PRIVATE_OUT = 6
        const val FRIENDS_CHAT = 9
        const val CLAN_CHAT = 41
        const val GUEST_CLAN_CHAT = 44
        const val OWN_CLAN = 0
        const val GUEST_CLAN = -1
        const val WORLD = 1
        const val WORLD_NAME = "tsps"
        val ICON = Regex("""<img=\d+>""")
    }
}
