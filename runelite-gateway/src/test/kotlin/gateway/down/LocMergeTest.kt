package gateway.down

import gateway.headless.HeadlessClient
import gateway.tsps.TspsCodec
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import io.netty.buffer.Unpooled
import net.rsprot.buffer.extensions.toJagByteBuf
import net.rsprot.compression.HuffmanCodec
import net.rsprot.crypto.cipher.NopStreamCipher
import net.rsprot.protocol.game.outgoing.codec.zone.header.DesktopUpdateZonePartialEnclosedEncoder
import net.rsprot.protocol.game.outgoing.zone.header.UpdateZonePartialEnclosed
import net.rsprot.protocol.message.OutgoingGameMessage
import net.rsprox.cache.api.CacheProvider
import net.rsprox.protocol.game.outgoing.model.zone.header.UpdateZonePartialEnclosed as DecodedZone
import net.rsprox.protocol.game.outgoing.model.zone.payload.LocMerge as DecodedMerge
import net.rsprox.protocol.session.AttributeMap
import net.rsprox.protocol.session.Session
import net.rsprox.protocol.v241.ServerPacketDecoderServiceV241
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Real zone encoders and revision-241 RSProx decoders, including the recorded reversed bounds. */
class LocMergeTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val world = World({ sent += it }).apply { rebuild(X shr 3, Z shr 3) }
    private val session = Session(0, AttributeMap())
    // No text is decoded here; an ordinary fixed-width code table avoids loading the game cache.
    private val decoder = ServerPacketDecoderServiceV241(
        HuffmanCodec.create(Unpooled.wrappedBuffer(ByteArray(256) { 8 })),
        CacheProvider { HeadlessClient.NoCache },
    )

    @Test
    fun `captured underwater merge preserves player index cycles signed bounds and plane`() {
        val packet = TspsCodec.split(merge().fixed(TspsServerPacket.LOC_MERGE)).single()
        assertEquals(18, packet.payload.size)
        assertTrue(world.handle(packet))
        assertTrue(sent.isEmpty(), "merge waits for its zone's tick flush")
        world.flushZones()
        val zone = decode(sent.single() as UpdateZonePartialEnclosed)
        assertEquals(1, zone.level)
        val merge = zone.packets.single() as DecodedMerge
        assertEquals(1966, merge.index, "TSPS and native player-info use the same player index")
        assertEquals(30962, merge.id)
        assertEquals(X and 7, merge.xInZone)
        assertEquals(Z and 7, merge.zInZone)
        assertEquals(10, merge.shape)
        assertEquals(3, merge.rotation)
        assertEquals(0, merge.start)
        assertEquals(60, merge.end, "client cycles remain unchanged")
        assertEquals(listOf(1, 0, -1, 0), listOf(merge.minX, merge.minZ, merge.maxX, merge.maxZ))
    }

    @Test
    fun `off scene merge is discarded and rebuild discards old pending merges`() {
        assertTrue(world.handle(TspsPacket(LOC_MERGE, merge(x = X + 200).body())))
        world.flushZones()
        assertTrue(sent.isEmpty())
        assertTrue(world.handle(TspsPacket(LOC_MERGE, merge().body())))
        world.rebuild((X shr 3) + 20, Z shr 3)
        world.flushZones()
        assertTrue(sent.isEmpty(), "an old-scene attachment cannot appear in the new scene")
    }

    @Test
    fun `deck merge waits for its own world and retains deck plane and local coordinates`() {
        val deck = gateway.session.WorldEntities.Deck(3000, 1, 1, 1, 1, 1200, 1200, arrayOfNulls(4 * 13 * 13))
        val boats = World({ sent += it }, deckAt = { x, z -> deck.takeIf { it.contains(x, z) } })
        val x = (1200 shl 3) + 3
        val z = (1200 shl 3) + 5
        assertTrue(boats.handle(TspsPacket(LOC_MERGE, merge(x, z).body())))
        boats.flushZones()
        assertTrue(sent.isEmpty())
        boats.flushDeck(1)
        val zone = decode(sent.single() as UpdateZonePartialEnclosed)
        assertEquals(Triple(0, 0, 1), Triple(zone.zoneX, zone.zoneZ, zone.level))
        val merge = zone.packets.single() as DecodedMerge
        assertEquals(3, merge.xInZone)
        assertEquals(5, merge.zInZone)
    }

    private fun merge(x: Int = X, z: Int = Z) = TspsWriter()
        .u16(30962).u16(x).u16(z).u8(1).u8((10 shl 2) or 3)
        .u16(1966).u16(0).u16(60).u8(1).u8(0).u8(-1).u8(0)

    private fun decode(zone: UpdateZonePartialEnclosed): DecodedZone {
        val encoder = DesktopUpdateZonePartialEnclosedEncoder()
        val buffer = Unpooled.buffer()
        val wire = buffer.toJagByteBuf()
        try {
            encoder.encode(NopStreamCipher, wire, zone)
            // rsprot's channel encoder appends the cached payload separately from the header.
            buffer.writeBytes(zone.payload, zone.payload.readerIndex(), zone.payload.readableBytes())
            return decoder.decode(encoder.prot.opcode, wire, session) as DecodedZone
        } finally {
            buffer.release()
        }
    }

    private companion object {
        const val LOC_MERGE = 138
        const val X = 3760
        const val Z = 10277
    }
}
