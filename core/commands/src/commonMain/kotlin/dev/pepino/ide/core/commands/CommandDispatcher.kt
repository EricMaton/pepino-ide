package dev.pepino.ide.core.commands

class CommandDispatcher(private val registry: CommandRegistry) {
    suspend fun execute(id: String): Result<Unit> {
        val command =
            registry.find(id)
                ?: return Result.failure(CommandNotFoundException(id))
        return runCatching { command.execute() }
    }
}

class CommandNotFoundException(id: String) : Exception("Command not found: $id")
