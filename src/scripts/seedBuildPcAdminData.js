// seedBuildPcAdminData.js
// B1: CategoryAttribute assignments (add-only, idempotent)
// B2: usedInBuildPC = true for NUMBER attrs 49-55
// B3: ProductHighlightSpec for every SEED- product (4-8 lines, idempotent)
// B4: ProductSpecification from product.specs in JSON (idempotent, Bảo hành last)
// Flags: --dry-run (preview only)  --cleanup (delete SEED- highlight/specs only)

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import '../config/env.js';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();
const DRY     = process.argv.includes('--dry-run');
const CLEANUP = process.argv.includes('--cleanup');
const JSON_FILE     = path.resolve(__dirname, 'data/buildPcProducts.json');
const SEED_PREFIX   = 'SEED-';

// Attr IDs confirmed safe to flip (A5: not used in filter/menu, only gate for requiredForBuildPC)
const USED_IN_BUILD_PC_ATTR_IDS = [49, 50, 51, 52, 53, 54, 55];

// ─── B1 data ─────────────────────────────────────────────────────────────────
const CATEGORY_ATTR_ROWS = [
  { categorySlug: 'cpu',                  attributeId: 32, sortOrder: 20 },
  { categorySlug: 'cpu',                  attributeId: 51, sortOrder: 30 },
  { categorySlug: 'ram',                  attributeId: 55, sortOrder: 40 },
  { categorySlug: 'vga',                  attributeId: 49, sortOrder: 10 },
  { categorySlug: 'vga',                  attributeId: 51, sortOrder: 20 },
  { categorySlug: 'vga-like-new',         attributeId: 49, sortOrder: 10 },
  { categorySlug: 'vga-like-new',         attributeId: 51, sortOrder: 20 },
  { categorySlug: 'nguon',                attributeId: 52, sortOrder: 10 },
  { categorySlug: 'vo-case',              attributeId: 34, sortOrder: 10 },
  { categorySlug: 'vo-case',              attributeId: 50, sortOrder: 20 },
  { categorySlug: 'vo-case',              attributeId: 54, sortOrder: 30 },
  { categorySlug: 'vo-case',              attributeId: 56, sortOrder: 40 },
  { categorySlug: 'tan-nhiet-cpu-air',    attributeId: 32, sortOrder: 10 },
  { categorySlug: 'tan-nhiet-cpu-air',    attributeId: 53, sortOrder: 20 },
  { categorySlug: 'tan-nhiet-cpu-aio',    attributeId: 32, sortOrder: 10 },
  { categorySlug: 'tan-nhiet-cpu-aio',    attributeId: 56, sortOrder: 20 },
  { categorySlug: 'tan-nhiet-cpu-custom', attributeId: 32, sortOrder: 10 },
];

// ─── helpers ─────────────────────────────────────────────────────────────────
const arr = v => Array.isArray(v) ? v : v != null ? [v] : [];
const joinArr = v => arr(v).join(', ');

function parseName(name) {
  const get = re => { const m = name.match(re); return m ? m[1] : null; };
  return {
    baseClock:   get(/([\d.]+)GHz\s+Up\s+to/i),
    maxClock:    get(/Up\s+to\s+([\d.]+)GHz/i),
    cache:       get(/(\d+)MB\s+Cache/i),
    cores:       get(/(\d+)\s+Cores?\b/i),
    threads:     get(/(\d+)\s+Threads?\b/i),
    vram:        get(/(\d+GB\s+GDDR\w+)/i),
    gpuChip:     (name.match(/(?:GeForce\s+[\w\s]+?(?=\s+\d+GB))|(?:Radeon\s+[\w\s]+?(?=\s+\d+GB))/i) || [])[0]?.trim(),
    ssdCap:      get(/(\d+(?:TB|GB))\s+(?:PCIe|SATA)/i),
    ssdIfaceGen: get(/PCIe\s+([\d.]+)\s*(?:x4\s*)?NVMe/i) || get(/PCIe\s+([\d.]+)/i),
    psuRating:   get(/80\+\s*([\w]+)/i),
    psuModular:  get(/(Full\s+Modular|Semi.Modular|Non.Modular)/i),
    fanSize:     get(/(\d+)mm/i),
    fanPack:     get(/(\d+)[\s-]?Pack/i),
    tubingType:  get(/(Soft|Hard)\s+Tubing/i),
    heatpipe:    get(/(\d+)\s*heatpipe/i),
    coolerType:  get(/\b(Single|Dual)\s+(?:Tower|Fan)\b/i),
    rpm:         get(/(\d+)RPM/i),
  };
}

// ─── Highlight spec generator ─────────────────────────────────────────────────
function buildHighlightSpecs(product) {
  const { name, categorySlug, attributes: attrs = {}, warrantyMonths } = product;
  const p = parseName(name);
  const lines = [];

  switch (categorySlug) {
    case 'cpu':
      if (attrs['cpu-series'])              lines.push(`Dòng CPU: ${attrs['cpu-series']}`);
      if (attrs['socket-cpu'])              lines.push(`Socket: ${joinArr(attrs['socket-cpu'])}`);
      if (p.cores && p.threads)             lines.push(`Số nhân / luồng: ${p.cores} nhân / ${p.threads} luồng`);
      if (p.baseClock && p.maxClock)        lines.push(`Xung nhịp: ${p.baseClock} GHz (tối đa ${p.maxClock} GHz)`);
      else if (p.maxClock)                  lines.push(`Xung nhịp tối đa: ${p.maxClock} GHz`);
      if (p.cache)                          lines.push(`Cache: ${p.cache} MB`);
      if (attrs['tdp'] != null)             lines.push(`TDP: ${attrs['tdp']} W`);
      break;

    case 'main':
      if (attrs['chipset'])                 lines.push(`Chipset: ${attrs['chipset']}`);
      if (attrs['socket-cpu'])              lines.push(`Socket CPU: ${joinArr(attrs['socket-cpu'])}`);
      if (attrs['loai-ram'])                lines.push(`Loại RAM: ${joinArr(attrs['loai-ram'])}`);
      if (attrs['kich-thuoc-mainboard'])    lines.push(`Kích thước: ${joinArr(attrs['kich-thuoc-mainboard'])}`);
      if (attrs['so-khe-ram'] != null)      lines.push(`Số khe RAM: ${attrs['so-khe-ram']} khe`);
      if (attrs['ram-toi-da']  != null)     lines.push(`RAM tối đa: ${attrs['ram-toi-da']} GB`);
      if (attrs['so-khe-m-2']  != null)     lines.push(`Khe M.2: ${attrs['so-khe-m-2']} khe`);
      if (attrs['pcie-cho-vga'])            lines.push(`PCIe VGA: Gen ${joinArr(attrs['pcie-cho-vga'])}`);
      break;

    case 'ram':
      if (attrs['loai-ram'])                lines.push(`Loại RAM: ${joinArr(attrs['loai-ram'])}`);
      if (attrs['ram'])                     lines.push(`Dung lượng: ${joinArr(attrs['ram'])}`);
      if (attrs['toc-do-bus-ram'])          lines.push(`Bus: ${joinArr(attrs['toc-do-bus-ram'])}`);
      if (attrs['ram-modules'] != null)     lines.push(`Số thanh: ${attrs['ram-modules']} thanh`);
      break;

    case 'hdd': {
      const cap = name.match(/(\d+(?:TB|GB))\s+3\.5"/i)?.[1] || name.match(/(\d+(?:TB|GB))\s+SATA/i)?.[1];
      if (cap)       lines.push(`Dung lượng: ${cap}`);
      if (p.rpm)     lines.push(`Tốc độ quay: ${p.rpm} RPM`);
      if (p.cache)   lines.push(`Cache: ${p.cache} MB`);
      lines.push('Chuẩn kết nối: SATA III (6 Gb/s)');
      lines.push('Hệ số dạng: 3.5 inch');
      break;
    }

    case 'ssd-m2':
      if (p.ssdCap)      lines.push(`Dung lượng: ${p.ssdCap}`);
      lines.push(p.ssdIfaceGen ? `Chuẩn kết nối: PCIe ${p.ssdIfaceGen} NVMe M.2` : 'Chuẩn kết nối: NVMe M.2');
      lines.push('Hệ số dạng: M.2 2280');
      lines.push('Giao thức: NVMe (Non-Volatile Memory Express)');
      break;

    case 'ssd-25':
      if (p.ssdCap) lines.push(`Dung lượng: ${p.ssdCap}`);
      lines.push('Chuẩn kết nối: SATA III (6 Gb/s)');
      lines.push('Hệ số dạng: 2.5 inch');
      lines.push('Giao thức: AHCI');
      break;

    case 'vga':
    case 'vga-like-new':
      if (p.gpuChip)                        lines.push(`Chip đồ họa: ${p.gpuChip}`);
      if (p.vram)                           lines.push(`Bộ nhớ đệm: ${p.vram}`);
      if (attrs['vga-length'] != null)      lines.push(`Chiều dài card: ${attrs['vga-length']} mm`);
      if (attrs['tdp'] != null)             lines.push(`TDP: ${attrs['tdp']} W`);
      if (categorySlug === 'vga-like-new')  lines.push('Tình trạng: Like New (đã qua sử dụng, kiểm định chất lượng)');
      break;

    case 'nguon':
      if (attrs['psu-wattage'] != null)     lines.push(`Công suất: ${attrs['psu-wattage']} W`);
      if (p.psuRating)                      lines.push(`Chuẩn hiệu suất: 80+ ${p.psuRating}`);
      if (p.psuModular)                     lines.push(`Cable management: ${p.psuModular}`);
      lines.push('Chuẩn nguồn: ATX');
      break;

    case 'vo-case': {
      const mb = arr(attrs['kich-thuoc-mainboard']);
      if (mb.length)                              lines.push(`Mainboard hỗ trợ: ${mb.join(', ')}`);
      if (attrs['case-max-vga-length']   != null) lines.push(`VGA tối đa: ${attrs['case-max-vga-length']} mm`);
      if (attrs['case-max-cooler-height']!= null) lines.push(`Tản nhiệt tối đa: ${attrs['case-max-cooler-height']} mm`);
      const rad = arr(attrs['radiator-size']);
      if (rad.length) lines.push(`Hỗ trợ radiator: ${rad.map(r => r + ' mm').join(', ')}`);
      break;
    }

    case 'man-hinh': {
      const sz  = name.match(/(\d{2}(?:\.\d)?)"?\s*(?:IPS|VA|TN|OLED|QHD|FHD|UHD|4K)/i)?.[1] || name.match(/(\d{2}(?:\.\d?)?)"/ )?.[1];
      const res = name.match(/\b(FHD|QHD|4K\s*UHD|UHD)\b/i)?.[1];
      const hz  = name.match(/(\d+)Hz/i)?.[1];
      const pnl = name.match(/\b(IPS|VA|TN|OLED)\b/i)?.[1];
      const ms  = name.match(/(\d+(?:\.\d+)?)ms/i)?.[1];
      const resMap = { FHD:'1920×1080 (Full HD)', QHD:'2560×1440 (QHD)', 'UHD':'3840×2160 (4K UHD)', '4K UHD':'3840×2160 (4K UHD)' };
      if (sz)  lines.push(`Kích thước: ${sz}"`);
      if (res) lines.push(`Độ phân giải: ${resMap[res.toUpperCase()] || res}`);
      if (hz)  lines.push(`Tần số quét: ${hz} Hz`);
      if (pnl) lines.push(`Tấm nền: ${pnl}`);
      if (ms)  lines.push(`Thời gian phản hồi: ${ms} ms`);
      break;
    }

    case 'tan-nhiet-cpu-air': {
      const sockets = joinArr(attrs['socket-cpu']);
      if (sockets)                         lines.push(`Socket hỗ trợ: ${sockets}`);
      if (p.coolerType)                    lines.push(`Cấu hình quạt: ${p.coolerType === 'Dual' ? '2 quạt (Dual Fan)' : '1 quạt (Single Fan)'}`);
      if (p.fanSize)                       lines.push(`Kích thước quạt: ${p.fanSize} mm`);
      if (attrs['cooler-height'] != null)  lines.push(`Chiều cao: ${attrs['cooler-height']} mm`);
      if (p.heatpipe)                      lines.push(`Số heatpipe: ${p.heatpipe} ống đồng`);
      break;
    }

    case 'tan-nhiet-cpu-aio': {
      const sockets = joinArr(attrs['socket-cpu']);
      if (sockets) lines.push(`Socket hỗ trợ: ${sockets}`);
      const radSize = parseInt(joinArr(attrs['radiator-size']));
      if (radSize)  lines.push(`Kích thước radiator: ${radSize} mm`);
      lines.push('Loại: Tản nhiệt nước vòng kín (AIO)');
      if (radSize === 360)      lines.push('Quạt đi kèm: 3 × 120 mm');
      else if (radSize === 280) lines.push('Quạt đi kèm: 2 × 140 mm');
      else if (radSize === 240) lines.push('Quạt đi kèm: 2 × 120 mm');
      break;
    }

    case 'tan-nhiet-cpu-custom': {
      const sockets = joinArr(attrs['socket-cpu']);
      if (sockets)       lines.push(`Socket hỗ trợ: ${sockets}`);
      lines.push('Loại: Tản nhiệt nước vòng mở (Custom Loop)');
      if (p.fanSize)     lines.push(`Kích thước radiator: ${p.fanSize} mm`);
      if (p.tubingType)  lines.push(`Ống dẫn: ${p.tubingType === 'Soft' ? 'Ống mềm (Soft Tubing)' : 'Ống cứng (Hard Tubing)'}`);
      break;
    }

    case 'ban-phim': {
      const wl = /wireless|không dây/i.test(name);
      lines.push(`Kết nối: ${wl ? 'Không dây (Bluetooth / USB) + Có dây' : 'Có dây (USB)'}`);
      const layout = name.match(/\b(TKL|96%|75%|65%|Full.?Size)\b/i)?.[1];
      if (layout) lines.push(`Bố cục phím: ${layout}`);
      lines.push('Loại switch: Cơ học (Mechanical)');
      lines.push('Hệ điều hành hỗ trợ: Windows / macOS');
      break;
    }

    case 'ban-phim-chuot': {
      const wl = /wireless|không dây/i.test(name);
      lines.push('Loại: Bộ combo bàn phím + chuột');
      lines.push(`Kết nối: ${wl ? 'Không dây (2.4 GHz USB Receiver)' : 'Có dây (USB)'}`);
      lines.push('Phạm vi hoạt động (không dây): tới 10 m');
      lines.push('Hệ điều hành hỗ trợ: Windows / macOS');
      break;
    }

    case 'chuot': {
      const wl = /wireless|không dây/i.test(name);
      lines.push(`Kết nối: ${wl ? 'Không dây (2.4 GHz / Bluetooth)' : 'Có dây (USB)'}`);
      lines.push('Loại: Chuột gaming quang học');
      lines.push(`Bảo hành: ${warrantyMonths} tháng`);
      lines.push('Hệ điều hành hỗ trợ: Windows / macOS');
      break;
    }

    case 'tai-nghe': {
      const wl = /wireless|không dây/i.test(name);
      lines.push(`Kết nối: ${wl ? 'Không dây (Wireless 2.4 GHz)' : '3.5 mm Jack'}`);
      lines.push('Kiểu đeo: Chụp tai (Over-ear)');
      lines.push('Tính năng: Surround âm thanh ảo 7.1');
      lines.push('Micro: Có mic tích hợp (có thể tháo rời)');
      break;
    }

    case 'loa': {
      const config = name.match(/\b(2\.0|2\.1|5\.1)\b/)?.[1];
      const power  = name.match(/(\d+W)\s+(?:RMS|THX)/i)?.[1];
      if (config) lines.push(`Cấu hình: ${config}`);
      if (power)  lines.push(`Công suất: ${power} RMS`);
      lines.push('Chuẩn kết nối: 3.5 mm / RCA');
      lines.push('Nguồn điện: Adapter DC');
      break;
    }

    case 'ghe-gaming': {
      lines.push('Loại: Ghế gaming');
      const mat = name.match(/(SoftWeave|Fabric|Leather|PU\s*Leather)/i)?.[1];
      const matMap = { SoftWeave:'Vải SoftWeave Plus', Fabric:'Vải breathable', Leather:'Da thật', 'PU Leather':'Da PU', PU:'Da PU' };
      if (mat) lines.push(`Chất liệu bọc: ${matMap[mat] || mat}`);
      lines.push('Khung: Thép gia cường');
      lines.push('Tải trọng tối đa: 130 kg');
      break;
    }

    case 'quat-case': {
      if (p.fanSize) lines.push(`Kích thước: ${p.fanSize} mm`);
      const count = p.fanPack ? parseInt(p.fanPack) : /Triple/i.test(name) ? 3 : /Dual/i.test(name) ? 2 : 1;
      lines.push(`Số lượng: ${count} quạt / bộ`);
      lines.push(`Đèn: ${/ARGB|RGB/i.test(name) ? 'ARGB / RGB' : 'Không đèn'}`);
      lines.push(`Điều chỉnh tốc độ: ${/PWM/i.test(name) ? 'PWM (4-pin)' : '3-pin DC'}`);
      break;
    }

    default:
      lines.push(`Danh mục: ${categorySlug}`);
  }

  // Pad to minimum 4
  const fallbacks = [`Bảo hành: ${warrantyMonths} tháng`, 'Chính hãng, nhập khẩu chính thức', 'Hỗ trợ kỹ thuật toàn quốc', 'Kiểm tra chất lượng trước khi xuất kho'];
  let fi = 0;
  while (lines.length < 4) lines.push(fallbacks[fi++]);

  return lines.slice(0, 8);
}

// ─── stats ────────────────────────────────────────────────────────────────────
const stats = { caCreated:0, caSkipped:0, attrUpdated:0, attrSkipped:0, hsCreated:0, hsSkipped:0, specCreated:0, specSkipped:0, warrantyReordered:0 };

// ─── B1 ───────────────────────────────────────────────────────────────────────
async function b1AssignCategoryAttributes() {
  console.log('\n[B1] CategoryAttribute assignments (add-only)...');
  const slugs  = [...new Set(CATEGORY_ATTR_ROWS.map(r => r.categorySlug))];
  const cats   = await prisma.category.findMany({ where: { slug: { in: slugs } }, select: { id:true, slug:true } });
  const catMap = Object.fromEntries(cats.map(c => [c.slug, c.id]));

  for (const slug of slugs) {
    if (!catMap[slug]) throw new Error(`[B1] Category slug not found in DB: "${slug}"`);
  }

  const attrIds  = [...new Set(CATEGORY_ATTR_ROWS.map(r => r.attributeId))];
  const existing = await prisma.categoryAttribute.findMany({
    where: { categoryId: { in: Object.values(catMap) }, attributeId: { in: attrIds } },
    select: { categoryId:true, attributeId:true },
  });
  const existSet = new Set(existing.map(r => `${r.categoryId}:${r.attributeId}`));

  for (const row of CATEGORY_ATTR_ROWS) {
    const catId = catMap[row.categorySlug];
    if (existSet.has(`${catId}:${row.attributeId}`)) { stats.caSkipped++; continue; }
    if (DRY) {
      console.log(`  [DRY] Would add: category=${row.categorySlug} attr=${row.attributeId}`);
      stats.caCreated++;
    } else {
      await prisma.categoryAttribute.create({
        data: { categoryId: catId, attributeId: row.attributeId, sortOrder: row.sortOrder,
                isRequired: false, showInForm: true, showInDetail: true,
                usedInFilter: false, requiredForBuildPC: false },
      });
      console.log(`  + Added: category=${row.categorySlug} attr=${row.attributeId}`);
      stats.caCreated++;
    }
  }
  console.log(`  => Created: ${stats.caCreated}, Skipped: ${stats.caSkipped}`);
}

// ─── B2 ───────────────────────────────────────────────────────────────────────
async function b2FlipUsedInBuildPC() {
  console.log('\n[B2] usedInBuildPC = true for attrs 49-55...');
  const attrs = await prisma.attribute.findMany({
    where: { id: { in: USED_IN_BUILD_PC_ATTR_IDS } },
    select: { id:true, name:true, usedInBuildPC:true },
  });
  for (const attr of attrs) {
    if (attr.usedInBuildPC) { stats.attrSkipped++; continue; }
    if (DRY) {
      console.log(`  [DRY] Would set usedInBuildPC=true for attr ${attr.id} (${attr.name})`);
      stats.attrUpdated++;
    } else {
      await prisma.attribute.update({ where: { id: attr.id }, data: { usedInBuildPC: true } });
      console.log(`  + Updated attr ${attr.id} (${attr.name})`);
      stats.attrUpdated++;
    }
  }
  console.log(`  => Updated: ${stats.attrUpdated}, Already true: ${stats.attrSkipped}`);
}

// ─── B3 ───────────────────────────────────────────────────────────────────────
async function b3AddHighlightSpecs(products, productDbMap) {
  console.log('\n[B3] ProductHighlightSpec...');
  for (const product of products) {
    const db = productDbMap.get(product.sku);
    if (!db) continue;

    const lines = buildHighlightSpecs(product);
    if (lines.length < 4) throw new Error(`[B3] ${product.sku} generated only ${lines.length} lines (min 4)`);

    const existing = await prisma.productHighlightSpec.findMany({ where: { productId: db.id }, select: { content:true } });
    if (existing.length > 0) {
      stats.hsSkipped += existing.length;
      continue; // preserve existing (including manual edits)
    }

    if (DRY) {
      console.log(`  [DRY] ${product.sku}: ${lines.length} lines`);
      stats.hsCreated += lines.length;
    } else {
      await prisma.productHighlightSpec.createMany({
        data: lines.map((content, i) => ({ productId: db.id, content, sortOrder: (i + 1) * 10 })),
      });
      stats.hsCreated += lines.length;
    }
  }
  console.log(`  => Created: ${stats.hsCreated} lines, Skipped (already had specs): ${stats.hsSkipped} lines`);
}

// ─── B4 ───────────────────────────────────────────────────────────────────────
async function b4AddProductSpecs(products, productDbMap) {
  console.log('\n[B4] ProductSpecification supplementary specs...');
  const WARRANTY_SO = 9999;

  for (const product of products) {
    const db       = productDbMap.get(product.sku);
    const newSpecs = product.specs || [];
    if (!db || newSpecs.length === 0) continue;

    const existing     = await prisma.productSpecification.findMany({ where: { productId: db.id }, select: { id:true, name:true, sortOrder:true } });
    const existingNames = new Set(existing.map(e => e.name));

    let so = 10;
    for (const spec of newSpecs) {
      if (existingNames.has(spec.name)) { stats.specSkipped++; continue; }
      if (DRY) {
        console.log(`  [DRY] ${product.sku}: add "${spec.name}"`);
        stats.specCreated++;
      } else {
        await prisma.productSpecification.create({ data: { productId: db.id, name: spec.name, value: spec.value, sortOrder: so } });
        stats.specCreated++;
      }
      so += 10;
    }

    const warrantyRow = existing.find(e => e.name === 'Bảo hành');
    if (warrantyRow && warrantyRow.sortOrder !== WARRANTY_SO) {
      if (DRY) { stats.warrantyReordered++; }
      else {
        await prisma.productSpecification.update({ where: { id: warrantyRow.id }, data: { sortOrder: WARRANTY_SO } });
        stats.warrantyReordered++;
      }
    }
  }
  console.log(`  => Created: ${stats.specCreated}, Skipped: ${stats.specSkipped}, Warranty reordered: ${stats.warrantyReordered}`);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function runCleanup(productDbMap) {
  console.log('\n[CLEANUP] Removing highlight specs and supplementary specs for SEED- products...');
  console.log('          CategoryAttribute rows are NOT removed.');
  const ids = [...productDbMap.values()].map(p => p.id);
  if (!ids.length) { console.log('  No SEED- products found.'); return; }

  if (DRY) {
    const hs   = await prisma.productHighlightSpec.count({ where: { productId: { in: ids } } });
    const spec = await prisma.productSpecification.count({ where: { productId: { in: ids }, name: { not: 'Bảo hành' } } });
    console.log(`  [DRY] Would delete ${hs} highlight rows, ${spec} supplementary spec rows`);
  } else {
    const hs   = await prisma.productHighlightSpec.deleteMany({ where: { productId: { in: ids } } });
    const spec = await prisma.productSpecification.deleteMany({ where: { productId: { in: ids }, name: { not: 'Bảo hành' } } });
    console.log(`  Deleted: ${hs.count} highlight rows, ${spec.count} supplementary spec rows`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== seedBuildPcAdminData ${DRY ? '[DRY RUN]' : CLEANUP ? '[CLEANUP]' : '[LIVE]'} ===`);

  const data     = require(JSON_FILE);
  const products = data.products.filter(p => p.sku.startsWith(SEED_PREFIX));
  console.log(`Loaded ${products.length} SEED- products from JSON`);

  // Validate all SKUs exist in DB
  const skus    = products.map(p => p.sku);
  const dbProds = await prisma.product.findMany({ where: { sku: { in: skus } }, select: { id:true, sku:true } });
  const productDbMap = new Map(dbProds.map(p => [p.sku, p]));
  const missing = skus.filter(s => !productDbMap.has(s));
  if (missing.length) throw new Error(`[VALIDATION] ${missing.length} SKU(s) missing from DB:\n  ${missing.join('\n  ')}`);
  console.log(`All ${skus.length} SEED- SKUs verified in DB`);

  if (CLEANUP) { await runCleanup(productDbMap); return; }

  await b1AssignCategoryAttributes();
  await b2FlipUsedInBuildPC();
  await b3AddHighlightSpecs(products, productDbMap);
  await b4AddProductSpecs(products, productDbMap);

  console.log('\n=== Summary ===');
  console.log(`CategoryAttribute  — Created: ${stats.caCreated}, Skipped: ${stats.caSkipped}`);
  console.log(`Attribute flags    — Updated: ${stats.attrUpdated}, Already true: ${stats.attrSkipped}`);
  console.log(`Highlight specs    — Created: ${stats.hsCreated}, Skipped: ${stats.hsSkipped}`);
  console.log(`Suppl. specs       — Created: ${stats.specCreated}, Skipped: ${stats.specSkipped}`);
  console.log(`Bảo hành reordered — ${stats.warrantyReordered}`);
  if (DRY) console.log('\n[DRY RUN] No changes written to DB.');
}

main()
  .catch(e => { console.error('\n[ERROR]', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
