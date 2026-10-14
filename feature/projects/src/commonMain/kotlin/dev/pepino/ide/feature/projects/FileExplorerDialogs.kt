package dev.pepino.ide.feature.projects

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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

private val TouchTarget = 48.dp
private val FolderListMaxHeight = 280.dp

internal sealed interface ExplorerDialog {
    data object Create : ExplorerDialog

    data class Actions(val entry: FileEntry) : ExplorerDialog

    data class Rename(val entry: FileEntry) : ExplorerDialog

    data class Delete(val entry: FileEntry) : ExplorerDialog

    data class Transfer(
        val entry: FileEntry,
        val move: Boolean,
    ) : ExplorerDialog
}

@Composable
internal fun CreateEntryDialog(
    onDismiss: () -> Unit,
    onCreate: (asDirectory: Boolean, name: String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    val valid = isValidEntryName(name)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("CREATE", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    singleLine = true,
                    label = { Text("NAME") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (name.isNotEmpty() && !valid) {
                    Text(
                        "INVALID NAME",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = { onCreate(false, name.trim()) }, enabled = valid) {
                    Text("FILE", style = MaterialTheme.typography.labelLarge)
                }
                TextButton(onClick = { onCreate(true, name.trim()) }, enabled = valid) {
                    Text("FOLDER", style = MaterialTheme.typography.labelLarge)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", style = MaterialTheme.typography.labelLarge)
            }
        },
    )
}

@Composable
internal fun RenameEntryDialog(
    entry: FileEntry,
    onDismiss: () -> Unit,
    onRename: (newName: String) -> Unit,
) {
    var name by remember { mutableStateOf(entry.name) }
    val valid = isValidEntryName(name)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("RENAME", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    singleLine = true,
                    label = { Text("NAME") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (name.isNotEmpty() && !valid) {
                    Text(
                        "INVALID NAME",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onRename(name.trim()) }, enabled = valid) {
                Text("RENAME", style = MaterialTheme.typography.labelLarge)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", style = MaterialTheme.typography.labelLarge)
            }
        },
    )
}

@Composable
internal fun DeleteEntryDialog(
    entry: FileEntry,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("DELETE?", style = MaterialTheme.typography.titleLarge) },
        text = {
            Text(
                if (entry.isDirectory) {
                    "${entry.name} IS A FOLDER.\nEVERYTHING INSIDE IT WILL BE DELETED."
                } else {
                    entry.name
                },
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(
                    "DELETE",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", style = MaterialTheme.typography.labelLarge)
            }
        },
    )
}

@Composable
internal fun EntryActionsDialog(
    entry: FileEntry,
    onDismiss: () -> Unit,
    onAction: (ExplorerDialog) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                entry.name,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        text = {
            Column {
                ActionButton("RENAME") { onAction(ExplorerDialog.Rename(entry)) }
                ActionButton("MOVE") { onAction(ExplorerDialog.Transfer(entry, move = true)) }
                ActionButton("COPY") { onAction(ExplorerDialog.Transfer(entry, move = false)) }
                ActionButton("DELETE") { onAction(ExplorerDialog.Delete(entry)) }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", style = MaterialTheme.typography.labelLarge)
            }
        },
    )
}

@Composable
private fun ActionButton(
    label: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = TouchTarget)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
internal fun TransferDialog(
    entry: FileEntry,
    move: Boolean,
    projectSpace: ProjectSpace,
    onDismiss: () -> Unit,
    onConfirm: (destinationDir: String) -> Unit,
) {
    val rootPath = projectSpace.rootPath
    var pickStack by remember { mutableStateOf(listOf(rootPath)) }
    val pickPath = pickStack.last()
    var listing by remember { mutableStateOf<Result<List<FileEntry>>?>(null) }

    LaunchedEffect(pickPath) {
        listing = withContext(Dispatchers.Default) { projectSpace.listDirectory(pickPath) }
    }

    val folders =
        listing
            ?.getOrNull()
            .orEmpty()
            .filter { it.isDirectory && it.path != entry.path }
            .sortedForExplorer(FileSortOrder.NAME)
    val canGoUp = pickStack.size > 1
    val segments = pickStack.drop(1).map { it.substringAfterLast('/') }
    val verb = if (move) "MOVE" else "COPY"

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                "$verb — ${entry.name}",
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        text = {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { pickStack = pickStack.dropLast(1) }, enabled = canGoUp) {
                        Text("UP", style = MaterialTheme.typography.labelLarge)
                    }
                    Text(
                        (listOf("ROOT") + segments).joinToString(" / "),
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = FontFamily.Monospace,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
                HorizontalDivider()
                when {
                    listing == null ->
                        Text(
                            "LOADING…",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.outline,
                            modifier = Modifier.padding(16.dp),
                        )

                    listing?.isFailure == true ->
                        Text(
                            "CAN'T READ FOLDER",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(16.dp),
                        )

                    folders.isEmpty() ->
                        Text(
                            "NO SUBFOLDERS",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.outline,
                            modifier = Modifier.padding(16.dp),
                        )

                    else ->
                        LazyColumn(Modifier.heightIn(max = FolderListMaxHeight)) {
                            items(folders, key = { it.path }) { folder ->
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .heightIn(min = TouchTarget)
                                        .clickable { pickStack = pickStack + folder.path }
                                        .padding(horizontal = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        "/ ",
                                        style = MaterialTheme.typography.titleLarge,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    Text(
                                        folder.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(pickPath) }) {
                Text("$verb HERE", style = MaterialTheme.typography.labelLarge)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCEL", style = MaterialTheme.typography.labelLarge)
            }
        },
    )
}
