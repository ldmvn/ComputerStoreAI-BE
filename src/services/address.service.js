import { prisma } from '../config/prisma.js';

const select = {
  id: true, userId: true, fullName: true, phone: true,
  provinceCode: true, provinceName: true,
  communeCode: true, communeName: true,
  streetAddress: true, addressType: true,
  isDefault: true, createdAt: true, updatedAt: true,
};

export async function listAddresses(userId) {
  const list = await prisma.address.findMany({
    where: { userId },
    select,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  // Self-heal: ensure at most one default
  const defaults = list.filter(a => a.isDefault);
  if (defaults.length > 1) {
    const toReset = defaults.slice(1).map(a => a.id);
    await prisma.address.updateMany({ where: { id: { in: toReset } }, data: { isDefault: false } });
    return list.map(a => toReset.includes(a.id) ? { ...a, isDefault: false } : a);
  }
  return list;
}

export async function createAddress(userId, data) {
  const count = await prisma.address.count({ where: { userId } });
  const isDefault = data.isDefault || count === 0;

  return prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.address.create({ data: { userId, ...data, isDefault }, select });
  });
}

export async function updateAddress(userId, id, data) {
  const addr = await prisma.address.findFirst({ where: { id, userId } });
  if (!addr) return null;

  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.address.update({ where: { id }, data, select });
  });
}

export async function deleteAddress(userId, id) {
  const addr = await prisma.address.findFirst({ where: { id, userId } });
  if (!addr) return false;

  await prisma.address.delete({ where: { id } });

  // If deleted was default, promote the earliest remaining address
  if (addr.isDefault) {
    const next = await prisma.address.findFirst({
      where: { userId }, orderBy: { createdAt: 'asc' },
    });
    if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  return true;
}

export async function setDefault(userId, id) {
  const addr = await prisma.address.findFirst({ where: { id, userId } });
  if (!addr) return null;

  return prisma.$transaction(async (tx) => {
    await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    return tx.address.update({ where: { id }, data: { isDefault: true }, select });
  });
}
