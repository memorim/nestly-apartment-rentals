export function contactRetentionDays(value = process.env.CONTACT_RETENTION_DAYS ?? '0') {
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(days) || days < 0 || days > 3650)
    throw new Error('CONTACT_RETENTION_DAYS must be 0–3650');
  return days;
}

export function purgeContacts(db, time, days = contactRetentionDays()) {
  if (!days) return;
  return db.prepare("UPDATE inquiries SET name='[removed]',phone='',message='' WHERE created_at<? AND phone!=''")
    .run(new Date(time - days * 86400000).toISOString());
}

export const clearContact = (db, id) =>
  db.prepare("UPDATE inquiries SET name='[removed]',phone='',message='' WHERE id=?").run(id);

export async function contactsCsv(db) {
  const columns = ['id', 'listing_id', 'name', 'phone', 'message', 'created_at'];
  const rows = await db.prepare('SELECT ' + columns.join(',') + ' FROM inquiries ORDER BY id').all();
  const csvCell = value => {
    let text = String(value ?? '');
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
}
