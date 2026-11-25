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
      ...(config?.connectAddress ? {
        lookup: (_host: string, options: { all?: boolean }, cb: (err: NodeJS.ErrnoException | null, addr: string | Array<{ address: string; family: number }>, family?: number) => void) => {
          const address = config!.connectAddress;
          if (options.all) cb(null, [{ address, family: 4 }]);
          else cb(null, address, 4);
        },
      } : {}),
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
        agent: this.agent, method, timeout: path.includes("/wait?") ? 200000 : 15000,
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

  private async waitOperation(operation: string | undefined, seconds = 180): Promise<void> {
    if (!operation) throw new Error("Incus did not return an operation URL");
    const path = new URL(operation, this.base).pathname;
    if (!path.startsWith("/1.0/operations/") || !/^[A-Za-z0-9-]+$/.test(path.slice("/1.0/operations/".length))) throw new Error("Invalid Incus operation URL");
    const result = await this.request<IncusOperation>(path + "/wait?timeout=" + seconds);
    if (result.metadata.status_code !== 200) throw new Error("Incus operation failed: " + (result.metadata.err || result.metadata.status_code));
  }

  /** Reset via stdin-free exec; only a cryptographic password hash is passed. */
  async setRootPasswordHash(name: string, hash: string): Promise<void> {
    if (!/^kh-[a-z0-9-]{1,60}$/.test(name) || !/^\$6\$[A-Za-z0-9./]{1,16}\$[A-Za-z0-9./]{86}$/.test(hash)) throw new Error("Invalid password reset parameters");
    const instance = await this.instance(name);
    if (instance.name !== name || instance.type !== "container" || instance.status !== "Running") throw new Error("Password reset requires running managed container");
    try {
      const result = await this.request<IncusOperation>("/1.0/instances/" + encodeURIComponent(name) + "/exec", "POST", {
        command: ["/bin/sh", "-c", "set -eu\nif command -v cloud-init >/dev/null 2>&1; then timeout 60 cloud-init status --wait >/dev/null; fi\nif ! test -x /usr/sbin/sshd; then\n  export DEBIAN_FRONTEND=noninteractive\n  timeout 45 apt-get update -qq\n  timeout 60 apt-get install -y -qq openssh-server\nfi\ninstall -d -m 0755 /etc/ssh/sshd_config.d /run/sshd\nprintf '%s\\n' 'PermitRootLogin yes' 'PasswordAuthentication yes' > /etc/ssh/sshd_config.d/00-kiiro-access.conf\n/usr/sbin/sshd -t\n/usr/sbin/sshd -T | grep -qx 'permitrootlogin yes'\n/usr/sbin/sshd -T | grep -qx 'passwordauthentication yes'\n/usr/sbin/usermod -p \"$1\" root\nsystemctl enable ssh >/dev/null\nsystemctl restart ssh\nsystemctl is-active --quiet ssh", "kiiro-ssh", hash],
        "wait-for-websocket": false, interactive: false, "record-output": true,
        user: 0, group: 0
      });
      await this.waitOperation(result.operation);
      const operation = await this.request<{metadata?: {return?: number}}>(new URL(result.operation!, this.base).pathname);
      if (operation.metadata.metadata?.return !== 0) throw new Error("Password reset command failed");
    } catch {
      throw new Error("Incus password reset failed or requires reconciliation");
    }
  }

  /** Invoke a fixed guest command and verify its exit code. Do not log its arguments. */
  private async execGuest(name: string, command: string[]): Promise<void> {
    if (!/^kh-[a-z0-9-]{1,60}$/.test(name)) throw new Error("Invalid managed instance");
    const state = await this.instance(name);
    if (state.name !== name || state.type !== "container" || state.status !== "Running") throw new Error("Instance must be a running container");
    const result = await this.request<IncusOperation>("/1.0/instances/" + encodeURIComponent(name) + "/exec", "POST", {
      command, "wait-for-websocket": false, interactive: false, "record-output": true, user: 0, group: 0
    });
    await this.waitOperation(result.operation);
    if (!result.operation) throw new Error("Missing guest operation");
    const op = await this.request<{ metadata?: { return?: number } }>(new URL(result.operation, this.base).pathname);
    if (op.metadata.metadata?.return !== 0) throw new Error("Guest command failed");
  }

  async manageRootSshKey(name: string, key: string, action: "add" | "remove"): Promise<void> {
    // Disallow options, multiline payloads, and unrecognized key formats.
    if (!/^(ssh-ed25519|ecdsa-sha2-nistp256|rsa-sha2-256|rsa-sha2-512|ssh-rsa) [A-Za-z0-9+/]{32,8192}={0,2}(?: [a-zA-Z0-9@._-]{1,80})?$/.test(key) || key.length > 9000) {
      throw new Error("Invalid SSH public key");
    }
    const command = `set -eu
umask 077
install -d -m 0700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 0600 /root/.ssh/authorized_keys
tmp=$(mktemp /root/.ssh/.kiiro-keys.XXXXXX)
trap 'rm -f "$tmp"' EXIT
if [ "$2" = add ]; then
  grep -Fxq -- "$1" /root/.ssh/authorized_keys || printf '%s\\n' "$1" >> /root/.ssh/authorized_keys
else
  grep -Fxv -- "$1" /root/.ssh/authorized_keys > "$tmp" || true
  cat "$tmp" > /root/.ssh/authorized_keys
fi`;
    try {
      await this.execGuest(name, ["/bin/sh", "-c", command, "kiiro-keys", key, action]);
    } catch {
      throw new Error("Incus SSH key operation failed");
    }
  }

  async createContainer(input: {
    name: string; imageAlias: string; network: string; storagePool: string;
    address: string; vcpu: number; memoryMb: number; diskGb: number;
    networkMode?: "bridged" | "routed"; parent?: string;
  }): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.name)) throw new Error("Invalid instance name");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(input.imageAlias)) throw new Error("Invalid image alias");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(input.network) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(input.storagePool)) throw new Error("Invalid network or storage pool");
    if (input.networkMode === "routed") {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,30}$/.test(input.parent ?? "")) throw new Error("Invalid routed parent interface");
      if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(input.address) ||
          input.address.split(".").some(part => Number(part) > 255)) throw new Error("Invalid routed IPv4");
    }
    const nic = input.networkMode === "routed"
      ? { type: "nic", name: "eth0", nictype: "routed", parent: input.parent, "ipv4.address": input.address }
      : { type: "nic", name: "eth0", network: input.network, "ipv4.address": input.address };
    const response = await this.request<IncusOperation>("/1.0/instances", "POST", {
      name: input.name, type: "container",
      source: { type: "image", alias: input.imageAlias },
      config: { "limits.cpu": String(input.vcpu), "limits.memory": input.memoryMb + "MiB" },
      devices: {
        root: { type: "disk", path: "/", pool: input.storagePool, size: input.diskGb + "GiB" },
        eth0: nic,
      },
    });
    await this.waitOperation(response.operation);
  }

  async resizeContainer(name: string, vcpu: number, memoryMb: number, diskGb: number): Promise<void> {
    const path = "/1.0/instances/" + encodeURIComponent(name);
    type Details = IncusInstance & { config: Record<string,string>; devices: Record<string,Record<string,string>> };
    const before = (await this.request<Details>(path)).metadata;
    if (before.name !== name || before.type !== "container" || before.status !== "Stopped") throw new Error("Resize requires stopped container");
    const root = Object.keys(before.devices).find(k=>before.devices[k].type==="disk" && before.devices[k].path==="/");
    if (!root) throw new Error("Local root disk not found");
    const config = {...before.config,"limits.cpu":String(vcpu),"limits.memory":memoryMb+"MiB"};
    const devices = {...before.devices,[root]:{...before.devices[root],size:diskGb+"GiB"}};
    const result = await this.request<IncusOperation>(path,"PATCH",{config,devices});
    if(result.operation) await this.waitOperation(result.operation);
    const after = (await this.request<Details>(path)).metadata;
    if(after.config["limits.cpu"]!==String(vcpu) || after.config["limits.memory"]!==memoryMb+"MiB" || after.devices[root]?.size!==diskGb+"GiB") throw new Error("Resize verification failed");
  }

  async deleteContainer(name: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(name)) throw new Error("Invalid instance name");
    const response = await this.request<IncusOperation>("/1.0/instances/" + encodeURIComponent(name), "DELETE");
    await this.waitOperation(response.operation);
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
