import { prisma } from '../config/prisma.js';

// Keys that must not be written by external callers (reserved for system use).
const READONLY_KEYS = new Set([]);

export async function getAllSettings() {
  const rows = await prisma.storeSetting.findMany({ orderBy: { key: 'asc' } });
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function getSettingsByPrefix(prefix) {
  const rows = await prisma.storeSetting.findMany({
    where: { key: { startsWith: prefix } },
    orderBy: { key: 'asc' },
  });
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function getSetting(key) {
  const row = await prisma.storeSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSettings(map) {
  // map: { [key: string]: string }
  const entries = Object.entries(map).filter(([k]) => !READONLY_KEYS.has(k));
  if (!entries.length) return;
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.storeSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )
  );
}
