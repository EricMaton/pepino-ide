package dev.pepino.ide.core.commands

class CommandRegistry {
    private val commands = LinkedHashMap<String, Command>()

    val all: List<Command>
        get() = commands.values.toList()

    fun register(command: Command) {
        require(!commands.containsKey(command.id)) { "Duplicate command id: ${command.id}" }
        commands[command.id] = command
    }

    fun unregister(id: String): Boolean = commands.remove(id) != null

    fun find(id: String): Command? = commands[id]
}
