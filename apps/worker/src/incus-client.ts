import https from "node:https";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

export type IncusAction = "start" | "stop" | "restart";
type IncusEnvelope<T> = { type: string; status: string; error: string; metadata: T; operation?: string };
type IncusOperation = { status_code?: number; err?: string };
type IncusInstance = { name: string; status: string; type: string };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** Single explicitly configured test node. Never accept an API URL from a task payload. */
export class IncusClient {
  private readonly base: URL;
  private readonly agent: https.Agent;
  constructor() {
    this.base = new URL(required("INCUS_API_URL"));
    if (this.base.protocol !== "https:" || this.base.username || this.base.password ||
        this.base.pathname !== "/" || this.base.search || this.base.hash) {
      throw new Error("INCUS_API_URL must be an HTTPS origin");
    }
    const ca = readFileSync(required("INCUS_SERVER_CERT_PATH"));
    const expected = new X509Certificate(ca).fingerprint256.replaceAll(":", "").toLowerCase();
    const configured = required("INCUS_SERVER_FINGERPRINT").replaceAll(":", "").toLowerCase();
    if (expected !== configured) throw new Error("Pinned Incus certificate mismatch");
    this.agent = new https.Agent({
      cert: readFileSync(required("INCUS_CLIENT_CERT_PATH")),
      key: readFileSync(required("INCUS_CLIENT_KEY_PATH")),
      ca,
      rejectUnauthorized: true,
      // The server uses a self-signed certificate without a public-IP SAN.
      // Trust is restricted to the explicitly pinned certificate above.
      checkServerIdentity: (_host, cert) => {
        const actual = cert.fingerprint256?.replaceAll(":", "").toLowerCase();
        return actual === expected ? undefined : new Error("Incus server identity mismatch");
      },
    });
  }

  private async request<T>(path: string, method = "GET", body?: unknown): Promise<IncusEnvelope<T>> {
    const url = new URL(path, this.base);
    const data = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        agent: this.agent, method, timeout: 15000,
        headers: { Accept: "application/json", ...(data ? { "Content-Type": "application/json" } : {}) },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const response = JSON.parse(Buffer.concat(chunks).toString("utf8")) as IncusEnvelope<T>;
            if ((res.statusCode ?? 500) >= 400 || response.type === "error") {
              reject(new Error(`Incus HTTP ${res.statusCode}: ${response.error || "request failed"}`));
            } else resolve(response);
          } catch (error) { reject(error); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("Incus request timeout")));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  async instance(name: string): Promise<IncusInstance> {
    return (await this.request<IncusInstance>(`/1.0/instances/${encodeURIComponent(name)}`)).metadata;
  }

  async action(name: string, action: IncusAction): Promise<void> {
    const state = action === "restart" ? "restart" : action;
    const response = await this.request<IncusOperation>(
      `/1.0/instances/${encodeURIComponent(name)}/state`,
      "PUT", { action: state, timeout: 30, force: false },
    );
    if (!response.operation) throw new Error("Incus did not return an operation URL");
    const operationPath = new URL(response.operation, this.base).pathname;
    if (!operationPath.startsWith("/1.0/operations/")) throw new Error("Invalid Incus operation URL");
    const result = await this.request<IncusOperation>(`${operationPath}/wait?timeout=45`);
    if (result.metadata.status_code !== 200) {
      throw new Error(`Incus operation incomplete: ${result.metadata.err || result.metadata.status_code}`);
    }
  }
}
