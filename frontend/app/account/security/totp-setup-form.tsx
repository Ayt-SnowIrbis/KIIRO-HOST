"use client";

import { useState } from "react";

export function TotpSetupForm() {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [uri, setUri] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(path: string, payload: object) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "Request failed");
    return result;
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-700">Enable an authenticator app before activating administrator access.</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setMessage("");
        try {
          const result = await submit("/api/auth/totp/enroll", { password });
          setUri(result.provisioningUri);
          setPassword("");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); }
        finally { setBusy(false); }
      }} className="space-y-3">
        <label className="block text-sm font-medium">Confirm your password
          <input className="mt-1 w-full rounded border p-2" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">Start TOTP setup</button>
      </form>
      {uri ? (
        <div className="space-y-3">
          <p className="text-sm">Open the provisioning link in your authenticator app. Keep this secret private.</p>
          <a className="break-all text-sm underline" href={uri}>Open authenticator setup</a>
          <form onSubmit={async (event) => {
            event.preventDefault(); setBusy(true); setMessage("");
            try {
              await submit("/api/auth/totp/confirm", { code });
              setUri(""); setCode(""); setMessage("TOTP successfully enabled.");
            } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid code"); }
            finally { setBusy(false); }
          }} className="space-y-3">
            <label className="block text-sm font-medium">Six-digit code
              <input className="mt-1 w-full rounded border p-2" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">Confirm TOTP</button>
          </form>
        </div>
      ) : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </section>
  );
}
