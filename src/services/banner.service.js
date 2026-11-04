import { prisma } from '../config/prisma.js';
import { AUTO_SIDE_ORDER, bannerError } from '../validators/banner.validator.js';

export const bannerOrder = [{ sortOrder: 'asc' }, { id: 'asc' }];
export function listBanners(activeOnly = false) {
  return prisma.banner.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: bannerOrder });
}

export async function findBanner(id) {
  const banner = await prisma.banner.findUnique({ where: { id } });
  if (!banner) throw bannerError('Banner không tồn tại.', 404);
  return banner;
}

export async function saveBannerRecord(id, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        let resolved = data;
        if (data.position === 'AUTO') {
          const occupied = await tx.banner.findMany({ where: { group: 'SIDE', isActive: true, ...(id ? { id: { not: id } } : {}) }, select: { position: true } });
          const previous = id ? await tx.banner.findUnique({ where: { id }, select: { group: true, position: true } }) : null;
          const order = previous?.group === 'SIDE' ? [previous.position, ...AUTO_SIDE_ORDER] : AUTO_SIDE_ORDER;
          const position = order.find(candidate => !occupied.some(banner => banner.position === candidate));
          if (!position) throw bannerError('Đã có banner Active ở cả sáu vị trí phụ. Chọn vị trí cụ thể để thêm media vào slider hoặc tắt một banner trước.', 409);
          resolved = { ...data, position };
        }
        if (resolved.group === 'SIDE' && resolved.isActive && !resolved.isAutoPlaced) {
          const automatic = await tx.banner.findFirst({ where: { position: resolved.position, isActive: true, isAutoPlaced: true, ...(id ? { id: { not: id } } : {}) } });
          if (automatic) throw bannerError('Vị trí này đang dành cho banner Tự động. Chọn vị trí khác hoặc sửa banner Tự động sang vị trí cụ thể trước khi gộp slider.', 409);
        }
        return id ? tx.banner.update({ where: { id }, data: resolved }) : tx.banner.create({ data: resolved });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error.code !== 'P2034') throw error;
    }
  }
  throw bannerError('Vị trí banner vừa thay đổi. Vui lòng thử lưu lại.', 409);
}

export async function changeBannerStatus(id, isActive) {
  return prisma.$transaction(async tx => {
    const banner = await tx.banner.findUnique({ where: { id } });
    if (!banner) throw bannerError('Banner không tồn tại.', 404);
    let position = banner.position;
    if (isActive && banner.group === 'SIDE') {
      const others = await tx.banner.findMany({ where: { group: 'SIDE', isActive: true, id: { not: id } }, select: { position: true, isAutoPlaced: true } });
      if (banner.isAutoPlaced) {
        position = [banner.position, ...AUTO_SIDE_ORDER].find(candidate => !others.some(item => item.position === candidate));
        if (!position) throw bannerError('Không còn vị trí trống cho banner Tự động. Tắt một banner hoặc chọn vị trí cụ thể.', 409);
      } else if (others.some(item => item.position === position && item.isAutoPlaced)) {
        throw bannerError('Vị trí này đang dành cho banner Tự động. Chọn vị trí khác hoặc sửa banner Tự động sang vị trí cụ thể.', 409);
      }
    }
    return tx.banner.update({ where: { id }, data: { isActive, position } });
  }, { isolationLevel: 'Serializable' });
}

export async function homeBanners() {
  const banners = await listBanners(true);
  const forPosition = position => banners
    .filter(banner => banner.position === position && banner.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
    .map(({ mediaKey, ...banner }) => banner);
  return {
    mainHero: forPosition('MAIN_HERO'),
    bottomLeft: forPosition('BOTTOM_LEFT')[0] || null,
    bottomRight: forPosition('BOTTOM_RIGHT')[0] || null,
    sideLeft: forPosition('SIDE_LEFT')[0] || null,
    sideRightTop: forPosition('SIDE_RIGHT_TOP')[0] || null,
    sideRightMiddle: forPosition('SIDE_RIGHT_MIDDLE')[0] || null,
    sideRightBottom: forPosition('SIDE_RIGHT_BOTTOM')[0] || null,
    sideSlides: Object.fromEntries(AUTO_SIDE_ORDER.map(position => [position, forPosition(position)])),
  };
}

export async function reorderBanners({ position, ids }) {
  return prisma.$transaction(async tx => {
    const current = await tx.banner.findMany({ where: { position }, select: { id: true } });
    if (current.length !== ids.length || current.some(banner => !ids.includes(banner.id))) throw bannerError('Danh sách đã thay đổi. Tải lại rồi sắp xếp đầy đủ banner của vị trí này.', 409);
    for (const [sortOrder, id] of ids.entries()) await tx.banner.update({ where: { id }, data: { sortOrder } });
    return tx.banner.findMany({ where: { position }, orderBy: bannerOrder });
  }, { isolationLevel: 'Serializable' });
}
