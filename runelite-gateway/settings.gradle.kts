rootProject.name = "tsps-gateway"

// The headless test client decodes server packets with RSProx's revision-241 protocol module,
// which isn't published; build it from a pinned commit.
val rsproxCommit = "d5493fb7"
val rsprox = file("build/rsprox")
if (!rsprox.resolve(".git").exists()) {
    exec { commandLine("git", "clone", "-q", "--filter=blob:none", "https://github.com/blurite/rsprox.git", rsprox.path) }
}
exec { commandLine("git", "-C", rsprox.path, "checkout", "-q", rsproxCommit) }
includeBuild(rsprox) {
    dependencySubstitution {
        substitute(module("net.rsprox:osrs-241")).using(project(":protocol:osrs-241"))
        substitute(module("net.rsprox:protocol")).using(project(":protocol"))
        substitute(module("net.rsprox:cache-api")).using(project(":cache:cache-api"))
    }
}
