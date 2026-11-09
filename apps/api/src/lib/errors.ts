import type { z } from 'zod';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'Not allowed') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (code: string, message: string, details?: unknown) => new AppError(409, code, message, details),
  tooLarge: (message = 'Request body too large') => new AppError(413, 'PAYLOAD_TOO_LARGE', message),
  tooMany: (message = 'Too many requests. Try again shortly.') => new AppError(429, 'RATE_LIMITED', message),
  provider: (message: string, details?: unknown) => new AppError(502, 'PROVIDER_ERROR', message, details),
  internal: (message = 'Unexpected server error') => new AppError(500, 'INTERNAL', message),
  unavailable: (message: string) => new AppError(503, 'UNAVAILABLE', message),
};

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw errors.badRequest(
      'Request validation failed',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function requireString(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.length || value.length > max) {
    throw errors.badRequest(`${name} is required`);
  }
  return value;
}
