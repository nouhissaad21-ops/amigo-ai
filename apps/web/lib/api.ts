export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 45000;

function timeoutSignal() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

async function request<T>(
  path: string,
  init: RequestInit,
  retry = true,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/backend" + path, {
      ...init,
      signal: init.signal ?? timeoutSignal(),
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(
        0,
        "REQUEST_TIMEOUT",
        "الخادم تأخر في الرد. استنى شوية وعاود المحاولة.",
      );
    }
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "تعذر الاتصال بالخادم. استنى لحظة وعاود.",
    );
  }

  if (response.status === 401 && retry && path !== "/api/auth/refresh") {
    const refreshed = await fetch("/backend/api/auth/refresh", {
      method: "POST",
      signal: timeoutSignal(),
      credentials: "include",
      headers: { accept: "application/json" },
    }).catch(() => undefined);
    if (refreshed?.ok) return request(path, init, false);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: {} }));
    throw new ApiError(
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "فشل الطلب",
    );
  }

  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export const api = {
  get: <T>(path: string) =>
    request<T>(path, { method: "GET", cache: "no-store" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};