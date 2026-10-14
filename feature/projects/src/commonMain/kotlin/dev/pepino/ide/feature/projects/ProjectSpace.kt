package dev.pepino.ide.feature.projects

interface ProjectSpace {
    val rootPath: String

    fun ensureCreated(): Result<Unit>

    /**
     * Lists the direct children of [path]. Fails if [path] escapes the
     * project space root or is not a directory. Entries are unsorted.
     */
    fun listDirectory(path: String): Result<List<FileEntry>>
}
