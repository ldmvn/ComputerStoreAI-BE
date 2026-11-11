// Chuyển ảnh trong uploads/ lên Cloudflare R2 và đổi địa chỉ ảnh trong DB sang tên miền R2.
//
//   node scripts/migrate-media-to-r2.mjs                       chạy thử: chỉ liệt kê, KHÔNG ghi gì (R2 hay DB)
//   node scripts/migrate-media-to-r2.mjs --upload              đẩy file chưa có lên R2 (không xóa file trên đĩa)
//   node scripts/migrate-media-to-r2.mjs --rewrite-db          đổi /media/... trong DB thành địa chỉ R2 (có sao lưu)
//   node scripts/migrate-media-to-r2.mjs --restore=<file>      khôi phục giá trị cũ từ file sao lưu
//   thêm --force để bỏ qua việc chặn khi có ảnh được DB nhắc tới nhưng chưa có trên R2
//
// Script chạy lại nhiều lần an toàn: file đã có trên R2 được bỏ qua, giá trị DB đã đổi không bị đổi lại.

import '../src/config/env.js';
import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/config/prisma.js';
import { assertR2Configured, contentTypeFor, objectExists, putObject, r2PublicBase } from '../src/services/objectStorage.service.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const restoreFile = args.find(a => a.startsWith('--restore='))?.slice('--restore='.length);
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const uploadsRoot = path.resolve(process.env.MEDIA_STORAGE_DIR || path.join(backendRoot, 'uploads'));
const backupDir = path.join(backendRoot, '.tmp', 'media-migration');
const TEXT_TYPES = ['varchar', 'char', 'tinytext', 'text', 'mediumtext', 'longtext', 'json'];
// Chỉ đổi ảnh của chính web này: đường dẫn tương đối /media/..., hoặc địa chỉ tuyệt đối trỏ về localhost / ducmanh.store.
// Liên kết /media/ của trang web khác (ví dụ https://trang-khac.vn/media/x) được giữ nguyên.
const MEDIA_PATTERN = /(?:https?:\/\/(?:localhost|127\.0\.0\.1|(?:www\.)?ducmanh\.store)(?::\d+)?|(?<![A-Za-z0-9.\-:/]))\/media\/([^\s"'<>)\\]+)/g;

const quote = name => `\`${String(name).replace(/`/g, '')}\``;
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

async function walk(directory, base = '') {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // .temporary-* là file rác của bước upload, không phải ảnh đang dùng
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

async function restore(file) {
  const backup = JSON.parse(await readFile(file, 'utf8'));
  let restored = 0;
  for (const column of backup.columns) {
    for (const row of column.rows) {
      const where = column.primaryKey.map(key => `${quote(key)} = ?`).join(' AND ');
      restored += Number(await prisma.$executeRawUnsafe(`UPDATE ${quote(column.table)} SET ${quote(column.column)} = ? WHERE ${where}`, row.old, ...column.primaryKey.map(key => row.pk[key])));
    }
  }
  console.log(`Đã khôi phục ${restored} giá trị từ ${file}`);
}

async function scanDatabase(base) {
  const columns = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN (${TEXT_TYPES.map(t => `'${t}'`).join(',')}) AND TABLE_NAME <> '_prisma_migrations'`);
  const primaryKeys = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`);
  const pkByTable = new Map();
  for (const row of primaryKeys) pkByTable.set(row.tableName, [...(pkByTable.get(row.tableName) || []), row.columnName]);

  const found = [];
  for (const { tableName, columnName } of columns) {
    const primaryKey = pkByTable.get(tableName);
    if (!primaryKey?.length) continue;
    const select = primaryKey.map(quote).join(', ');
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ${select}, CAST(${quote(columnName)} AS CHAR) AS v FROM ${quote(tableName)} WHERE CAST(${quote(columnName)} AS CHAR) LIKE '%/media/%'`);
    if (!rows.length) continue;
    const changed = rows.map(row => ({
      pk: Object.fromEntries(primaryKey.map(key => [key, typeof row[key] === 'bigint' ? Number(row[key]) : row[key]])),
      old: row.v,
      next: row.v.replace(MEDIA_PATTERN, (_match, key) => `${base}/${key}`),
    })).filter(row => row.next !== row.old);
    if (changed.length) found.push({ table: tableName, column: columnName, primaryKey, rows: changed });
  }
  return found;
}

async function main() {
  if (restoreFile) return restore(restoreFile);

  assertR2Configured();
  const base = r2PublicBase();
  const doUpload = flag('--upload');
  const doRewrite = flag('--rewrite-db');
  console.log(`Chế độ: ${doUpload || doRewrite ? [doUpload && 'UPLOAD', doRewrite && 'SỬA DB'].filter(Boolean).join(' + ') : 'CHẠY THỬ (không ghi gì)'}`);
  console.log(`Thư mục ảnh: ${uploadsRoot}`);
  console.log(`Tên miền R2: ${base}\n`);

  // 1. File trên đĩa
  const keys = (await walk(uploadsRoot)).sort();
  const sizes = new Map();
  for (const key of keys) sizes.set(key, (await import('node:fs/promises').then(fs => fs.stat(path.join(uploadsRoot, key)))).size);
  const total = keys.reduce((sum, key) => sum + sizes.get(key), 0);
  const byFolder = new Map();
  for (const key of keys) byFolder.set(key.split('/')[0], (byFolder.get(key.split('/')[0]) || 0) + 1);
  console.log(`== Ảnh trên đĩa: ${keys.length} file, ${mb(total)} (bỏ qua thư mục .temporary-*)`);
  for (const [folder, count] of byFolder) console.log(`   ${folder.padEnd(16)} ${count} file`);

  const exists = new Map();
  await mapLimit(keys, 8, async key => exists.set(key, await objectExists(key)));
  let missing = keys.filter(key => !exists.get(key));
  console.log(`\n== Trên R2: đã có ${keys.length - missing.length}, chưa có ${missing.length} (${mb(missing.reduce((sum, key) => sum + sizes.get(key), 0))})`);

  if (doUpload && missing.length) {
    let done = 0;
    await mapLimit(missing, 6, async key => {
      await putObject(key, await readFile(path.join(uploadsRoot, key)), contentTypeFor(key));
      done += 1;
      if (done % 25 === 0 || done === missing.length) console.log(`   đã upload ${done}/${missing.length}`);
    });
    await mapLimit(keys, 8, async key => exists.set(key, await objectExists(key)));
    missing = keys.filter(key => !exists.get(key));
    console.log(`   Kiểm tra lại sau upload: còn thiếu ${missing.length}`);
  } else if (!doUpload && missing.length) {
    console.log('   (chạy thử: chưa upload gì. Thêm --upload để đẩy các file này lên R2)');
  }

  // 2. Địa chỉ ảnh trong DB
  const found = await scanDatabase(base);
  const referenced = new Set();
  for (const column of found) for (const row of column.rows) for (const match of row.old.matchAll(MEDIA_PATTERN)) referenced.add(match[1]);
  console.log(`\n== Địa chỉ /media/ trong DB: ${found.reduce((sum, c) => sum + c.rows.length, 0)} giá trị ở ${found.length} cột`);
  for (const column of found) {
    console.log(`   ${`${column.table}.${column.column}`.padEnd(44)} ${String(column.rows.length).padStart(4)} dòng`);
    console.log(`      ví dụ: ${column.rows[0].old.slice(0, 90).replace(/\s+/g, ' ')}\n          →  ${column.rows[0].next.slice(0, 90).replace(/\s+/g, ' ')}`);
  }

  // Ảnh được DB nhắc tới nhưng không có trên R2 thì đổi địa chỉ sẽ làm ảnh vỡ.
  const notOnR2 = [];
  await mapLimit([...referenced], 8, async key => {
    const known = exists.get(key);
    if (known === true) return;
    if (known === undefined && await objectExists(key)) return;
    notOnR2.push(key);
  });
  console.log(`\n== Ảnh được DB nhắc tới: ${referenced.size}, chưa có trên R2: ${notOnR2.length}`);
  if (notOnR2.length) console.log(`   ví dụ: ${notOnR2.slice(0, 5).join(', ')}${notOnR2.length > 5 ? ' ...' : ''}  (có thể là ảnh đã mất sẵn trên đĩa)`);

  if (doRewrite) {
    if (notOnR2.length && !flag('--force')) {
      console.log('\nDỪNG: còn ảnh DB nhắc tới mà chưa có trên R2. Chạy --upload trước, hoặc thêm --force nếu chắc chắn muốn bỏ qua.');
      process.exitCode = 1;
      return;
    }
    await mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `db-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), base, columns: found }, null, 1));
    console.log(`\nĐã sao lưu giá trị cũ: ${backupPath}`);
    let updated = 0;
    for (const column of found) {
      await prisma.$transaction(async tx => {
        for (const row of column.rows) {
          const where = column.primaryKey.map(key => `${quote(key)} = ?`).join(' AND ');
          updated += Number(await tx.$executeRawUnsafe(`UPDATE ${quote(column.table)} SET ${quote(column.column)} = ? WHERE ${where}`, row.next, ...column.primaryKey.map(key => row.pk[key])));
        }
      });
    }
    console.log(`Đã đổi ${updated} giá trị trong DB. Khôi phục: node scripts/migrate-media-to-r2.mjs --restore="${backupPath}"`);
  } else if (found.length) {
    console.log('\n(chạy thử: chưa sửa DB. Thêm --rewrite-db sau khi đã upload xong)');
  }
}

main()
  .catch(error => { console.error('LỖI:', error.name, error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
