import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const PREFIX_MAP = {
  'laptop': 'LAP',
  'laptop-gaming': 'LPGM',
  'pc': 'PC',
  'pc-gaming': 'PCGM',
  'main-cpu-vga': 'MCV',
  'case-nguon-tan': 'CNT',
  'o-cung-ram-the-nho': 'MEM',
  'loa-mirco-webcam': 'AUDIO',
  'man-hinh': 'MNT',
  'ban-phim': 'KB',
  'chuot-lot-chuot': 'MOU',
  'tai-nghe': 'HP',
  'ghe-ban': 'FUR',
  'phu-kien-console': 'ACC',
  'dich-vu-va-thong-tin-khac': 'SVC',
  'test': 'TST',
};

const rows = await p.category.findMany({ select: { id: true, slug: true, skuPrefix: true } });
let updated = 0;
for (const row of rows) {
  const target = PREFIX_MAP[row.slug];
  if (!target) continue;
  if (row.skuPrefix === target) continue;
  await p.category.update({ where: { id: row.id }, data: { skuPrefix: target } });
  updated += 1;
  console.log(`Set ${row.slug} -> ${target}`);
}
console.log(`Updated ${updated} categories.`);
await p.$disconnect();
