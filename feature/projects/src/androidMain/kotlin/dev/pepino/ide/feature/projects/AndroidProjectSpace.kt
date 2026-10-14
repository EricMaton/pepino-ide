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
}
