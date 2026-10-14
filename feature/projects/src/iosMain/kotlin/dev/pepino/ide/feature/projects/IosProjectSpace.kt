package dev.pepino.ide.feature.projects

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSDate
import platform.Foundation.NSDocumentDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSFileModificationDate
import platform.Foundation.NSFileSize
import platform.Foundation.NSFileType
import platform.Foundation.NSFileTypeDirectory
import platform.Foundation.NSNumber
import platform.Foundation.NSString
import platform.Foundation.NSURL
import platform.Foundation.NSUserDomainMask
import platform.Foundation.lastPathComponent
import platform.Foundation.stringByAppendingPathComponent
import platform.Foundation.stringByDeletingLastPathComponent
import platform.Foundation.stringByStandardizingPath
import platform.Foundation.timeIntervalSince1970

private const val MILLIS_PER_SECOND = 1000.0

@OptIn(ExperimentalForeignApi::class)
class IosProjectSpace : ProjectSpace {
    override val rootPath: String by lazy {
        val urls = NSFileManager.defaultManager.URLsForDirectory(NSDocumentDirectory, NSUserDomainMask)
        val documents = urls.first() as NSURL
        documents.URLByAppendingPathComponent("projects")!!.path!!
    }

    override fun ensureCreated(): Result<Unit> =
        runCatching {
            NSFileManager.defaultManager.createDirectoryAtPath(
                path = rootPath,
                withIntermediateDirectories = true,
                attributes = null,
                error = null,
            )
        }

    override fun listDirectory(path: String): Result<List<FileEntry>> =
        runCatching {
            val dir = sandboxed(path)
            val manager = NSFileManager.defaultManager
            val names =
                manager.contentsOfDirectoryAtPath(dir, error = null)
                    ?: error("Cannot list directory: $path")
            names.mapNotNull { item ->
                val name = item as String
                val childPath = (dir as NSString).stringByAppendingPathComponent(name)
                val attributes =
                    manager.attributesOfItemAtPath(childPath, error = null)
                        ?: return@mapNotNull null
                val modified = attributes[NSFileModificationDate] as? NSDate
                FileEntry(
                    name = name,
                    path = childPath,
                    isDirectory = attributes[NSFileType] == NSFileTypeDirectory,
                    sizeBytes = (attributes[NSFileSize] as? NSNumber)?.longLongValue ?: 0L,
                    lastModifiedMillis = ((modified?.timeIntervalSince1970 ?: 0.0) * MILLIS_PER_SECOND).toLong(),
                )
            }
        }

    override fun createFile(path: String): Result<Unit> =
        runCatching {
            val target = sandboxed(path)
            require(isValidEntryName((target as NSString).lastPathComponent)) { "Invalid name: $path" }
            val manager = NSFileManager.defaultManager
            require(!manager.fileExistsAtPath(target)) { "Already exists: $path" }
            check(manager.createFileAtPath(target, contents = null, attributes = null)) {
                "Cannot create file: $path"
            }
        }

    override fun createDirectory(path: String): Result<Unit> =
        runCatching {
            val target = sandboxed(path)
            require(isValidEntryName((target as NSString).lastPathComponent)) { "Invalid name: $path" }
            val manager = NSFileManager.defaultManager
            require(!manager.fileExistsAtPath(target)) { "Already exists: $path" }
            check(
                manager.createDirectoryAtPath(
                    path = target,
                    withIntermediateDirectories = false,
                    attributes = null,
                    error = null,
                ),
            ) { "Cannot create folder: $path" }
        }

    override fun rename(
        path: String,
        newName: String,
    ): Result<Unit> =
        runCatching {
            val source = sandboxed(path)
            val manager = NSFileManager.defaultManager
            require(manager.fileExistsAtPath(source)) { "Not found: $path" }
            require(isValidEntryName(newName)) { "Invalid name: $newName" }
            val parent = (source as NSString).stringByDeletingLastPathComponent
            val target = (parent as NSString).stringByAppendingPathComponent(newName.trim())
            require(!manager.fileExistsAtPath(target)) { "Already exists: $newName" }
            check(manager.moveItemAtPath(source, target, error = null)) { "Cannot rename: $path" }
        }

    override fun move(
        source: String,
        destinationDir: String,
    ): Result<Unit> =
        runCatching {
            val src = sandboxed(source)
            val destDir = sandboxed(destinationDir)
            val manager = NSFileManager.defaultManager
            require(manager.fileExistsAtPath(src)) { "Not found: $source" }
            requireDirectory(manager, destDir, destinationDir)
            val target = transferTarget(manager, src, destDir, "move")
            check(manager.moveItemAtPath(src, target, error = null)) { "Cannot move: $source" }
        }

    override fun copy(
        source: String,
        destinationDir: String,
    ): Result<Unit> =
        runCatching {
            val src = sandboxed(source)
            val destDir = sandboxed(destinationDir)
            val manager = NSFileManager.defaultManager
            require(manager.fileExistsAtPath(src)) { "Not found: $source" }
            requireDirectory(manager, destDir, destinationDir)
            val target = transferTarget(manager, src, destDir, "copy")
            check(manager.copyItemAtPath(src, target, error = null)) { "Cannot copy: $source" }
        }

    override fun delete(path: String): Result<Unit> =
        runCatching {
            val target = sandboxed(path)
            val manager = NSFileManager.defaultManager
            require(manager.fileExistsAtPath(target)) { "Not found: $path" }
            check(manager.removeItemAtPath(target, error = null)) { "Cannot delete: $path" }
        }

    private fun sandboxed(path: String): String {
        val root = (rootPath as NSString).stringByStandardizingPath
        val target = (path as NSString).stringByStandardizingPath
        require(target == root || target.startsWith("$root/")) {
            "Path escapes project space: $path"
        }
        return target
    }

    private fun requireDirectory(
        manager: NSFileManager,
        dir: String,
        originalPath: String,
    ) {
        val attributes = manager.attributesOfItemAtPath(dir, error = null)
        require(attributes != null && attributes[NSFileType] == NSFileTypeDirectory) {
            "Not a directory: $originalPath"
        }
    }

    private fun transferTarget(
        manager: NSFileManager,
        src: String,
        destDir: String,
        verb: String,
    ): String {
        val name = (src as NSString).lastPathComponent
        val target = (destDir as NSString).stringByAppendingPathComponent(name)
        require(target != src && !target.startsWith("$src/")) { "Cannot $verb a folder into itself" }
        require(!manager.fileExistsAtPath(target)) { "Already exists: $name" }
        return target
    }
}
