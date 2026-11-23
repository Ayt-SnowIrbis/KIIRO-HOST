import { isIP } from "node:net";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

export type IncusNodeConfig = {
  apiUrl: string;
  connectAddress?: string;
  serverCertPath: string;
  serverFingerprint: string;
  clientCertPath: string;
  clientKeyPath: string;
};

const trustedCertificateRoot = "/etc/kiiro-host/incus";

function validateCertificatePath(
  value: string,
  privateKey: boolean
): string {
  if (!value.startsWith(trustedCertificateRoot + sep)) {
    throw new Error("Certificate path outside trusted directory");
  }

  if (lstatSync(value).isSymbolicLink()) {
    throw new Error("Certificate symlink rejected");
  }

  const root = realpathSync(trustedCertificateRoot);
  const resolved = realpathSync(value);

  if (!resolved.startsWith(root + sep)) {
    throw new Error("Certificate path escapes trusted directory");
  }

  const info = statSync(resolved);

  if (!info.isFile()) {
    throw new Error("Certificate path is not a regular file");
  }

  if (privateKey && (info.mode & 0o077) !== 0) {
    throw new Error("Private key permissions are unsafe");
  }

  return resolved;
}

const validNodeId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;

function normalizeFingerprint(value: string): string {
  return value.replaceAll(":", "").toLowerCase();
}

export function loadIncusNodeConfig(
  nodeId: string,
  directory: string
): IncusNodeConfig {
  if (!validNodeId.test(nodeId) || nodeId === "." || nodeId === "..") {
    throw new Error("Invalid Incus node ID");
  }

  if (!directory) {
    throw new Error("Incus node configuration directory is missing");
  }

  const root = realpathSync(directory);
  const path = resolve(root, `${nodeId}.json`);

  if (!path.startsWith(root + sep)) {
    throw new Error("Incus node configuration path rejected");
  }

  if (lstatSync(path).isSymbolicLink()) {
    throw new Error("Incus node configuration symlink rejected");
  }

  const file = realpathSync(path);

  if (!file.startsWith(root + sep)) {
    throw new Error("Incus node configuration symlink rejected");
  }

  const info = statSync(file);

  if (!info.isFile()) {
    throw new Error("Invalid Incus node configuration file");
  }

  if ((info.mode & 0o077) !== 0) {
    throw new Error("Incus node configuration permissions are unsafe");
  }

  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid Incus node configuration");
  }

  const config = raw as Record<string, unknown>;

  const fields = [
    "apiUrl",
    "serverCertPath",
    "serverFingerprint",
    "clientCertPath",
    "clientKeyPath"
  ] as const;

  for (const field of fields) {
    if (typeof config[field] !== "string" || !config[field]) {
      throw new Error(`Invalid Incus configuration field: ${field}`);
    }
  }

  const apiUrl = new URL(config.apiUrl as string);

  if (
    apiUrl.protocol !== "https:" ||
    !apiUrl.hostname ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.pathname !== "/" ||
    apiUrl.port !== "8443" ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error("Invalid Incus API URL");
  }

  const connectAddress = config.connectAddress;

  if (
    typeof connectAddress !== "string" ||
    isIP(connectAddress) !== 4 ||
    connectAddress === "0.0.0.0" ||
    connectAddress.startsWith("127.") ||
    connectAddress.startsWith("169.254.") ||
    connectAddress.startsWith("224.") ||
    connectAddress.startsWith("255.")
  ) {
    throw new Error("Invalid Incus connect address");
  }

  const serverFingerprint = normalizeFingerprint(
    config.serverFingerprint as string
  );

  if (!fingerprintPattern.test(serverFingerprint)) {
    throw new Error("Invalid Incus server fingerprint");
  }

  return {
    apiUrl: apiUrl.href,
    connectAddress,
    serverCertPath: validateCertificatePath(
      config.serverCertPath as string,
      false
    ),
    serverFingerprint,
    clientCertPath: validateCertificatePath(
      config.clientCertPath as string,
      false
    ),
    clientKeyPath: validateCertificatePath(
      config.clientKeyPath as string,
      true
    )
  };
}
