package dev.pepino.ide.feature.projects

import android.content.Context
import java.io.File

class AndroidProjectSpace(context: Context) : ProjectSpace {
    private val root = File(context.filesDir, "projects")

    override val rootPath: String = root.absolutePath

    override fun ensureCreated(): Result<Unit> =
        runCatching {
            check(root.exists() || root.mkdirs()) { "Cannot create $rootPath" }
            check(root.isDirectory && root.canWrite()) { "Projects space not writable: $rootPath" }
        }

    override fun listDirectory(path: String): Result<List<FileEntry>> =
        runCatching {
            val dir = sandboxed(path)
            require(dir.isDirectory) { "Not a directory: $path" }
            dir.listFiles()
                ?.map { file ->
                    FileEntry(
                        name = file.name,
                        path = file.path,
                        isDirectory = file.isDirectory,
                        sizeBytes = if (file.isDirectory) 0L else file.length(),
                        lastModifiedMillis = file.lastModified(),
                    )
                }
                ?: error("Cannot list directory: $path")
        }

    override fun createFile(path: String): Result<Unit> =
        runCatching {
            val target = sandboxed(path)
            require(isValidEntryName(target.name)) { "Invalid name: ${target.name}" }
            require(!target.exists()) { "Already exists: ${target.name}" }
            check(target.createNewFile()) { "Cannot create file: $path" }
        }

    override fun createDirectory(path: String): Result<Unit> =
        runCatching {
            val target = sandboxed(path)
            require(isValidEntryName(target.name)) { "Invalid name: ${target.name}" }
            require(!target.exists()) { "Already exists: ${target.name}" }
            check(target.mkdir()) { "Cannot create folder: $path" }
        }

    override fun rename(
        path: String,
        newName: String,
    ): Result<Unit> =
        runCatching {
            val source = sandboxed(path)
            require(source.exists()) { "Not found: $path" }
            require(isValidEntryName(newName)) { "Invalid name: $newName" }
            val target = File(source.parentFile, newName.trim())
            require(!target.exists()) { "Already exists: $newName" }
            check(source.renameTo(target)) { "Cannot rename: $path" }
        }

    override fun move(
        source: String,
        destinationDir: String,
    ): Result<Unit> =
        runCatching {
            val src = sandboxed(source)
            val destDir = sandboxed(destinationDir)
            require(src.exists()) { "Not found: $source" }
            require(destDir.isDirectory) { "Not a directory: $destinationDir" }
            val target = File(destDir, src.name).canonicalFile
            require(target.path != src.path && !target.path.startsWith(src.path + File.separator)) {
                "Cannot move a folder into itself"
            }
            require(!target.exists()) { "Already exists: ${src.name}" }
            check(src.renameTo(target)) { "Cannot move: $source" }
        }

    override fun copy(
        source: String,
        destinationDir: String,
    ): Result<Unit> =
        runCatching {
            val src = sandboxed(source)
            val destDir = sandboxed(destinationDir)
            require(src.exists()) { "Not found: $source" }
            require(destDir.isDirectory) { "Not a directory: $destinationDir" }
            val target = File(destDir, src.name).canonicalFile
            require(target.path != src.path && !target.path.startsWith(src.path + File.separator)) {
                "Cannot copy a folder into itself"
            }
            require(!target.exists()) { "Already exists: ${src.name}" }
            check(src.copyRecursively(target, overwrite = false)) { "Cannot copy: $source" }
        }

    override fun delete(path: String): Result<Unit> =
        runCatching {
            val target = sandboxed(path)
            require(target.exists()) { "Not found: $path" }
            check(target.deleteRecursively()) { "Cannot delete: $path" }
        }

    private fun sandboxed(path: String): File {
        val rootCanonical = root.canonicalFile.path
        val file = File(path).canonicalFile
        require(file.path == rootCanonical || file.path.startsWith(rootCanonical + File.separator)) {
            "Path escapes project space: $path"
        }
        return file
    }
}
