package dev.pepino.ide.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

private val TouchTarget = 48.dp
private const val BYTES_PER_UNIT = 1024.0
private val SizeUnits = listOf("B", "KB", "MB", "GB", "TB")

@Composable
fun FileExplorer(
    projectSpace: ProjectSpace,
    modifier: Modifier = Modifier,
) {
    val rootPath = projectSpace.rootPath
    var currentPath by remember(rootPath) { mutableStateOf(rootPath) }
    var sortOrder by remember { mutableStateOf(FileSortOrder.NAME) }
    var listing by remember { mutableStateOf<Result<List<FileEntry>>?>(null) }

    LaunchedEffect(currentPath) {
        listing = null
        listing = withContext(Dispatchers.Default) { projectSpace.listDirectory(currentPath) }
    }

    val entries = listing?.getOrNull().orEmpty().sortedForExplorer(sortOrder)
    val error = listing?.exceptionOrNull()

    Column(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        ExplorerToolbar(
            currentPath = currentPath,
            rootPath = rootPath,
            sortOrder = sortOrder,
            onUp = { currentPath = currentPath.substringBeforeLast('/') },
            onCycleSort = { sortOrder = sortOrder.next() },
        )
        HorizontalDivider()
        when {
            listing == null -> ExplorerMessage("LOADING…")
            error != null -> ExplorerMessage("CAN'T READ FOLDER\n${error.message.orEmpty()}")
            entries.isEmpty() -> ExplorerMessage("EMPTY FOLDER")
            else ->
                LazyColumn(Modifier.fillMaxSize()) {
                    items(entries, key = { it.path }) { entry ->
                        FileRow(
                            entry = entry,
                            onOpen = { if (entry.isDirectory) currentPath = entry.path },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                    }
                }
        }
    }
}

@Composable
private fun ExplorerToolbar(
    currentPath: String,
    rootPath: String,
    sortOrder: FileSortOrder,
    onUp: () -> Unit,
    onCycleSort: () -> Unit,
) {
    val isAtRoot = currentPath == rootPath
    val segments = currentPath.removePrefix(rootPath).split('/').filter { it.isNotEmpty() }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ToolbarButton(text = "UP", enabled = !isAtRoot, onClick = onUp)
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 16.dp),
        ) {
            Text(
                "LOCATION",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.outline,
            )
            Text(
                (listOf("ROOT") + segments).joinToString(" / "),
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        ToolbarButton(text = "SORT: ${sortOrder.label}", onClick = onCycleSort)
    }
}

@Composable
private fun ToolbarButton(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    val color =
        if (enabled) {
            MaterialTheme.colorScheme.onBackground
        } else {
            MaterialTheme.colorScheme.outline
        }
    Box(
        Modifier
            .heightIn(min = TouchTarget)
            .border(1.dp, color)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = color)
    }
}

@Composable
private fun FileRow(
    entry: FileEntry,
    onOpen: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = TouchTarget)
            .clickable(enabled = entry.isDirectory, onClick = onOpen)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(32.dp)
                .border(1.dp, MaterialTheme.colorScheme.outline),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = if (entry.isDirectory) "/" else "·",
                style = MaterialTheme.typography.titleLarge,
                color =
                    if (entry.isDirectory) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.outline
                    },
            )
        }
        Column(Modifier.padding(start = 16.dp)) {
            Text(
                entry.name,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOfNotNull(
                    if (entry.isDirectory) "FOLDER" else formatSize(entry.sizeBytes),
                    formatModified(entry.lastModifiedMillis),
                ).joinToString("  ·  "),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.outline,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ExplorerMessage(text: String) {
    Box(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.outline,
        )
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes < BYTES_PER_UNIT) return "$bytes B"
    var value = bytes.toDouble()
    var unit = 0
    while (value >= BYTES_PER_UNIT && unit < SizeUnits.lastIndex) {
        value /= BYTES_PER_UNIT
        unit++
    }
    val rounded = (value * 10).toInt() / 10.0
    return "$rounded ${SizeUnits[unit]}"
}

private fun formatModified(millis: Long): String {
    val dateTime =
        Instant
            .fromEpochMilliseconds(millis)
            .toLocalDateTime(TimeZone.currentSystemDefault())
    val date = "${dateTime.year}-${pad(dateTime.monthNumber)}-${pad(dateTime.dayOfMonth)}"
    val time = "${pad(dateTime.hour)}:${pad(dateTime.minute)}"
    return "$date $time"
}

private fun pad(value: Int): String = value.toString().padStart(2, '0')
