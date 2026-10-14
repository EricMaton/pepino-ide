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
            val rootCanonical = root.canonicalFile.path
            val dir = File(path).canonicalFile
            require(dir.path == rootCanonical || dir.path.startsWith(rootCanonical + File.separator)) {
                "Path escapes project space: $path"
            }
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
}
