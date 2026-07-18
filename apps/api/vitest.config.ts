import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      DATABASE_TENANT_URL: "postgresql://amigo_app:test@localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      CREDENTIAL_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      JWT_SECRET: "test-jwt-secret-with-at-least-32-characters",
      OAUTH_STATE_SECRET: "test-oauth-secret-with-at-least-32-chars",
      AI_PROVIDER: "groq",
      GROQ_API_KEY: "test-key",
      META_APP_ID: "test-app",
      META_APP_SECRET: "test-secret",
      META_VERIFY_TOKEN: "test-verify-token-123",
    },
  },
});
