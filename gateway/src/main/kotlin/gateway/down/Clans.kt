package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import gateway.tsps.TspsServerPacket
import net.rsprot.protocol.game.outgoing.clan.ClanChannelDelta
import net.rsprot.protocol.game.outgoing.clan.ClanChannelFull
import net.rsprot.protocol.game.outgoing.clan.ClanSettingsDelta
import net.rsprot.protocol.game.outgoing.clan.ClanSettingsFull
import net.rsprot.protocol.game.outgoing.clan.VarClan
import net.rsprot.protocol.game.outgoing.clan.VarClanEnable
import net.rsprot.protocol.message.OutgoingGameMessage

/**
 * Clan settings, channels and clan vars. tsps's wire formats are its own, but its updates are
 * the ones live sends, so each maps to the rsprot message of the same name, in the display-name
 * form live uses (no hashes, no version).
 *
 * Live numbers a delta with the update count it applies on top of: a full update's number comes
 * back on the first delta (rsprox 3886: channel full and first delta 1767819675047, settings full
 * and delta 7868, then full 7869). tsps numbers a delta with the count after it, and the browser
 * ignores it. So the count is kept here, from the last full update, and tsps's is not passed on.
 * A delta with no full update before it is dropped, as the client would have nothing to apply it to.
 */
class Clans(private val send: (OutgoingGameMessage) -> Unit) {
    private class Channel(val key: Long, var updateNum: Long)

    /** By clan type: 0 the player's own clan, -1 the guest clan. */
    private val channels = HashMap<Int, Channel>()
    private val settingsUpdateNums = HashMap<Int, Int>()
    private var varsEnabled = false

    fun handle(packet: TspsPacket): Boolean {
        val reader = packet.reader()
        return when (packet.opcode) {
            TspsServerPacket.CLAN_SETTINGS_FULL -> settingsFull(reader)
            TspsServerPacket.CLAN_SETTINGS_DELTA -> settingsDelta(reader)
            TspsServerPacket.CLAN_CHANNEL_FULL -> channelFull(reader)
            TspsServerPacket.CLAN_CHANNEL_DELTA -> channelDelta(reader)
            TspsServerPacket.CLAN_VAR -> clanVar(reader)
            else -> false
        }
    }

    private fun settingsFull(reader: TspsReader): Boolean {
        val clanType = reader.s8()
        if (reader.u8() == 0) {
            settingsUpdateNums -= clanType
            send(ClanSettingsFull(clanType, ClanSettingsFull.LeaveUpdate))
            return true
        }
        val updateNum = reader.i32()
        val creationTime = reader.i32()
        val name = reader.string()
        val allowGuests = reader.u8() != 0
        val talkRank = reader.s8()
        val kickRank = reader.s8()
        // The owner and replacement slots: live's update has neither.
        reader.u16()
        reader.u16()
        val members =
            List(reader.u16()) {
                val member = reader.string()
                val rank = reader.s8()
                val muted = reader.u8() != 0
                val extraInfo = reader.i32()
                ClanSettingsFull.AffinedClanMember(member, rank, extraInfo, reader.u16(), muted)
            }
        val banned = List(reader.u16()) { ClanSettingsFull.BannedClanMember(reader.string()) }
        val settings = List(reader.u16()) { ClanSettingsFull.IntClanSetting(reader.u16(), reader.i32()) }
        settingsUpdateNums[clanType] = updateNum
        send(
            ClanSettingsFull(
                clanType,
                ClanSettingsFull.JoinUpdate(
                    updateNum,
                    creationTime,
                    name,
                    allowGuests,
                    talkRank,
                    kickRank,
                    NO_SHARE_RANK,
                    NO_SHARE_RANK,
                    members,
                    banned,
                    settings,
                ),
            ),
        )
        return true
    }

    private fun settingsDelta(reader: TspsReader): Boolean {
        val clanType = reader.s8()
        reader.i32() // tsps's count, see the class comment
        val updates =
            List(reader.u16()) {
                when (reader.u8()) {
                    1 -> ClanSettingsDelta.AddMemberV2Update(reader.string(), reader.u16())
                    2 -> ClanSettingsDelta.DeleteMemberUpdate(reader.u16())
                    3 -> ClanSettingsDelta.SetMemberRankUpdate(reader.u16(), reader.s8())
                    4 -> ClanSettingsDelta.SetMemberMutedUpdate(reader.u16(), reader.u8() != 0)
                    5 -> ClanSettingsDelta.SetMemberExtraInfoUpdate(reader.u16(), reader.i32(), reader.u8(), reader.u8())
                    else -> ClanSettingsDelta.SetIntSettingUpdate(reader.u16(), reader.i32())
                }
            }
        val updateNum = settingsUpdateNums[clanType] ?: return false
        settingsUpdateNums[clanType] = updateNum + 1
        send(ClanSettingsDelta(clanType, NO_OWNER_HASH, updateNum, updates))
        return true
    }

    private fun channelFull(reader: TspsReader): Boolean {
        val clanType = reader.s8()
        if (reader.u8() == 0) {
            channels -= clanType
            send(ClanChannelFull(clanType, ClanChannelFull.LeaveUpdate))
            return true
        }
        val key = reader.i32().toLong()
        val updateNum = reader.i32().toLong()
        val name = reader.string()
        val talkRank = reader.s8()
        val kickRank = reader.s8()
        val users =
            List(reader.u16()) {
                val user = reader.string()
                val rank = reader.s8()
                ClanChannelFull.ClanMember(user, rank, reader.u16())
            }
        channels[clanType] = Channel(key, updateNum)
        // Live always sends true for the boolean the client discards.
        send(ClanChannelFull(clanType, ClanChannelFull.JoinUpdate(key, updateNum, name, true, kickRank, talkRank, users)))
        return true
    }

    private fun channelDelta(reader: TspsReader): Boolean {
        val clanType = reader.s8()
        val key = reader.i32().toLong()
        reader.i32() // tsps's count, see the class comment
        val events =
            List(reader.u16()) {
                if (reader.u8() == 1) {
                    val user = reader.string()
                    val rank = reader.s8()
                    // Unlike ClanMember, this one takes the world first.
                    ClanChannelDelta.AddUserEvent(user, reader.u16(), rank)
                } else {
                    ClanChannelDelta.DeleteUserEvent(reader.u16())
                }
            }
        val channel = channels[clanType]?.takeIf { it.key == key } ?: return false
        send(ClanChannelDelta(clanType, key, channel.updateNum++, events))
        return true
    }

    private fun clanVar(reader: TspsReader): Boolean {
        // The recordings have VarClanEnable and never a VarClan, so that this must come first
        // is from memory of the client, unconfirmed.
        if (!varsEnabled) {
            varsEnabled = true
            send(VarClanEnable)
        }
        send(VarClan(reader.u16(), VarClan.VarClanIntData(reader.i32())))
        return true
    }

    private companion object {
        /** What live sends for loot and coin share, which tsps doesn't have (rsprox 763, 3886). */
        const val NO_SHARE_RANK = 0

        /** Live's delta owner when members go by display name (rsprox 3886). */
        const val NO_OWNER_HASH = 0L
    }
}
