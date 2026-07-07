export class JamioError extends Error {
  constructor(
    message: string,
    readonly code = "JAMIO_ERROR"
  ) {
    super(message);
    this.name = "JamioError";
  }
}

export function assertJamio(condition: unknown, message: string, code?: string): asserts condition {
  if (!condition) {
    throw new JamioError(message, code);
  }
}
