import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const attrs = await prisma.attribute.findMany({ orderBy: { id: 'asc' }, include: { values: { orderBy: { sortOrder: 'asc' } } } });
console.log('ATTRS:', JSON.stringify(attrs, null, 2));
const items = await prisma.megaMenuItem.findMany({ where: { type: 'ATTRIBUTE_FILTER' }, orderBy: { id: 'asc' } });
console.log('ITEMS:', JSON.stringify(items, null, 2));
await prisma.$disconnect();