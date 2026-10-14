package dev.pepino.ide.core.commands

interface Command {
    val id: String
    val title: String
    val description: String?
        get() = null

    suspend fun execute()
}

fun command(
    id: String,
    title: String,
    description: String? = null,
    action: suspend () -> Unit,
): Command =
    object : Command {
        override val id: String = id
        override val title: String = title
        override val description: String? = description

        override suspend fun execute() = action()
    }
