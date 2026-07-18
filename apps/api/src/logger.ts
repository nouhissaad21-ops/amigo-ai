import pino from "pino";
import { env } from "./config.js";
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "accessToken",
      "token",
      "credentialsEncrypted",
      "credentialsEnc",
      "*.accessToken",
      "*.apiToken",
      "*.apiKey",
    ],
    censor: "[REDACTED]",
  },
});
