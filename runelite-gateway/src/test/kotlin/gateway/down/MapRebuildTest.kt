package gateway.down

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

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
}
