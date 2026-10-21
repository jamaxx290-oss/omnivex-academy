/** Tiny typed fetch wrapper: JSON in/out, cookies included, error normalization. */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Opts = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || "GET",
    credentials: "same-origin",
    headers:
      opts.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" },
    body:
      opts.body instanceof FormData
        ? opts.body
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
    signal: opts.signal,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const d = data as { error?: string; message?: string; code?: string } | null;
    throw new ApiError(
      res.status,
      d?.error || d?.message || `Request failed (${res.status})`,
      d?.code,
    );
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

/** Formats kobo as ₦ price. */
export function naira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined) return "—";
  return `₦${(kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Relative timestamp for feeds ("2m ago"), exact for titles. */
export function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
