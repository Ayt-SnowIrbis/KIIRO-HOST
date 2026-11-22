"use client";

import { useActionState } from "react";
import {
  addPoolAddressSafe,
  type IpAddressFormState,
} from "@/lib/admin/infrastructure-actions";

const initialState: IpAddressFormState = {
  status: "idle",
  message: "",
};

export function IpAddressForm({ poolId }: { poolId: string }) {
  const [state, action, pending] = useActionState(
    addPoolAddressSafe,
    initialState,
  );

  return (
    <form action={action} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="poolId" value={poolId} />
      <input
        required
        name="address"
        placeholder="Add address in CIDR"
        className="mt-1 w-full max-w-xs rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
      />
      <button
        disabled={pending}
        className="rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
      >
        {pending ? "Adding..." : "Add address"}
      </button>
      {state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "w-full text-sm text-red-400"
              : "w-full text-sm text-green-400"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
