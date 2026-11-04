import { prisma } from '../config/prisma.js';

export function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserByPhone(phone) {
  return prisma.user.findUnique({ where: { phone } });
}

export function findUserByIdentifier(identifier) {
  return prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
  });
}

export function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

export function findSafeUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      gender: true,
      avatarUrl: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
}

export function updateUserById(id, data) {
  return prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      gender: true,
      avatarUrl: true,
      role: true,
      isActive: true,
    },
  });
}

export function createUser(data) {
  return prisma.user.create({
    data,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      avatarUrl: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
}
