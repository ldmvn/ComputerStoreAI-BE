/**
 * Idempotent seed: add 5 support:* permissions and grant them to Super Admin role.
 * Safe to run multiple times — uses upsert / skipDuplicates.
 * Does NOT modify any existing roles, permissions, admin accounts, or activity logs.
 *
 * Run with:
 *   node backend/prisma/seed-support-permissions.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUPPORT_PERMISSIONS = [
  { module: 'support', action: 'view',   label: 'Xem phiếu hỗ trợ',     description: 'Xem danh sách và chi tiết phiếu hỗ trợ' },
  { module: 'support', action: 'reply',  label: 'Phản hồi phiếu hỗ trợ', description: 'Gửi phản hồi cho khách hàng' },
  { module: 'support', action: 'update', label: 'Cập nhật trạng thái',    description: 'Thay đổi trạng thái phiếu hỗ trợ' },
  { module: 'support', action: 'assign', label: 'Phân công phiếu',        description: 'Gán phiếu hỗ trợ cho nhân viên' },
  { module: 'support', action: 'manage', label: 'Quản lý hỗ trợ',         description: 'Toàn quyền quản lý hệ thống hỗ trợ' },
];

async function main() {
  console.log('— Upserting support permissions…');
  const permIds = [];
  for (const perm of SUPPORT_PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { module_action: { module: perm.module, action: perm.action } },
      update: { label: perm.label, description: perm.description },
      create: perm,
    });
    permIds.push(record.id);
    console.log(`  ✓ ${record.module}:${record.action} (id=${record.id})`);
  }

  console.log('\n— Finding Super Admin role…');
  const superAdmin = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
  if (!superAdmin) {
    console.warn('  ⚠ Super Admin role not found — permissions upserted but not granted to any role.');
    return;
  }
  console.log(`  ✓ Found: id=${superAdmin.id}`);

  console.log('\n— Granting permissions to Super Admin (skip if already granted)…');
  const result = await prisma.rolePermission.createMany({
    data: permIds.map(permissionId => ({ roleId: superAdmin.id, permissionId })),
    skipDuplicates: true,
  });
  console.log(`  ✓ ${result.count} new grant(s) added (existing grants skipped).`);

  console.log('\nDone. Migration status check:');
  const migration = await prisma.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = '20261011300000_add_support_tickets' LIMIT 1`;
  if (migration.length > 0) {
    console.log(`  ✓ Migration applied at: ${migration[0].finished_at}`);
  } else {
    console.warn('  ⚠ Migration NOT yet applied. Run: npx prisma migrate deploy');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
