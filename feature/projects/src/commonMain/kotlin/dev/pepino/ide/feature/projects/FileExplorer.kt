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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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
    var pathStack by remember(rootPath) { mutableStateOf(listOf(rootPath)) }
    val currentPath = pathStack.last()
    var sortOrder by remember { mutableStateOf(FileSortOrder.NAME) }
    var listing by remember { mutableStateOf<Result<List<FileEntry>>?>(null) }
    var refreshTick by remember { mutableIntStateOf(0) }
    var dialog by remember { mutableStateOf<ExplorerDialog?>(null) }
    var opError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(currentPath, refreshTick) {
        listing = null
        listing = withContext(Dispatchers.Default) { projectSpace.listDirectory(currentPath) }
    }

    val entries = listing?.getOrNull().orEmpty().sortedForExplorer(sortOrder)
    val error = listing?.exceptionOrNull()

    fun runOperation(operation: () -> Result<Unit>) {
        scope.launch {
            val result = withContext(Dispatchers.Default) { operation() }
            result
                .onSuccess {
                    opError = null
                    refreshTick++
                }.onFailure { opError = it.message }
        }
    }

    Column(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        ExplorerToolbar(
            canGoUp = pathStack.size > 1,
            segments = pathStack.drop(1).map { it.substringAfterLast('/') },
            sortOrder = sortOrder,
            onUp = { pathStack = pathStack.dropLast(1) },
            onCycleSort = { sortOrder = sortOrder.next() },
            onCreate = { dialog = ExplorerDialog.Create },
        )
        HorizontalDivider()
        opError?.let { message ->
            Text(
                "ERROR: ${message.uppercase()}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.error,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
            )
            HorizontalDivider()
        }
        when {
            listing == null -> ExplorerMessage("LOADING…")
            error != null -> ExplorerMessage("CAN'T READ FOLDER\n${error.message.orEmpty()}")
            entries.isEmpty() -> ExplorerMessage("EMPTY FOLDER")
            else ->
                LazyColumn(Modifier.fillMaxSize()) {
                    items(entries, key = { it.path }) { entry ->
                        FileRow(
                            entry = entry,
                            onOpen = { if (entry.isDirectory) pathStack = pathStack + entry.path },
                            onActions = { dialog = ExplorerDialog.Actions(entry) },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                    }
                }
        }
    }

    when (val active = dialog) {
        null -> Unit
        ExplorerDialog.Create ->
            CreateEntryDialog(
                onDismiss = { dialog = null },
                onCreate = { asDirectory, name ->
                    dialog = null
                    runOperation {
                        val path = "$currentPath/$name"
                        if (asDirectory) {
                            projectSpace.createDirectory(path)
                        } else {
                            projectSpace.createFile(path)
                        }
                    }
                },
            )

        is ExplorerDialog.Actions ->
            EntryActionsDialog(
                entry = active.entry,
                onDismiss = { dialog = null },
                onAction = { dialog = it },
            )

        is ExplorerDialog.Rename ->
            RenameEntryDialog(
                entry = active.entry,
                onDismiss = { dialog = null },
                onRename = { newName ->
                    dialog = null
                    runOperation { projectSpace.rename(active.entry.path, newName) }
                },
            )

        is ExplorerDialog.Delete ->
            DeleteEntryDialog(
                entry = active.entry,
                onDismiss = { dialog = null },
                onConfirm = {
                    dialog = null
                    runOperation { projectSpace.delete(active.entry.path) }
                },
            )

        is ExplorerDialog.Transfer ->
            TransferDialog(
                entry = active.entry,
                move = active.move,
                projectSpace = projectSpace,
                onDismiss = { dialog = null },
                onConfirm = { destinationDir ->
                    dialog = null
                    runOperation {
                        if (active.move) {
                            projectSpace.move(active.entry.path, destinationDir)
                        } else {
                            projectSpace.copy(active.entry.path, destinationDir)
                        }
                    }
                },
            )
    }
}

@Composable
private fun ExplorerToolbar(
    canGoUp: Boolean,
    segments: List<String>,
    sortOrder: FileSortOrder,
    onUp: () -> Unit,
    onCycleSort: () -> Unit,
    onCreate: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ToolbarButton(text = "UP", enabled = canGoUp, onClick = onUp)
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
        ToolbarButton(text = "+", onClick = onCreate)
        Box(Modifier.size(8.dp))
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
    onActions: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = TouchTarget)
            .padding(start = 16.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(32.dp)
                .border(1.dp, MaterialTheme.colorScheme.outline)
                .clickable(enabled = entry.isDirectory, onClick = onOpen),
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
        Column(
            Modifier
                .weight(1f)
                .clickable(enabled = entry.isDirectory, onClick = onOpen)
                .padding(start = 16.dp),
        ) {
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
        Box(
            Modifier
                .size(TouchTarget)
                .clickable(onClick = onActions),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "···",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.outline,
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
