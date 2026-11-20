import { PrismaClient, ProviderSlug, ProviderStatus } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.provider.upsert({
    where: { slug: ProviderSlug.INCUS },
    update: {},
    create: {
      slug: ProviderSlug.INCUS,
      name: "Incus",
      description: "First compute provider integration target",
      status: ProviderStatus.PLANNED,
    },
  });
  await prisma.provider.upsert({
    where: { slug: ProviderSlug.PROXMOX },
    update: {},
    create: {
      slug: ProviderSlug.PROXMOX,
      name: "Proxmox VE",
      description: "Planned compute provider integration",
      status: ProviderStatus.PLANNED,
    },
  });
}

main().finally(async () => prisma.$disconnect());
