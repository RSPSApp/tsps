package gateway.up

import gateway.cache.VarTypes
import gateway.headless.TestCache
import gateway.session.VarpMirror
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.incoming.clan.AffinedClanSettingsAddBannedFromChannel
import net.rsprot.protocol.game.incoming.clan.AffinedClanSettingsSetMutedFromChannel
import net.rsprot.protocol.game.incoming.clan.ClanChannelFullRequest
import net.rsprot.protocol.game.incoming.clan.ClanChannelKickUser
import net.rsprot.protocol.game.incoming.clan.ClanSettingsFullRequest
import net.rsprot.protocol.game.incoming.messaging.MessagePublic
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The bytes tsps gets, against what `ClientBinaryEncoder.ts` writes for the same action. */
class UpstreamClanTest {
    private val sent = ArrayList<ByteArray>()
    private val upstream = Upstream(VarpMirror(VarTypes(TestCache.cache)), 0) { sent += it }

    private fun chat(type: Int, clanType: Int, colour: Int = 0) = MessagePublic(type, colour, 0, "hello", null, clanType)

    /** `encodeClanChat`: CHAT, its length, kind 4, the clan type, then the text. */
    private fun clanChat(clanType: Int) = TspsWriter().u8(4).u8(clanType).string("hello").varByte(CHAT)

    @Test
    fun `clan chat goes to the clan by chat type`() {
        upstream.handle(chat(type = 3, clanType = 0))
        upstream.handle(chat(type = 4, clanType = -1))
        assertArrayEquals(clanChat(0), sent[0])
        assertArrayEquals(clanChat(0xFF), sent[1])
    }

    @Test
    fun `a clan tsps has no chat for is dropped, not sent`() {
        upstream.handle(chat(type = 3, clanType = 1))
        assertTrue(sent.isEmpty())
    }

    @Test
    fun `other chat types are as before`() {
        upstream.handle(chat(type = 2, clanType = -1))
        assertArrayEquals(TspsWriter().u8(2).string("hello").varByte(CHAT), sent.single())
    }

    @Test
    fun `channel ops become CLAN_CHANNEL_ACTION by channel slot`() {
        upstream.handle(ClanChannelKickUser("Bob", 0, 3))
        upstream.handle(AffinedClanSettingsAddBannedFromChannel("Bob", 0, 4))
        upstream.handle(AffinedClanSettingsSetMutedFromChannel("Bob", 0, 5, true))
        upstream.handle(AffinedClanSettingsSetMutedFromChannel("Bob", 0, 5, false))
        val expected =
            listOf(
                byteArrayOf(CLAN_CHANNEL_ACTION, 0, 0, 3, 0),
                byteArrayOf(CLAN_CHANNEL_ACTION, 1, 0, 4, 0),
                byteArrayOf(CLAN_CHANNEL_ACTION, 2, 0, 5, 1),
                byteArrayOf(CLAN_CHANNEL_ACTION, 2, 0, 5, 0),
            )
        expected.forEachIndexed { index, bytes -> assertArrayEquals(bytes, sent[index]) }
    }

    @Test
    fun `what tsps can't take reaches it as nothing`() {
        // tsps's op only means the player's own channel.
        upstream.handle(ClanChannelKickUser("Bob", 255, 3))
        upstream.handle(ClanChannelFullRequest(0))
        upstream.handle(ClanSettingsFullRequest(0))
        assertTrue(sent.isEmpty())
    }

    private companion object {
        const val CHAT = 190
        const val CLAN_CHANNEL_ACTION: Byte = -75 // 181
    }
}
