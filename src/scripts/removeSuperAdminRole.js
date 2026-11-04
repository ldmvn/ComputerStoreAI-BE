// One-time script: remove Super Admin role and free affected users to wildcard RBAC.
// Run: node src/scripts/removeSuperAdminRole.js

import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const superAdminRole = await prisma.role.findUnique({ where: { slug: 'super-admin' } });
  if (!superAdminRole) { console.log('Super Admin role not found — nothing to do.'); return; }

  // Null out adminRoleId for all users assigned this role
  const updated = await prisma.user.updateMany({
    where: { adminRoleId: superAdminRole.id },
    data: { adminRoleId: null },
  });
  console.log(`  ✓ Unlinked ${updated.count} user(s) from Super Admin role`);

  // Delete role permissions then the role itself (bypass isSystem in DB)
  await prisma.rolePermission.deleteMany({ where: { roleId: superAdminRole.id } });
  await prisma.role.delete({ where: { id: superAdminRole.id } });
  console.log('  ✓ Super Admin role deleted');
  console.log('Done. Affected admins now use wildcard RBAC (no role assigned).');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
