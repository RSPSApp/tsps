package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Base64

/** Which tsps rebuilds the client's scene can stand in for. */
class MapRebuildTest {
    private fun region(zoneX: Int, zoneZ: Int, reload: Boolean = false, copy: (Int, Int) -> Int? = { x, z -> (x shl 14) or (z shl 3) }) =
        MapRebuild.Region(
            zoneX,
            zoneZ,
            reload,
            Array(4 * 13 * 13) { i ->
                val sx = (i / 13) % 13
                val sz = i % 13
                copy(zoneX - 6 + sx, zoneZ - 6 + sz)
            },
        )

    @Test
    fun `a scene a few zones over, of the same map, stays`() {
        assertTrue(MapRebuild.Normal(400, 400).canKeep(MapRebuild.Normal(400, 400)), "the same scene again (as after login)")
        assertTrue(MapRebuild.Normal(402, 397).canKeep(MapRebuild.Normal(400, 400)))
        assertTrue(region(1026, 2044).canKeep(region(1024, 2044)), "an instance, one step further")
    }

    @Test
    fun `a scene too far, of another map, or reloading is built`() {
        assertFalse(MapRebuild.Normal(404, 400).canKeep(MapRebuild.Normal(400, 400)), "near the old scene's edge")
        assertFalse(MapRebuild.Normal(400, 400).canKeep(null))
        assertFalse(region(400, 400).canKeep(MapRebuild.Normal(400, 400)), "into an instance")
        assertFalse(region(1024, 2044, copy = { _, _ -> 7 }).canKeep(region(1024, 2044)), "other template zones")
        assertFalse(region(1024, 2044, reload = true).canKeep(region(1024, 2044)), "tsps asked to reload")
    }

    /**
     * A REBUILD_REGION tsps sent in a Chambers of Xeric raid (PlayerSession, the Thieving room's
     * floor, Vasa Nistirio's room to its north). tsps asks every instance rebuild to reload, so the
     * gateway passes each one on, and the zones reach the client as tsps packed them.
     */
    @Test
    fun `a tsps raid rebuild is passed on with its template zones`() {
        val payload = Base64.getDecoder().decode(COX_REBUILD)
        val rebuild = MapRebuild.region(TspsPacket(TspsServerPacket.REBUILD_REGION, payload))
        assertEquals(1035, rebuild.zoneX)
        assertEquals(206, rebuild.zoneZ)
        assertFalse(rebuild.canKeep(rebuild), "even the same scene again is rebuilt")
        val zones = rebuild.toMessage().zones
        // Vasa's south-west zone: absolute zone 1032, 204 on level 3, copied from 416, 660 level 0.
        val vasa = requireNotNull(zones[3 * 169 + (1032 - 1029) * 13 + (204 - 200)])
        assertEquals(listOf(416, 660, 0, 0), listOf(vasa.zoneX, vasa.zoneZ, vasa.level, vasa.rotation))
    }

    private companion object {
        const val COX_REBUILD =
            "AM4BBAsACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACM+qlRnlUqM6qlRnFUrM4pLZnVJbM8pLZn1JYEZ9VSjPKqUZ1VSjOKqWZxSOzOqR2Z5SOzPqRwIz6q1GeVWozqq1GcVWszikNmdUhszykNmfUhgRn1CKM8oRRnVCKM4oRZnFP7M6p/ZnlP7M+p/AjPqFUZ5QqjOqFUZxQqzOKe2Z1T2zPKe2Z9T2BGfUMozyhlGdUMozihlmcU7szqndmeU7sz6ncCM+odRnlDqM6odRnFDrM4pzZnVObM8pzZn1OYEaBQ8jQKH0aBQ+jQKHkZxZejOrL0Z5ZejPrLwI0Ch1GgUPI0ChxGgUPIziytGdWVozyytGfWVgRoFDqNAofRoFDqNAofRnFk6M6snRnlk6M+snAjQKHkaBQ6jQKHEaBQ+jOLI0Z1ZGjPLI0Z9ZGAAAAAVn1Uqs8qlVnVUqs4qlRmVECMyokRmVFCMyosArPqqVZ5VSrOqqVZxVSjNKIEZpRIjNKKEZpRYBWfVWqzyq1WdVWqziq1GbUQIzaiRGbUUIzaiwCM2qBRmlQKMyqBRmFQKNApQRoFKiNApYRoFLgEZtUKjNKhUZlUKjMKhUaFSgjQqVEaFSwjQqXAIzaolGaVEozKolGYVEo0SlBGiUqI0SlhGiUuARm1RqM0qNRmVRqMwqNRo1KCNGpURo1LCNGpcAjQKHUaBQ8jQKHkaBQ4jNqEUZpQijMqEUZhQiBGgUPo0Ch5GgUOI0Ch1GbUKozShVGZUKozChUCNAoeRoFDyNAoeRoFDiM2oZRmlDKMyoZRmFDIEaBQ8jQKHEaBQ8jQKH0ZtQ6jNKHUZlQ6jMKHQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
    }
}
