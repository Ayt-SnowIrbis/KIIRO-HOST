import { requireAuthSession } from "@/lib/auth/server-session";
import { TotpSetupForm } from "./totp-setup-form";

export default async function SecurityPage() {
  const session = await requireAuthSession();
  return (
    <main className="mx-auto max-w-xl space-y-6 rounded-xl border border-slate-200 bg-white p-8">
      <h1 className="text-2xl font-semibold">Account security</h1>
      <p className="text-sm text-slate-600">Signed in as {session.email}</p>
      <TotpSetupForm />
    </main>
  );
}
