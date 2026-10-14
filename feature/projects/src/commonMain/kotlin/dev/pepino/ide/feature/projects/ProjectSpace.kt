package dev.pepino.ide.feature.projects

interface ProjectSpace {
    val rootPath: String

    fun ensureCreated(): Result<Unit>
}
