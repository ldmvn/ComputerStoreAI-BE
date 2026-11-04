/**
 * Idempotent seed: add the 'dashboard:view' permission.
 * Safe to run multiple times — uses upsert (no duplicates, no data loss).
 * Run with: node backend/prisma/seed-dashboard-permission.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const perm = await prisma.permission.upsert({
    where: { module_action: { module: 'dashboard', action: 'view' } },
    update: {
      label: 'Xem tổng quan',
      description: 'Xem trang tổng quan hệ thống',
    },
    create: {
      module: 'dashboard',
      action: 'view',
      label: 'Xem tổng quan',
      description: 'Xem trang tổng quan hệ thống',
    },
  });
  console.log(`✓ Permission upserted: ${perm.module}:${perm.action} (id=${perm.id})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
