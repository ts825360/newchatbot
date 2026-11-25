import { backup, DatabaseSync } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve(process.env.CHURCH_DATA_DIR || path.join(process.cwd(), '.local', 'server'));
const destination = path.join(root, 'backups', `church-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}.sqlite`);
if (!process.argv.includes('--backup')) {
  process.stdout.write('Usage: node scripts/backup-server.mjs --backup\nCreates a private consistent SQLite backup including uploaded files. Keep its directory private.\n');
} else {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const source = new DatabaseSync(path.join(root, 'church.sqlite'), { readOnly: true });
  try { await backup(source, destination); if (process.platform !== 'win32') await chmod(destination, 0o600); process.stdout.write('Private database backup created in the configured data directory.\n'); }
  finally { source.close(); }
}
