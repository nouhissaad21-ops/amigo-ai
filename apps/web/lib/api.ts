export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  init: RequestInit,
  retry = true,
): Promise<T> {
  const r = await fetch(`/backend${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (r.status === 401 && retry && path !== "/api/auth/refresh") {
    const x = await fetch("/backend/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (x.ok) return request(path, init, false);
  }
  if (!r.ok) {
    const b = await r.json().catch(() => ({ error: {} }));
    throw new ApiError(
      r.status,
      b.error?.code ?? "REQUEST_FAILED",
      b.error?.message ?? "فشل الطلب",
    );
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
export const api = {
  get: <T>(p: string) => request<T>(p, { method: "GET", cache: "no-store" }),
  post: <T>(p: string, b?: unknown) =>
    request<T>(p, {
      method: "POST",
      body: b === undefined ? undefined : JSON.stringify(b),
    }),
  put: <T>(p: string, b: unknown) =>
    request<T>(p, { method: "PUT", body: JSON.stringify(b) }),
  patch: <T>(p: string, b: unknown) =>
    request<T>(p, { method: "PATCH", body: JSON.stringify(b) }),
  delete: <T>(p: string) => request<T>(p, { method: "DELETE" }),
};
