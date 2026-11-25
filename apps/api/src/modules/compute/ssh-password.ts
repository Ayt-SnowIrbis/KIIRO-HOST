import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ServiceUnavailableException } from "@nestjs/common";

export function generateRootCredential() {
  const password = randomBytes(24).toString("base64url");
  try {
    const hash = execFileSync("openssl", ["passwd", "-6", "-stdin"], {
      input: password + "\n", encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (!/^\$6\$[A-Za-z0-9./]{1,16}\$[A-Za-z0-9./]{86}$/.test(hash)) throw new Error();
    return { password, hash };
  } catch {
    throw new ServiceUnavailableException("Credential generation unavailable");
  }
}
