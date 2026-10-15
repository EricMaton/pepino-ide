export interface Command {
  id: string;
  title: string;
  run: () => void | Promise<void>;
  /** Not listed in the command palette (e.g. one-key toolbar actions); still runnable by id. */
  hidden?: boolean;
}

export class UnknownCommandError extends Error {
  constructor(readonly commandId: string) {
    super(`Unknown command: ${commandId}`);
    this.name = 'UnknownCommandError';
  }
}

/** Commands in registration order. Plugins and the UI only talk to each other through here. */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  get all(): Command[] {
    return [...this.commands.values()];
  }

  /** Registers [command] and returns a disposer that unregisters it. */
  register(command: Command): () => void {
    if (this.commands.has(command.id)) {
      throw new Error(`Duplicate command id: ${command.id}`);
    }
    this.commands.set(command.id, command);
    return () => {
      if (this.commands.get(command.id) === command) this.commands.delete(command.id);
    };
  }

  unregister(id: string): boolean {
    return this.commands.delete(id);
  }

  find(id: string): Command | undefined {
    return this.commands.get(id);
  }
}

/**
 * Runs commands by id. Failures reject the returned promise (unknown ids with
 * [UnknownCommandError], anything else as thrown by the command); callers show them.
 */
export class CommandDispatcher {
  constructor(private readonly registry: CommandRegistry) {}

  async execute(id: string): Promise<void> {
    const command = this.registry.find(id);
    if (!command) throw new UnknownCommandError(id);
    await command.run();
  }
}
