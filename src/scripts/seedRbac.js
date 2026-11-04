// Seed script: create permissions and default roles.
// Safe to run multiple times (upsert pattern).
// Run: node src/scripts/seedRbac.js

import '../config/env.js';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../constants/permissions.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding RBAC...');

  // 1. Upsert all permissions
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { label: p.label, description: p.description },
      create: p,
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions upserted`);

  // 2. Create default Admin role (most permissions, no role/admin manage)
  const adminPerms = await prisma.permission.findMany({
    where: { NOT: { module: { in: ['roles', 'administrators', 'activity_logs'] }, action: { in: ['delete', 'manage'] } } },
    select: { id: true },
  });
  const adminRole = await prisma.role.upsert({
    where: { slug: 'admin' },
    update: { name: 'Admin', isSystem: false, isActive: true },
    create: {
      name: 'Admin',
      slug: 'admin',
      description: 'Quyền quản trị đầy đủ trừ quản lý vai trò và nhật ký.',
      isSystem: false,
      isActive: true,
      sortOrder: 1,
      updatedAt: new Date(),
    },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
  await prisma.rolePermission.createMany({
    data: adminPerms.map(p => ({ roleId: adminRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  console.log(`  ✓ Admin role seeded (${adminPerms.length} permissions)`);

  // 3. Seed BuildPcSettings singleton if not exists
  await prisma.buildPcSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, manualBuildEnabled: true, aiBuildEnabled: false, inStockOnly: true, allowSubstitution: true, updatedAt: new Date() },
  });
  console.log('  ✓ BuildPcSettings singleton seeded');

  // Note: ADMIN users without adminRoleId receive wildcard '*' permissions via rbac.service.js.
  // No role assignment needed here.
  console.log('RBAC seed complete.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
