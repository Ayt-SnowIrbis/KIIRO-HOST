import https from "node:https";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
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

/** One worker process per pinned node. Endpoints and credentials come only from operator-mounted configuration, never task payloads. */
export class IncusClient {
  private readonly base: URL;
  private readonly agent: https.Agent;
  constructor() {
    const nodeId = required("INCUS_NODE_ID");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(nodeId)) throw new Error("Invalid INCUS_NODE_ID");
    const configDir = process.env.INCUS_NODE_CONFIG_DIR;
    let config: Record<string, string> | undefined;
    if (configDir) {
      const root = realpathSync(configDir);
      const file = realpathSync(resolve(root, nodeId + ".json"));
      if (!file.startsWith(root + sep)) throw new Error("Node configuration escapes trusted directory");
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid node configuration");
      config = parsed as Record<string, string>;
      const keys = ["apiUrl", "serverCertPath", "serverFingerprint", "clientCertPath", "clientKeyPath"];
      if (keys.some(k => typeof config![k] !== "string" || !config![k])) throw new Error("Incomplete node configuration");
    } else if (nodeId !== "incus-test-node-01") {
      throw new Error("Additional Incus nodes require INCUS_NODE_CONFIG_DIR");
    }
    const setting = (key: string, env: string) => config ? config[key] : required(env);
    this.base = new URL(setting("apiUrl", "INCUS_API_URL"));
    if (this.base.protocol !== "https:" || this.base.username || this.base.password ||
        this.base.pathname !== "/" || this.base.search || this.base.hash) {
      throw new Error("INCUS_API_URL must be an HTTPS origin");
    }
    const ca = readFileSync(setting("serverCertPath", "INCUS_SERVER_CERT_PATH"));
    const expected = new X509Certificate(ca).fingerprint256.replaceAll(":", "").toLowerCase();
    const configured = setting("serverFingerprint", "INCUS_SERVER_FINGERPRINT").replaceAll(":", "").toLowerCase();
    if (expected !== configured) throw new Error("Pinned Incus certificate mismatch");
    this.agent = new https.Agent({
      cert: readFileSync(setting("clientCertPath", "INCUS_CLIENT_CERT_PATH")),
      key: readFileSync(setting("clientKeyPath", "INCUS_CLIENT_KEY_PATH")),
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

  async inventory(): Promise<{ serverName: string | null; networks: string[]; storagePools: string[]; cpuThreads: number | null; memoryBytes: string | null }> {
    const [server, networks, pools, resources] = await Promise.all([
      this.request<Record<string, unknown>>("/1.0"),
      this.request<string[]>("/1.0/networks"),
      this.request<string[]>("/1.0/storage-pools"),
      this.request<Record<string, unknown>>("/1.0/resources"),
    ]);
    if (server.metadata.auth !== "trusted") throw new Error("Incus certificate not trusted");
    const env = server.metadata.environment as Record<string, unknown> | undefined;
    const cpu = resources.metadata.cpu as Record<string, unknown> | undefined;
    const memory = resources.metadata.memory as Record<string, unknown> | undefined;
    const names = (items: string[]) => items.filter(x => typeof x === "string").slice(0, 100).map(x => x.split("/").pop() ?? x);
    return {
      serverName: typeof env?.server_name === "string" ? env.server_name : null,
      networks: names(networks.metadata), storagePools: names(pools.metadata),
      cpuThreads: typeof cpu?.total === "number" ? cpu.total : null,
      memoryBytes: typeof memory?.total === "number" ? String(memory.total) : null,
    };
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
