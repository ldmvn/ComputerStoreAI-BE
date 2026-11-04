import 'dotenv/config';
import { normalizeLegacyBrandSlugs } from '../src/services/brand.service.js';
import { prisma } from '../src/config/prisma.js';
try {
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify({ applied: apply, changes: await normalizeLegacyBrandSlugs(apply) }, null, 2));
} finally { await prisma.$disconnect(); }
