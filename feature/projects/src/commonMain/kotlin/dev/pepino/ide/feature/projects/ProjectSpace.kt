package dev.pepino.ide.feature.projects

interface ProjectSpace {
    val rootPath: String

    fun ensureCreated(): Result<Unit>

    /**
     * Lists the direct children of [path]. Fails if [path] escapes the
     * project space root or is not a directory. Entries are unsorted.
     */
    fun listDirectory(path: String): Result<List<FileEntry>>

    /** Creates an empty file at [path]. Fails if it already exists. */
    fun createFile(path: String): Result<Unit>

    /** Creates a directory at [path]. Fails if it already exists. */
    fun createDirectory(path: String): Result<Unit>

    /** Renames [path] to [newName], keeping it in the same directory. */
    fun rename(
        path: String,
        newName: String,
    ): Result<Unit>

    /** Moves [source] into [destinationDir], keeping its name. */
    fun move(
        source: String,
        destinationDir: String,
    ): Result<Unit>

    /** Copies [source] into [destinationDir] (recursively for directories). */
    fun copy(
        source: String,
        destinationDir: String,
    ): Result<Unit>

    /** Deletes [path] (recursively for directories). */
    fun delete(path: String): Result<Unit>
}
