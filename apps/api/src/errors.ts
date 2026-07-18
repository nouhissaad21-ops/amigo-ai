import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { logger } from "./logger.js";
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const notFoundHandler: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, "NOT_FOUND", "المورد المطلوب غير موجود"));
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "البيانات غير صالحة",
        details: error.flatten(),
      },
    });
    return;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    res.status(409).json({
      error: { code: "CONFLICT", message: "هذه البيانات موجودة مسبقاً" },
    });
    return;
  }
  const e =
    error instanceof AppError
      ? error
      : new AppError(500, "INTERNAL_ERROR", "حدث خطأ داخلي");
  logger.error(
    { err: error, requestId: req.id, path: req.path },
    "request failed",
  );
  res.status(e.status).json({
    error: {
      code: e.code,
      message: e.message,
      ...(e.details === undefined ? {} : { details: e.details }),
    },
    requestId: req.id,
  });
};
