package dev.pepino.ide

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.pepino.ide.core.commands.CommandDispatcher
import dev.pepino.ide.core.commands.CommandRegistry
import dev.pepino.ide.core.commands.command
import dev.pepino.ide.core.events.EventBus
import dev.pepino.ide.core.events.events
import dev.pepino.ide.feature.projects.FileExplorer
import dev.pepino.ide.feature.projects.ProjectSpace
import dev.pepino.ide.feature.settings.theme.PepinoRed
import dev.pepino.ide.feature.settings.theme.PepinoTheme
import kotlinx.coroutines.launch

data class CounterChanged(val count: Int)

@Composable
fun App(projectSpace: ProjectSpace) {
    val snackbarHostState = remember { SnackbarHostState() }
    var invocationCount by remember { mutableIntStateOf(0) }
    var paletteOpen by remember { mutableStateOf(false) }
    var spaceReady by remember { mutableStateOf<Boolean?>(null) }
    val scope = rememberCoroutineScope()
    val eventBus = remember { EventBus() }

    LaunchedEffect(Unit) {
        spaceReady = projectSpace.ensureCreated().isSuccess
        eventBus.events<CounterChanged>().collect { event ->
            snackbarHostState.showSnackbar("Counter is now ${event.count}")
        }
    }

    val registry =
        remember {
            CommandRegistry().apply {
                register(
                    command(id = "demo.hello", title = "Say hello") {
                        snackbarHostState.showSnackbar("Hello from Pepino 🥒")
                    },
                )
                register(
                    command(id = "demo.count", title = "Increment counter") {
                        invocationCount++
                        eventBus.publish(CounterChanged(invocationCount))
                    },
                )
            }
        }
    val dispatcher = remember { CommandDispatcher(registry) }

    PepinoTheme {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            floatingActionButton = {
                ExtendedFloatingActionButton(onClick = { paletteOpen = true }) {
                    Text("COMMANDS", style = MaterialTheme.typography.labelLarge)
                }
            },
        ) { padding ->
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .background(PepinoRed),
                )
                Column(
                    Modifier.padding(horizontal = 24.dp, vertical = 16.dp),
                ) {
                    Text(
                        "PEPINO",
                        style = MaterialTheme.typography.headlineLarge,
                    )
                    Text(
                        "MOBILE IDE",
                        style = MaterialTheme.typography.labelLarge,
                        color = PepinoRed,
                    )
                }
                HorizontalDivider()
                when (spaceReady) {
                    true -> FileExplorer(projectSpace, Modifier.fillMaxSize())
                    else ->
                        Text(
                            when (spaceReady) {
                                null -> "CREATING PROJECT SPACE…"
                                else -> "● PROJECT SPACE ERROR"
                            },
                            style = MaterialTheme.typography.labelLarge,
                            color = if (spaceReady == false) PepinoRed else MaterialTheme.colorScheme.outline,
                            modifier = Modifier.padding(24.dp),
                        )
                }
            }

            if (paletteOpen) {
                AlertDialog(
                    onDismissRequest = { paletteOpen = false },
                    title = {
                        Text(
                            "COMMAND PALETTE",
                            style = MaterialTheme.typography.titleLarge,
                        )
                    },
                    text = {
                        Column {
                            registry.all.forEach { cmd ->
                                TextButton(
                                    onClick = {
                                        paletteOpen = false
                                        scope.launch {
                                            dispatcher.execute(cmd.id).onFailure { error ->
                                                snackbarHostState.showSnackbar(
                                                    "Error: ${error.message}",
                                                )
                                            }
                                        }
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(
                                        cmd.title.uppercase(),
                                        style = MaterialTheme.typography.labelLarge,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = { paletteOpen = false }) {
                            Text("CLOSE", style = MaterialTheme.typography.labelLarge)
                        }
                    },
                )
            }
        }
    }
}
