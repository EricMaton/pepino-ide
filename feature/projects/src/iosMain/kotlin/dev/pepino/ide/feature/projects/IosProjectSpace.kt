package dev.pepino.ide.feature.projects

import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSDocumentDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSURL
import platform.Foundation.NSUserDomainMask

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
}
