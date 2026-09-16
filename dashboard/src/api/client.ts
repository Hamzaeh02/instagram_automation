const BASE = "/api"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: isFormData
      ? { ...options.headers }
      : { "Content-Type": "application/json", ...options.headers },
  })

  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || detail
    } catch {
      // ignore
    }
    // A 401 anywhere but the auth endpoints themselves means the session
    // cookie expired or was invalidated mid-use - every page up to now had
    // no way to detect this, so API calls would just silently fail one by
    // one while the UI kept acting like the user was still logged in. Send
    // them back to login instead of leaving every page broken in place.
    if (res.status === 401 && !path.startsWith("/auth/")) {
      window.location.href = "/login"
    }
    throw new ApiError(res.status, detail)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
}
