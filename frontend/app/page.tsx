import Link from "next/link";
import { providers } from "@/lib/compute/mock-data";
import { getRequestI18n } from "@/lib/i18n/server";

export default async function Home() {
  const { dictionary } = await getRequestI18n();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-2xl font-semibold">{dictionary.dashboard.homeTitle}</h2>
      <p className="mt-3 max-w-3xl text-slate-600">{dictionary.dashboard.homeDescription}</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {providers.map((provider) => (
          <article key={provider.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium text-slate-900">{provider.name}</h3>
              <span className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">{provider.status}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{provider.description}</p>
          </article>
        ))}
      </div>
      <ul className="mt-6 list-disc space-y-1 pl-6 text-sm text-slate-600">
        <li>{dictionary.compute.entitiesBullet}</li>
        <li>{dictionary.compute.capabilitiesBullet}</li>
        <li>{dictionary.compute.neutralBoundaryDescription}</li>
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/login" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {dictionary.nav.login}
        </Link>
        <Link href="/register" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">
          {dictionary.nav.register}
        </Link>
        <Link href="/dashboard" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">
          {dictionary.nav.dashboard}
        </Link>
      </div>
    </section>
  );
}
