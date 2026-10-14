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
import platform.Foundation.stringByAppendingPathComponent
import platform.Foundation.stringByStandardizingPath

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
            val root = (rootPath as NSString).stringByStandardizingPath
            val dir = (path as NSString).stringByStandardizingPath
            require(dir == root || dir.startsWith("$root/")) {
                "Path escapes project space: $path"
            }
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
}
