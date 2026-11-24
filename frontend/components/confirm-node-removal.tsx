"use client";

export function ConfirmNodeRemoval({ name }: { name: string }) {
  return <button type="submit" onClick={event => {
    if (!window.confirm(`Remove node "${name}" from KIIRO-HOST? This does not shut down the physical host. Verify there are no unmanaged Incus instances or allocated addresses before proceeding.`)) event.preventDefault();
  }} className="rounded-lg border border-rose-900 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-950/30">
    Remove empty node
  </button>;
}
