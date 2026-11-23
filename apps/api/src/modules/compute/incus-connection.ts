import { isIP } from "node:net";
import https from "node:https";
import { checkServerIdentity } from "node:tls";
import { existsSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { join } from "node:path";
import {
  loadIncusNodeConfig,
  type IncusNodeConfig,
} from "./incus-node-config";

type IncusEnvelope = {
  type?: string;
  metadata?: unknown;
};

export type IncusConnection = {
  get(path: IncusReadPath): Promise<unknown>;
  fingerprint: string;
};

export type IncusReadPath =
  | "/1.0"
  | "/1.0/networks"
  | "/1.0/storage-pools"
  | "/1.0/resources";

const allowedPaths = new Set<string>([
  "/1.0",
  "/1.0/networks",
  "/1.0/storage-pools",
  "/1.0/resources",
]);

function normalize(value: string): string {
  return value.replaceAll(":", "").toLowerCase();
}

function legacyConfig(nodeId: string): IncusNodeConfig {
  if (nodeId !== "incus-test-node-01") {
    throw new Error("Legacy configuration restricted to test node");
  }

  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };

  const apiUrl = required("INCUS_API_URL");
  const url = new URL(apiUrl);

  if (
    url.protocol !== "https:" ||
    url.hostname !== "incus-01-test" ||
    url.port !== "8443" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Unexpected legacy Incus endpoint");
  }

  return {
    apiUrl,
    serverCertPath: required("INCUS_SERVER_CERT_PATH"),
    serverFingerprint: normalize(
      required("INCUS_SERVER_FINGERPRINT")
    ),
    clientCertPath: required("INCUS_CLIENT_CERT_PATH"),
    clientKeyPath: required("INCUS_CLIENT_KEY_PATH"),
  };
}

export function createIncusConnection(
  nodeId: string
): IncusConnection {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(nodeId) ||
    nodeId === "." ||
    nodeId === ".."
  ) {
    throw new Error("Invalid Incus node ID");
  }

  const configDir = process.env.INCUS_NODE_CONFIG_DIR;

  const hasNodeConfig = Boolean(
    configDir && existsSync(join(configDir, `${nodeId}.json`))
  );

  let config: IncusNodeConfig;

  if (hasNodeConfig) {
    config = loadIncusNodeConfig(nodeId, configDir!);
  } else if (nodeId === "incus-test-node-01") {
    config = legacyConfig(nodeId);
  } else {
    throw new Error("Incus node configuration not found");
  }

  const base = new URL(config.apiUrl);

  if (
    base.protocol !== "https:" ||
    !base.hostname ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error("Invalid Incus endpoint");
  }

  const ca = readFileSync(config.serverCertPath);
  const fingerprint = normalize(
    new X509Certificate(ca).fingerprint256
  );
  const expected = normalize(config.serverFingerprint);

  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    fingerprint !== expected
  ) {
    throw new Error("Incus certificate pin mismatch");
  }

  const connectAddress = config.connectAddress;

  if (
    hasNodeConfig &&
      (!connectAddress || isIP(connectAddress) !== 4)
  ) {
    throw new Error("Pinned Incus address required");
  }

  const agent = new https.Agent({
    cert: readFileSync(config.clientCertPath),
    key: readFileSync(config.clientKeyPath),
    ca,
    rejectUnauthorized: true,
    maxSockets: 4,
    ...(connectAddress ? {
      lookup: (
        _hostname: string,
        options: { all?: boolean },
        callback: (
          error: NodeJS.ErrnoException | null,
          address: string | Array<{ address: string; family: number }>,
          family?: number
        ) => void
      ) => {
        if (options.all) {
          callback(null, [{ address: connectAddress, family: 4 }]);
        } else {
          callback(null, connectAddress, 4);
        }
      },
    } : {}),
    checkServerIdentity: (hostname, cert) => {
      const hostnameError = checkServerIdentity(hostname, cert);
      if (hostnameError) {
        return hostnameError;
      }

      const actual = normalize(cert.fingerprint256 ?? "");
      return actual === expected
        ? undefined
        : new Error("Incus server identity mismatch");
    },
  });

  return {
    fingerprint: expected,

    async get(path: IncusReadPath): Promise<unknown> {
      if (!allowedPaths.has(path)) {
        throw new Error("Incus API path not allowed");
      }

      return new Promise<unknown>((resolve, reject) => {
        const req = https.get(
          new URL(path, base),
          {
            agent,
            timeout: 6000,
            headers: { Accept: "application/json" },
          },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;

            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error("Incus HTTP request failed"));
              return;
            }

            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 512 * 1024) {
                req.destroy(
                  new Error("Incus response size limit exceeded")
                );
              } else {
                chunks.push(chunk);
              }
            });

            res.on("end", () => {
              try {
                const payload = JSON.parse(
                  Buffer.concat(chunks).toString("utf8")
                ) as IncusEnvelope;

                if (payload.type !== "sync") {
                  throw new Error("Unexpected Incus response");
                }

                resolve(payload.metadata);
              } catch {
                reject(new Error("Invalid Incus response"));
              }
            });

            res.on("error", reject);
          }
        );

        req.on("timeout", () => {
          req.destroy(new Error("Incus request timeout"));
        });

        req.on("error", reject);
      });
    },
  };
}
