package gateway.down

import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import io.netty.buffer.Unpooled
import net.rsprot.buffer.JagByteBuf
import net.rsprot.buffer.extensions.toJagByteBuf
import net.rsprot.compression.HuffmanCodec
import net.rsprot.crypto.cipher.NopStreamCipher
import net.rsprot.protocol.game.outgoing.clan.ClanChannelDelta
import net.rsprot.protocol.game.outgoing.clan.ClanChannelFull
import net.rsprot.protocol.game.outgoing.clan.ClanSettingsDelta
import net.rsprot.protocol.game.outgoing.clan.ClanSettingsFull
import net.rsprot.protocol.game.outgoing.clan.MessageClanChannel
import net.rsprot.protocol.game.outgoing.clan.VarClan
import net.rsprot.protocol.game.outgoing.clan.VarClanEnable
import net.rsprot.protocol.game.outgoing.codec.clan.ClanChannelDeltaEncoder
import net.rsprot.protocol.game.outgoing.codec.clan.ClanChannelFullEncoder
import net.rsprot.protocol.game.outgoing.codec.clan.ClanSettingsDeltaEncoder
import net.rsprot.protocol.game.outgoing.codec.clan.ClanSettingsFullEncoder
import net.rsprot.protocol.game.outgoing.codec.clan.VarClanEncoder
import net.rsprot.protocol.game.outgoing.misc.player.MessageGame
import net.rsprot.protocol.message.OutgoingGameMessage
import net.rsprot.protocol.message.codec.MessageEncoder
import net.rsprox.cache.api.CacheProvider
import net.rsprox.protocol.game.outgoing.model.clan.ClanChannelDelta as DecodedChannelDelta
import net.rsprox.protocol.game.outgoing.model.clan.ClanSettingsDelta as DecodedSettingsDelta
import net.rsprox.protocol.game.outgoing.model.clan.VarClan as DecodedVarClan
import net.rsprox.protocol.session.AttributeMap
import net.rsprox.protocol.session.Session
import net.rsprox.protocol.v241.ServerPacketDecoderServiceV241
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * tsps's clan packets, in the bytes `ClientProtocol.ts` writes, through to what RSProx's 241
 * decoders read from rsprot's encoders. The expected strings have the shape of the live
 * recordings (rsprox 763 and 3886), so a field the wrong way round or a wrong flag shows.
 */
class ClansTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val clans = Clans { sent += it }
    private val session = Session(0, AttributeMap())
    private val decoder = ServerPacketDecoderServiceV241(HuffmanCodec.create(Unpooled.wrappedBuffer(TestCache.huffman)), CacheProvider { HeadlessClient.NoCache })

    private fun handle(opcode: Int, writer: TspsWriter): Boolean = clans.handle(TspsPacket(opcode, writer.body()))

    /** `encodeClanChannelFull`, with users Ann (rank 126) and Bob (-1, a guest) on world 1. */
    private fun channelFull(clanType: Int = OWN, key: Int = KEY, updateNum: Int = 5) =
        handle(
            TspsServerPacket.CLAN_CHANNEL_FULL,
            TspsWriter()
                .u8(clanType and 0xFF).u8(1)
                .i32(key).i32(updateNum)
                .string("PWJ").u8(0xFF).u8(100)
                .u16(2)
                .string("Ann").u8(126).u16(1)
                .string("Bob").u8(0xFF).u16(1),
        )

    /** `encodeClanSettingsFull`. */
    private fun settingsFull(updateNum: Int = 7868) =
        handle(
            TspsServerPacket.CLAN_SETTINGS_FULL,
            TspsWriter()
                .u8(OWN).u8(1)
                .i32(updateNum).i32(27033842)
                .string("PWJ").u8(1).u8(0xFF).u8(100)
                .u16(0).u16(0xFFFF)
                .u16(1)
                .string("Ann").u8(126).u8(1).i32(1599).u16(7028)
                .u16(1)
                .string("Eve")
                .u16(1)
                .u16(8).i32(8715),
        )

    private fun channelDelta(tspsNum: Int, key: Int = KEY, write: TspsWriter.() -> Unit) =
        handle(TspsServerPacket.CLAN_CHANNEL_DELTA, TspsWriter().u8(OWN).i32(key).i32(tspsNum).u16(1).apply(write))

    private fun settingsDelta(tspsNum: Int, write: TspsWriter.() -> Unit) =
        handle(TspsServerPacket.CLAN_SETTINGS_DELTA, TspsWriter().u8(OWN).i32(tspsNum).apply(write))

    private fun <T : OutgoingGameMessage> wire(encoder: MessageEncoder<T>, message: T): JagByteBuf =
        Unpooled.buffer().toJagByteBuf().also { encoder.encode(NopStreamCipher, it, message) }

    /** The opcode comes from rsprot's encoder, so a table that differs from RSProx's fails here too. */
    private fun <T : OutgoingGameMessage> decoded(encoder: MessageEncoder<T>, message: T) = decoder.decode(encoder.prot.opcode, wire(encoder, message), session)

    private fun decode(message: ClanChannelFull) = decoded(ClanChannelFullEncoder(), message)

    private fun decode(message: ClanChannelDelta) = decoded(ClanChannelDeltaEncoder(), message) as DecodedChannelDelta

    private fun decode(message: ClanSettingsFull) = decoded(ClanSettingsFullEncoder(), message)

    private fun decode(message: ClanSettingsDelta) = decoded(ClanSettingsDeltaEncoder(), message) as DecodedSettingsDelta

    @Test
    fun `a channel reaches the client in live's display-name form`() {
        assertTrue(channelFull())
        val full = decode(sent.single() as ClanChannelFull).toString()
        assertTrue(
            full.contains(
                "useBase37Names=false, useDisplayNames=true, hasVersion=false, version=2, key=$KEY, updateNum=5, clanName='PWJ', " +
                    "discardedBoolean=true, kickRank=100, talkRank=-1",
            ),
            full,
        )
        assertTrue(full.contains("ClanMember(name='Ann', rank=126, world=1"), full)
        assertTrue(full.contains("ClanMember(name='Bob', rank=-1, world=1"), full)
        assertTrue(full.endsWith("clanType=0)"), full)
    }

    @Test
    fun `leaving a channel of either type`() {
        channelFull(GUEST)
        sent.clear()
        assertTrue(handle(TspsServerPacket.CLAN_CHANNEL_FULL, TspsWriter().u8(GUEST and 0xFF).u8(0)))
        val leave = sent.single() as ClanChannelFull
        assertEquals(GUEST, leave.clanType)
        assertEquals(ClanChannelFull.LeaveUpdate, leave.update)
        decode(leave)
    }

    @Test
    fun `channel deltas count from the full update, as live does`() {
        channelFull(updateNum = 5)
        sent.clear()
        // tsps numbers these 6 and 7; live would send the 5 from the full update, then 6.
        assertTrue(channelDelta(6) { u8(1).string("Cat").u8(0xFF).u16(1) })
        assertTrue(channelDelta(7) { u8(2).u16(1) })
        val (add, delete) = sent.map { decode(it as ClanChannelDelta) }
        assertEquals(5L, add.updateNum)
        assertEquals(KEY.toLong(), add.clanHash)
        assertEquals(6L, delete.updateNum)
        val added = add.events.single() as DecodedChannelDelta.ClanChannelDeltaAddUserEvent
        assertEquals(Triple("Cat", -1, 1), Triple(added.name, added.rank, added.world))
        assertEquals("[ClanChannelDeltaDeleteUserEvent(index=1)]", delete.events.toString())

        // A full update (refreshChannel) takes the count over.
        sent.clear()
        channelFull(updateNum = 20)
        channelDelta(21) { u8(2).u16(0) }
        assertEquals(20L, (sent.last() as ClanChannelDelta).updateNum)
    }

    @Test
    fun `a channel delta the client has no channel for is dropped`() {
        assertFalse(channelDelta(1) { u8(2).u16(0) })
        channelFull()
        sent.clear()
        assertFalse(channelDelta(6, key = KEY + 1) { u8(2).u16(0) })
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `settings reach the client in live's display-name form`() {
        assertTrue(settingsFull())
        val full = decode(sent.single() as ClanSettingsFull).toString()
        assertTrue(
            full.contains(
                "flags=2, updateNum=7868, creationTime=27033842, clanName='PWJ', allowUnaffined=true, talkRank=-1, kickRank=100, " +
                    "lootshareRank=0, coinshareRank=0",
            ),
            full,
        )
        assertTrue(full.contains("AffinedClanMember(hash=0, name=Ann, rank=126, extraInfo=1599, joinRuneDay=7028, muted=true)"), full)
        assertTrue(full.contains("Eve"), full)
        assertTrue(full.contains("setting=8") || full.contains("id=8"), full)
    }

    @Test
    fun `settings deltas count from the full update and carry every kind`() {
        settingsFull(7868)
        sent.clear()
        // All six in one delta, as `encodeClanSettingsDelta` writes them.
        assertTrue(
            settingsDelta(7869) {
                u16(6)
                u8(1).string("Cat").u16(8433)
                u8(2).u16(3)
                u8(3).u16(1).u8(0xFF)
                u8(4).u16(1).u8(1)
                u8(5).u16(1).i32(1835).u8(0).u8(12)
                u8(6).u16(8).i32(8715)
            },
        )
        assertTrue(settingsDelta(7870) { u16(1).u8(2).u16(0) })
        val (first, second) = sent.map { decode(it as ClanSettingsDelta) }
        assertEquals(7868, first.updateNum)
        assertEquals(0L, first.owner)
        assertEquals(7869, second.updateNum)
        val updates = first.updates.toString()
        assertTrue(updates.contains("ClanSettingsDeltaAddMemberV2Update(hash=-1, name=Cat, joinRuneDay=8433)"), updates)
        assertTrue(updates.contains("index=3"), updates)
        assertTrue(updates.contains("rank=-1"), updates)
        assertTrue(updates.contains("muted=true"), updates)
        assertTrue(updates.contains("ClanSettingsDeltaSetMemberExtraInfoUpdate(index=1, value=1835, startBit=0, endBit=12)"), updates)
        assertTrue(updates.contains("ClanSettingsDeltaSetIntSettingUpdate(setting=8, value=8715)"), updates)
    }

    @Test
    fun `a settings delta before any full update is dropped`() {
        assertFalse(settingsDelta(1) { u16(1).u8(2).u16(0) })
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `clan vars are enabled once, before the first`() {
        val writer = { value: Int -> TspsWriter().u16(5).i32(value) }
        assertTrue(handle(TspsServerPacket.CLAN_VAR, writer(1000)))
        assertTrue(handle(TspsServerPacket.CLAN_VAR, writer(2000)))
        assertEquals(VarClanEnable, sent[0])
        assertEquals(3, sent.size)
        val decoded = decoded(VarClanEncoder(), sent[2] as VarClan) as DecodedVarClan
        assertEquals(5, decoded.id)
        // RSProx leaves the value as bytes until it knows the var's type.
        assertEquals(listOf<Byte>(0, 0, 0x07, 0xD0.toByte()), (decoded.value as DecodedVarClan.UnknownVarClanData).data.toList())
    }

    @Test
    fun `clan chat lines go to the clan channel packet by type`() {
        val social = Social { sent += it }
        assertTrue(social.chat(TspsChatMessage("hi", 41, "<img=1>Ann", "PWJ", 1)))
        assertTrue(social.chat(TspsChatMessage("yo", 44, "Bob", "PWJ", 2)))
        val (own, guest) = sent.map { it as MessageClanChannel }
        assertEquals(listOf<Any>(0, "Ann", 2, "hi"), listOf(own.clanType, own.name, own.chatCrownType, own.message))
        assertEquals(listOf<Any>(-1, "Bob", 0, "yo"), listOf(guest.clanType, guest.name, guest.chatCrownType, guest.message))
        assertTrue(own.worldMessageCounter != guest.worldMessageCounter)
    }

    @Test
    fun `clan channel notices stay game messages, as the recording has them`() {
        for (type in listOf(43, 46)) {
            val notice = TspsChatMessage("Attempting to join...", type, "", "", -1)
            assertTrue(notice.isGameMessage)
            assertFalse(Social { sent += it }.chat(notice))
        }
        assertTrue(sent.none { it is MessageGame })
    }

    private companion object {
        const val OWN = 0
        const val GUEST = -1
        const val KEY = 1422
    }
}
