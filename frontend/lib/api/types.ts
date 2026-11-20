export interface ApiRequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | null | undefined>;
}

export interface ApiErrorPayload {
  message: string;
  status: number;
  code?: string;
}

export interface ApiCollectionResponse<T> {
  items: T[];
}

export interface ApiMutationResponse<T> {
  data: T;
}
