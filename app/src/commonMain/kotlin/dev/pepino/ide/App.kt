package dev.pepino.ide

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import dev.pepino.ide.core.commands.CommandDispatcher
import dev.pepino.ide.core.commands.CommandRegistry
import dev.pepino.ide.core.commands.command
import dev.pepino.ide.core.events.EventBus
import dev.pepino.ide.core.events.events
import kotlinx.coroutines.launch

data class CounterChanged(val count: Int)

@Composable
fun App() {
    val snackbarHostState = remember { SnackbarHostState() }
    var invocationCount by remember { mutableIntStateOf(0) }
    var paletteOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val eventBus = remember { EventBus() }

    LaunchedEffect(Unit) {
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

    MaterialTheme {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            floatingActionButton = {
                ExtendedFloatingActionButton(onClick = { paletteOpen = true }) {
                    Text("Commands")
                }
            },
        ) { padding ->
            Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Text("🥒 Pepino — commands run: $invocationCount")
            }

            if (paletteOpen) {
                AlertDialog(
                    onDismissRequest = { paletteOpen = false },
                    title = { Text("Command palette") },
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
                                    Text(cmd.title)
                                }
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = { paletteOpen = false }) {
                            Text("Close")
                        }
                    },
                )
            }
        }
    }
}
