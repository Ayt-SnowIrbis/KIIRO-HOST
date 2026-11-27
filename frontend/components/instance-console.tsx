"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

type Availability = { available: boolean; enabled: boolean };
type Ticket = { ticket: string; expiresInSeconds: number };
type Frame = { type: string; data?: string; reason?: string };
const INSTANCE_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function InstanceConsole({ instanceId, admin }: { instanceId: string; admin: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"idle" | "connecting" | "connected" | "closed" | "unavailable">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!attempt || !INSTANCE_RE.test(instanceId)) return;
    const abort = new AbortController();
    let disposed = false;
    let socket: WebSocket | undefined;
    let terminal: import("@xterm/xterm").Terminal | undefined;
    let observer: ResizeObserver | undefined;
    let inputDisposable: { dispose(): void } | undefined;
    const prefix = admin ? "/compute/instances" : "/compute/customer/instances";
    const path = "/api/backend" + prefix + "/" + encodeURIComponent(instanceId) + "/console";
    const stop = () => {
      disposed = true;
      abort.abort();
      observer?.disconnect();
      inputDisposable?.dispose();
      socket?.close();
      terminal?.dispose();
      if (container.current) container.current.replaceChildren();
    };
    void (async () => {
      try {
        const availabilityResponse = await fetch(path + "/availability", {
          credentials: "same-origin", cache: "no-store", signal: abort.signal,
        });
        if (!availabilityResponse.ok) throw new Error("Console availability could not be verified");
        const availability = await availabilityResponse.json() as Availability;
        if (!availability.available || !availability.enabled) {
          if (!disposed) { setState("unavailable"); setError("Console is not enabled for this VPS."); }
          return;
        }
        const [xterm, fitModule] = await Promise.all([
          import("@xterm/xterm"), import("@xterm/addon-fit"),
        ]);
        if (disposed || !container.current) return;
        const term = new xterm.Terminal({
          cursorBlink: true, convertEol: false, scrollback: 2000,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 14, allowProposedApi: false,
          theme: { background: "#020617", foreground: "#e2e8f0", cursor: "#fbbf24" },
        });
        const fit = new fitModule.FitAddon();
        terminal = term;
        term.loadAddon(fit);
        term.open(container.current);
        fit.fit();
        term.writeln("KIIRO-HOST — secure Incus console");
        term.writeln("Requesting one-use access ticket...");

        const ticketResponse = await fetch(path + "/ticket", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}", cache: "no-store", signal: abort.signal,
        });
        if (!ticketResponse.ok) throw new Error("Console authorization rejected");
        const ticketData = await ticketResponse.json() as Ticket;
        if (typeof ticketData.ticket !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(ticketData.ticket)) {
          throw new Error("Invalid console ticket");
        }
        if (disposed) return;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(protocol + "//" + window.location.host + "/api/console/ws");
        let connected = false;
        socket.onopen = () => {
          if (disposed || !socket) return;
          socket.send(JSON.stringify({ type: "authenticate", ticket: ticketData.ticket }));
        };
        socket.onmessage = event => {
          if (disposed || typeof event.data !== "string") return;
          let frame: Frame;
          try { frame = JSON.parse(event.data) as Frame; } catch { return; }
          if (frame.type === "ready") {
            connected = true;
            setState("connected");
            term.writeln("\r\nConnected to VPS console.\r\n");
            term.focus();
            if (socket?.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify({ type: "resize", width: term.cols, height: term.rows }));
          } else if (frame.type === "output" && typeof frame.data === "string") {
            if (frame.data.length > 18000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data)) return;
            const raw = atob(frame.data);
            const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
            term.write(bytes);
          } else if (frame.type === "unavailable" || frame.type === "error") {
            setError("Console server is unavailable.");
          }
        };
        socket.onclose = () => {
          if (!disposed) {
            setState("closed");
            if (!connected) setError("Console connection failed or was rejected.");
            term.writeln("\r\n[Console session closed]");
          }
        };
        socket.onerror = () => { if (!disposed) setError("WebSocket connection failed."); };

        inputDisposable = term.onData(text => {
          if (!connected || socket?.readyState !== WebSocket.OPEN) return;
          const input = new TextEncoder().encode(text);
          for (let offset = 0; offset < input.length; offset += 4096) {
            const chunk = input.subarray(offset, offset + 4096);
            let binary = "";
            for (const byte of chunk) binary += String.fromCharCode(byte);
            socket.send(JSON.stringify({ type: "input", data: btoa(binary) }));
          }
        });
        observer = new ResizeObserver(() => {
          if (disposed) return;
          fit.fit();
          if (connected && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "resize", width: term.cols, height: term.rows }));
          }
        });
        observer.observe(container.current);
      } catch {
        if (!disposed && !abort.signal.aborted) {
          setState("unavailable");
          setError("Console could not be opened. The instance was not changed.");
        }
      }
    })();
    return stop;
  }, [attempt, admin, instanceId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        This terminal runs commands inside your VPS as root. Commands can modify or erase data.
        It does not provide SSH access to the physical Incus node.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {attempt === 0 || state === "closed" || state === "unavailable" ? (
          <button type="button" onClick={() => { setError(""); setState("connecting"); setAttempt(v => v + 1); }}
            className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950">
            Open console
          </button>
        ) : (
          <button type="button" onClick={() => { setAttempt(0); setState("idle"); }}
            className="rounded-lg border border-slate-500 px-4 py-2 text-sm text-white">
            Disconnect
          </button>
        )}
        <span role="status" className="text-sm text-slate-400">Status: {state}</span>
      </div>
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
        <div ref={container} className="h-[440px] w-full overflow-hidden" />
      </div>
    </div>
  );
}
