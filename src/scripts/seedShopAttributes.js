// Seed a complete, reusable attribute set for every shop category that is
// missing attributes, so adding a product only requires picking existing
// attribute values instead of creating new attributes each time.
// Also adds a few display-only attributes to existing Build PC categories
// (VGA/PSU/Case) for consistency — none of these touch usedInBuildPC /
// requiredForBuildPC, so the compatibility engine is untouched.
//
// Idempotent: safe to run multiple times.
//   node src/scripts/seedShopAttributes.js --dry-run
//   node src/scripts/seedShopAttributes.js --apply

import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

// ── Attribute definitions ───────────────────────────────────────────────────
// categories: array of category slugs this attribute should be attached to.
// required: categories (subset) where isRequired=true in the product form.
const ATTRS = [
  {
    slug: 'dung-luong-luu-tru', name: 'Dung lượng lưu trữ', type: 'SELECT',
    values: ['128GB', '256GB', '500GB', '512GB', '1TB', '2TB', '4TB', '6TB', '8TB'],
    categories: ['ssd-m2', 'ssd-25', 'hdd', 'pc', 'laptop', 'laptop-gaming'],
    required: ['ssd-m2', 'ssd-25', 'hdd'],
  },
  {
    slug: 'chuan-giao-tiep-luu-tru', name: 'Chuẩn giao tiếp', type: 'SELECT',
    values: ['SATA III', 'PCIe 3.0 NVMe', 'PCIe 4.0 NVMe', 'PCIe 5.0 NVMe'],
    categories: ['ssd-m2', 'ssd-25', 'hdd'],
    required: ['ssd-m2', 'ssd-25', 'hdd'],
  },
  {
    slug: 'toc-do-vong-quay-hdd', name: 'Tốc độ vòng quay', type: 'SELECT',
    values: ['5400 RPM', '7200 RPM'],
    categories: ['hdd'],
    required: [],
  },
  {
    slug: 'kich-thuoc-man-hinh', name: 'Kích thước màn hình', type: 'SELECT', unit: 'inch',
    values: ['21.5"', '23.8"', '24"', '27"', '31.5"', '32"', '34"'],
    categories: ['man-hinh', 'laptop', 'laptop-gaming'],
    required: ['man-hinh'],
  },
  {
    slug: 'do-phan-giai', name: 'Độ phân giải', type: 'SELECT',
    values: ['HD (1366x768)', 'Full HD (1920x1080)', '2K (2560x1440)', 'Ultrawide QHD (3440x1440)', '4K UHD (3840x2160)'],
    categories: ['man-hinh', 'laptop', 'laptop-gaming'],
    required: ['man-hinh'],
  },
  {
    slug: 'tan-so-quet', name: 'Tần số quét', type: 'SELECT', unit: 'Hz',
    values: ['60Hz', '75Hz', '100Hz', '144Hz', '165Hz', '180Hz', '240Hz', '280Hz', '360Hz'],
    categories: ['man-hinh', 'laptop-gaming'],
    required: ['man-hinh'],
  },
  {
    slug: 'tam-nen', name: 'Tấm nền', type: 'SELECT',
    values: ['IPS', 'VA', 'TN', 'OLED', 'Mini LED'],
    categories: ['man-hinh', 'laptop', 'laptop-gaming'],
    required: [],
  },
  {
    slug: 'ket-noi', name: 'Kết nối', type: 'SELECT',
    values: ['Có dây', 'Không dây', 'Bluetooth', 'Kết hợp (có dây & không dây)'],
    categories: ['ban-phim', 'chuot', 'ban-phim-chuot', 'tai-nghe', 'loa'],
    required: ['ban-phim', 'chuot', 'ban-phim-chuot', 'tai-nghe', 'loa'],
  },
  {
    slug: 'loai-switch-ban-phim', name: 'Loại switch', type: 'SELECT',
    values: ['Blue switch', 'Red switch', 'Brown switch', 'Black switch', 'Silver switch', 'Membrane', 'Optical'],
    categories: ['ban-phim', 'ban-phim-chuot'],
    required: [],
  },
  {
    slug: 'dpi-chuot', name: 'DPI tối đa', type: 'NUMBER', unit: 'DPI',
    categories: ['chuot', 'ban-phim-chuot'],
    required: [],
  },
  {
    slug: 'loai-tai-nghe', name: 'Loại tai nghe', type: 'SELECT',
    values: ['Over-ear (trùm tai)', 'On-ear (áp tai)', 'In-ear (nhét tai)', 'Earbuds True Wireless'],
    categories: ['tai-nghe'],
    required: ['tai-nghe'],
  },
  {
    slug: 'cau-hinh-loa', name: 'Cấu hình loa', type: 'SELECT',
    values: ['2.0', '2.1', '4.1', '5.1', 'Loa thanh (Soundbar)'],
    categories: ['loa'],
    required: ['loa'],
  },
  {
    slug: 'chat-lieu-ghe', name: 'Chất liệu', type: 'SELECT',
    values: ['Da PU', 'Da thật', 'Vải lưới (Mesh)', 'Nỉ'],
    categories: ['ghe-gaming'],
    required: [],
  },
  {
    slug: 'tai-trong-toi-da', name: 'Tải trọng tối đa', type: 'NUMBER', unit: 'kg',
    categories: ['ghe-gaming'],
    required: [],
  },
  {
    slug: 'kich-thuoc-quat-case', name: 'Kích thước quạt', type: 'SELECT', unit: 'mm',
    values: ['80mm', '92mm', '120mm', '140mm', '200mm'],
    categories: ['quat-case'],
    required: ['quat-case'],
  },
  {
    slug: 'den-led', name: 'Đèn LED', type: 'SELECT',
    values: ['Không có', 'LED đơn sắc', 'RGB', 'ARGB (đồng bộ mainboard)'],
    categories: ['quat-case', 'vo-case', 'ram', 'tan-nhiet-cpu-air', 'tan-nhiet-cpu-aio'],
    required: [],
  },
  // Display-only enrichment for existing Build PC categories — NOT wired
  // into compatibility rules, purely informational/filter attributes.
  {
    slug: 'vram-dung-luong', name: 'Dung lượng VRAM', type: 'SELECT', unit: 'GB',
    values: ['4GB', '6GB', '8GB', '10GB', '12GB', '16GB', '20GB', '24GB'],
    categories: ['vga', 'vga-like-new', 'pc', 'laptop-gaming'],
    required: ['vga', 'vga-like-new'],
  },
  {
    slug: 'chuan-80-plus', name: 'Chuẩn hiệu suất 80 Plus', type: 'SELECT',
    values: ['80 Plus White', '80 Plus Bronze', '80 Plus Silver', '80 Plus Gold', '80 Plus Platinum', '80 Plus Titanium'],
    categories: ['nguon'],
    required: [],
  },
  {
    slug: 'kieu-day-nguon', name: 'Kiểu dây nguồn', type: 'SELECT',
    values: ['Non-Modular', 'Semi-Modular', 'Full-Modular'],
    categories: ['nguon'],
    required: [],
  },
  {
    slug: 'form-factor-case', name: 'Kiểu dáng case', type: 'SELECT',
    values: ['Mini Tower', 'Mid Tower', 'Full Tower', 'Case ITX'],
    categories: ['vo-case'],
    required: [],
  },
];

// ── Run ──────────────────────────────────────────────────────────────────────

const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
const catIdBySlug = Object.fromEntries(categories.map(c => [c.slug, c.id]));

const stats = { attrCreated: 0, attrExisting: 0, valCreated: 0, valExisting: 0, caCreated: 0, caExisting: 0, warnings: [] };

for (const def of ATTRS) {
  let attr = await prisma.attribute.findUnique({ where: { slug: def.slug } });
  if (!attr) {
    stats.attrCreated++;
    console.log(`${DRY ? '[DRY]' : '[CREATE]'} Attribute  ${def.slug}  (${def.name}, ${def.type})`);
    if (APPLY) {
      attr = await prisma.attribute.create({
        data: {
          name: def.name, slug: def.slug, type: def.type, unit: def.unit ?? null,
          showInDetail: true, usedInFilter: def.type !== 'NUMBER', usedInBuildPC: false,
        },
      });
    }
  } else {
    stats.attrExisting++;
  }

  const attrId = attr?.id ?? -1;

  for (const value of def.values || []) {
    if (APPLY) {
      const existing = await prisma.attributeValue.findUnique({
        where: { attributeId_value: { attributeId: attrId, value } },
      }).catch(() => null);
      if (existing) { stats.valExisting++; continue; }
      await prisma.attributeValue.create({ data: { attributeId: attrId, value } });
      stats.valCreated++;
      console.log(`  [CREATE] value "${value}"`);
    } else {
      console.log(`  [DRY] value "${value}"`);
      stats.valCreated++;
    }
  }

  for (const catSlug of def.categories) {
    const categoryId = catIdBySlug[catSlug];
    if (!categoryId) { stats.warnings.push(`category "${catSlug}" không tồn tại (attr ${def.slug})`); continue; }
    const isRequired = (def.required || []).includes(catSlug);

    if (APPLY) {
      const existing = await prisma.categoryAttribute.findUnique({
        where: { categoryId_attributeId: { categoryId, attributeId: attrId } },
      }).catch(() => null);
      if (existing) { stats.caExisting++; continue; }
      await prisma.categoryAttribute.create({
        data: { categoryId, attributeId: attrId, isRequired, showInForm: true, showInDetail: true, usedInFilter: def.type !== 'NUMBER' },
      });
      stats.caCreated++;
      console.log(`  [CREATE] CategoryAttribute  ${catSlug} <- ${def.slug}${isRequired ? ' (required)' : ''}`);
    } else {
      console.log(`  [DRY] CategoryAttribute  ${catSlug} <- ${def.slug}${isRequired ? ' (required)' : ''}`);
      stats.caCreated++;
    }
  }
}

console.log('\n=== Tổng kết ===');
console.log(`Attributes:        tạo mới ${stats.attrCreated}, đã có ${stats.attrExisting}`);
console.log(`AttributeValues:   tạo mới ${stats.valCreated}, đã có ${stats.valExisting}`);
console.log(`CategoryAttribute: tạo mới ${stats.caCreated}, đã có ${stats.caExisting}`);
if (stats.warnings.length) {
  console.log(`\nCảnh báo:`);
  for (const w of stats.warnings) console.log(`  ⚠ ${w}`);
}
if (DRY) console.log('\n[DRY-RUN] Không có thay đổi nào được ghi vào DB. Chạy lại với --apply để ghi thật.');

await prisma.$disconnect();
