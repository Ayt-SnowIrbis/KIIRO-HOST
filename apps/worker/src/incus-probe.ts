import { IncusClient } from "./incus-client";

async function main() {
  const name = process.env.INCUS_TEST_INSTANCE ?? "kiiro-test-01";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(name)) {
    throw new Error("Invalid INCUS_TEST_INSTANCE");
  }
  const client = new IncusClient();
  const instance = await client.instance(name);
  console.info(JSON.stringify({ event: "incus_readonly_probe", name: instance.name, status: instance.status, type: instance.type }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
