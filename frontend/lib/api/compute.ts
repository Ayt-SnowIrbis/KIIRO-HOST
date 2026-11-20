import { apiRequest } from "./client";
import type { ApiCollectionResponse, ApiMutationResponse } from "./types";
import type { Instance, OperationTask, Provider } from "@/lib/compute/types";

export function getProviders() {
  return apiRequest<ApiCollectionResponse<Provider>>("/compute/providers");
}

export function getInstances() {
  return apiRequest<ApiCollectionResponse<Instance>>("/compute/instances");
}

export function runInstanceAction(instanceId: string, action: string) {
  return apiRequest<ApiMutationResponse<OperationTask>>(
    `/compute/instances/${instanceId}/actions/${action}`,
    {
      method: "POST",
    },
  );
}
