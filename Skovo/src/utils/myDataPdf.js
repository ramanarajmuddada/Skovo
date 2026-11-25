// Turns the /profile/my-data export into a readable PDF. jsPDF is imported on
// click so it never weighs on the main bundle.

const TITLES = {
  account: 'Account', profile: 'Profile', stages: 'Education stages', readiness: 'Readiness score',
  points_history: 'Points history', streak: 'Streak', streak_days: 'Streak days',
  quiz_attempts: 'Quiz attempts', task_submissions: 'Task submissions', enrollments: 'Cohort enrolments',
  payments: 'Payments', wallet: 'Wallet', coins: 'Coins', communities: 'Communities',
  community_messages: 'Community messages', leaderboard_profile: 'Leaderboard profile',
  consents: 'Consents', notifications: 'Notifications',
};

// Internal identifiers mean nothing to a student.
const HIDDEN = /(^|_)(id|uuid|user_id|created_by|updated_by|password|token|hash)$/i;
const SKIP_COLS = new Set(['user_id', 'id', 'created_by', 'updated_by', 'deleted_at']);

const label = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }
  return String(v);
}

const keep = (k) => !SKIP_COLS.has(k) && !HIDDEN.test(k);

export async function downloadMyDataPdf(data) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = [autoTableMod.default, autoTableMod.default?.default, autoTableMod.autoTable]
    .find((f) => typeof f === 'function');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 56;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('My SKOVO data', 40, y); y += 22;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100);
  const when = data.exported_at ? new Date(data.exported_at) : new Date();
  doc.text(`Prepared ${when.toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}`, 40, y);
  doc.setTextColor(0); y += 14;

  const section = (title) => {
    if (y > 740) { doc.addPage(); y = 56; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(title, 40, y + 18); y += 26;
  };
  const after = () => { y = doc.lastAutoTable.finalY + 14; };
  const base = { styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
                 headStyles: { fillColor: [37, 99, 235] }, margin: { left: 40, right: 40 }, theme: 'striped' };

  // The account block is a single record.
  const acct = Object.entries(data.account || {}).filter(([k]) => keep(k));
  if (acct.length) {
    section(TITLES.account);
    autoTable(doc, { ...base, startY: y, body: acct.map(([k, v]) => [label(k), fmt(v)]),
                     columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } } });
    after();
  }

  for (const [key, rows] of Object.entries(data)) {
    if (key === 'account' || key === 'exported_at' || !Array.isArray(rows)) continue;
    if (!rows.length) continue;
    section(TITLES[key] || label(key));
    const cols = Object.keys(rows[0]).filter((c) => keep(c) && rows.some((r) => r[c] !== null && r[c] !== ''));
    if (rows.length === 1 && cols.length > 4) {
      // One record with many fields reads better as a two-column list.
      autoTable(doc, { ...base, startY: y, body: cols.map((c) => [label(c), fmt(rows[0][c])]),
                       columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } } });
    } else {
      autoTable(doc, { ...base, startY: y, head: [cols.map(label)], body: rows.map((r) => cols.map((c) => fmt(r[c]))) });
    }
    after();
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`SKOVO · page ${i} of ${pages}`, W / 2, 820, { align: 'center' });
  }
  doc.save('skovo-my-data.pdf');
}
