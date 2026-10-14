package dev.pepino.ide.feature.projects

data class FileEntry(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val sizeBytes: Long,
    val lastModifiedMillis: Long,
)

enum class FileSortOrder(val label: String) {
    NAME("A-Z"),
    SIZE("SIZE"),
    MODIFIED("MODIFIED"),
    ;

    fun next(): FileSortOrder = entries[(ordinal + 1) % entries.size]
}

fun isValidEntryName(name: String): Boolean {
    val trimmed = name.trim()
    return trimmed.isNotEmpty() && trimmed != "." && trimmed != ".." && trimmed.none { it == '/' || it == '\\' }
}

fun List<FileEntry>.sortedForExplorer(order: FileSortOrder): List<FileEntry> {
    val byKey =
        when (order) {
            FileSortOrder.NAME ->
                compareBy<FileEntry> { it.name.lowercase() }

            FileSortOrder.SIZE ->
                compareByDescending<FileEntry> { it.sizeBytes }
                    .thenBy { it.name.lowercase() }

            FileSortOrder.MODIFIED ->
                compareByDescending<FileEntry> { it.lastModifiedMillis }
                    .thenBy { it.name.lowercase() }
        }
    return sortedWith(compareByDescending<FileEntry> { it.isDirectory }.then(byKey))
}
