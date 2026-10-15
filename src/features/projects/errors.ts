export type ProjectSpaceErrorCode =
  'NotFound' | 'AlreadyExists' | 'InvalidName' | 'NotADirectory' | 'IsADirectory' | 'EscapesRoot' | 'IntoItself' | 'Io';

export class ProjectSpaceError extends Error {
  constructor(
    readonly code: ProjectSpaceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectSpaceError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
