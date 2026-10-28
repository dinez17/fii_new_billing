export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Unauthorized") =>
  new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "Forbidden") =>
  new AppError(403, "FORBIDDEN", msg);
export const notFound = (entity = "Resource") =>
  new AppError(404, "NOT_FOUND", `${entity} not found`);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, "UNPROCESSABLE", msg, details);
