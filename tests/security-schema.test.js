const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('every private planner table has row-level security enabled', () => {
  assert.match(schema, /alter table public\.planner_items enable row level security/i);
  assert.match(schema, /alter table public\.planner_settings enable row level security/i);
});

test('all CRUD policies bind access to the authenticated owner', () => {
  const policies = schema.match(/create policy[\s\S]*?;/gi) || [];
  assert.equal(policies.length, 8, 'expected SELECT/INSERT/UPDATE/DELETE policies for both tables');
  for (const policy of policies) {
    assert.match(policy, /to authenticated/i, 'policy must target authenticated role');
    assert.match(policy, /auth\.uid\(\)/i, 'policy must check the signed-in user');
  }
  assert.match(schema, /with check\s*\(\s*\(select auth\.uid\(\)\)\s*=\s*user_id\s*\)/i);
});

test('anonymous users are not granted table access', () => {
  assert.match(schema, /revoke all on table public\.planner_items from anon, authenticated/i);
  assert.match(schema, /revoke all on table public\.planner_settings from anon, authenticated/i);
  assert.doesNotMatch(schema, /grant\s+[^;]*\bto\s+anon\b/i);
});

test('sensitive text fields have server-side length limits', () => {
  assert.match(schema, /char_length\(trim\(title\)\) between 1 and 180/i);
  assert.match(schema, /char_length\(notes\) <= 2000/i);
});

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('local backup import is bounded, validated, and requires confirmation before replacing data', () => {
  assert.match(app, /function validBackup\(data\)/);
  assert.match(app, /data\.items\.length > 10000/);
  assert.match(app, /file\.size > 2 \* 1024 \* 1024/);
  assert.match(app, /Текущие записи на этом устройстве будут заменены/);
  assert.match(app, /family-planner-backup/);
});

test('mobile settings offer explicit backup and local data deletion controls', () => {
  assert.match(html, /id="settingsDialog"/);
  assert.match(html, /id="exportBackup"/);
  assert.match(html, /id="importBackup"/);
  assert.match(html, /id="clearAllData"/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('production build publishes only the PWA shell and icons', () => {
  const dist = path.join(__dirname, '..', 'dist');
  for (const file of ['index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.webmanifest']) {
    assert.ok(fs.existsSync(path.join(dist, file)), 'missing built asset: ' + file);
  }
  assert.ok(fs.existsSync(path.join(dist, 'icons', 'leaf.svg')));
  assert.equal(fs.existsSync(path.join(dist, 'supabase')), false);
  assert.equal(fs.existsSync(path.join(dist, 'tests')), false);
});

test('calendar uses Monday-first fixed six-week grid and clear date selection', () => {
  assert.match(app, /\(first\.getDay\(\)\+6\)%7/);
  assert.match(app, /for\(let i=0;i<42;i\+\+\)/);
  assert.match(app, /data-month-today/);
  assert.match(app, /aria-pressed=/);
  assert.match(app, /calendar-legend/);
});

test('events can be exported as iCalendar files for manual iPhone Calendar import', () => {
  assert.match(app, /function exportCalendarEvent\(id\)/);
  assert.match(app, /BEGIN:VCALENDAR/);
  assert.match(app, /DTSTART;VALUE=DATE/);
  assert.match(app, /data-ics=/);
  assert.match(html, /id="itemReminder"/);
  assert.match(app, /remindBefore:Number\(\$\('#itemReminder'\)\.value\)/);
});

test('all multi-element event bindings use querySelectorAll rather than a single element', () => {
  const bindingLines = app.split('\\n').filter(line => line.includes('.forEach(') && line.includes('addEventListener'));
  assert.ok(bindingLines.length > 10, 'expected dynamic and static event bindings');
  for (const line of bindingLines) assert.match(line, /\\$\\$\\(/, 'multi-element event binding must use querySelectorAll: ' + line);
  assert.match(app, /\\$\\$\\('\\.tab'\\)\\.forEach/);
  assert.match(app, /\\$\\$\\('\\[data-month\\]'\\)\\.forEach/);
  assert.match(app, /\\$\\$\\('\\[data-date\\]'\\)\\.forEach/);
});

test('event editor can always be dismissed without satisfying required fields', () => {
  assert.match(html, /id="closeItemDialog" type="button"/);
  assert.match(html, /data-close-item/);
  assert.match(app, /itemDialog\.addEventListener\('cancel'/);
  assert.match(app, /itemDialog\.addEventListener\('close'/);
  assert.match(app, /if\(event\.target===itemDialog\) itemDialog\.close\(\)/);
});
test('dynamic view buttons are scoped to the view container to avoid duplicate navigation listeners', () => {
  assert.match(app, /\$\$\('\[data-view\]', \$\('#view'\)\)\.forEach/);
});
