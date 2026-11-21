import type { ApiRequestOptions } from "./types";
import { getApiBaseUrl } from "@/lib/config";

export class ApiRequestError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function getBrowserApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "/api/backend";
}

function createUrl(path: string, params?: ApiRequestOptions["params"]) {
  const apiBaseUrl =
    typeof window === "undefined"
      ? getApiBaseUrl()
      : getBrowserApiBaseUrl();

  const normalizedBase = apiBaseUrl.replace(/\/$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  const absoluteBase = normalizedBase.startsWith("http")
    ? normalizedBase
    : `http://localhost${normalizedBase.startsWith("/") ? "" : "/"}${normalizedBase}`;

  const url = new URL(`${absoluteBase}/${normalizedPath}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return normalizedBase.startsWith("http")
    ? url.toString()
    : `${url.pathname}${url.search}`;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { params, headers, ...requestInit } = options;
  const response = await fetch(createUrl(path, params), {
    ...requestInit,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    const fallbackMessage = "API request failed";
    let message = fallbackMessage;
    let code: string | undefined;

    try {
      const json = (await response.json()) as { message?: string; code?: string };
      message = json.message ?? fallbackMessage;
      code = json.code;
    } catch {}

    throw new ApiRequestError(message, response.status, code);
  }

  return (await response.json()) as T;
}
