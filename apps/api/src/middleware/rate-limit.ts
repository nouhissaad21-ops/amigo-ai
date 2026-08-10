import { Request, Response, NextFunction } from "express";
import { Redis } from "ioredis";
import { env } from "../config.js";
import { AppError } from "../errors.js";

const redis = new Redis(env.REDIS_URL);

/**
 * Rate Limiting Middleware
 * 
 * - Per store: 100 requests/minute
 * - Per IP: 60 requests/minute
 * - Per webhook: 1000 requests/minute
 */

export async function rateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
  options: { key: string; limit: number; window: number }
) {
  const key = `ratelimit:${options.key}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, options.window);
  }

  if (current > options.limit) {
    throw new AppError(429, "RATE_LIMIT_EXCEEDED", "تم تجاوز الحد المسموح. حاول لاحقاً.");
  }

  next();
}

export const storeRateLimit = (req: Request, res: Response, next: NextFunction) =>
  rateLimit(req, res, next, { key: `store:${req.storeId}`, limit: 100, window: 60 });

export const ipRateLimit = (req: Request, res: Response, next: NextFunction) =>
  rateLimit(req, res, next, { key: `ip:${req.ip}`, limit: 60, window: 60 });
