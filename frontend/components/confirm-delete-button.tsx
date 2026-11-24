"use client";

export function ConfirmDeleteButton({ name, disabled }: { name: string; disabled?: boolean }) {
  return <button type="submit" disabled={disabled}
    onClick={(event) => {
      if (!window.confirm(`Permanently delete Incus instance "${name}"? All data on this instance will be lost. This action cannot be undone.`)) event.preventDefault();
    }}
    className="rounded-lg border border-rose-700 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-950/30 disabled:cursor-not-allowed disabled:opacity-40">
    Queue permanent deletion
  </button>;
}
