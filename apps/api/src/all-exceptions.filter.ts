import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * TEMPORARY diagnostic filter: for non-HTTP errors (500s) it returns the real
 * error name/message/code in the response so a deploy issue can be pinpointed.
 * Remove once the Vercel DB connection is confirmed working.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      return res.status(exception.getStatus()).json(exception.getResponse());
    }
    const err = exception as { name?: string; message?: string; code?: string };
    return res.status(500).json({
      diag: true,
      name: err?.name ?? 'Error',
      message: err?.message ?? String(exception),
      code: err?.code,
    });
  }
}
