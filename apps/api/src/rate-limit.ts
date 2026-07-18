import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "./errors.js";
import { normalizeClientIp } from "./ip.js";
import { logger } from "./logger.js";
import { cacheRedis } from "./queues.js";

const incrementScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

type Options = {
  prefix: string;
  windowMs: number;
  limit: number;
  failClosed?: boolean;
};

export function redisRateLimit(options: Options): RequestHandler {
  return async (req, res, next) => {
    const ip = normalizeClientIp(req.ip || req.socket.remoteAddress);
    const digest = createHash("sha256").update(ip).digest("hex").slice(0, 32);
    const key = `rate:${options.prefix}:${digest}`;
    try {
      const raw = (await cacheRedis.eval(
        incrementScript,
        1,
        key,
        String(options.windowMs),
      )) as [number | string, number | string];
      const current = Number(raw[0]);
      const ttlMs = Math.max(0, Number(raw[1]));
      const remaining = Math.max(0, options.limit - current);
      res.setHeader("RateLimit-Limit", String(options.limit));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil(ttlMs / 1000)));
      if (current > options.limit) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil(ttlMs / 1000))),
        );
        return next(
          new AppError(429, "RATE_LIMITED", "محاولات كثيرة؛ عاود بعد شوية"),
        );
      }
      return next();
    } catch (error) {
      logger.error(
        { err: error, limiter: options.prefix },
        "Redis rate limiter failed",
      );
      if (options.failClosed) {
        return next(
          new AppError(
            503,
            "RATE_LIMIT_UNAVAILABLE",
            "الخدمة غير متاحة مؤقتاً",
          ),
        );
      }
      return next();
    }
  };
}
