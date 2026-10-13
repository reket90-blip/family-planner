const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('every private planner table has row-level security enabled', () => {
  assert.match(schema, /alter table public\.planner_items enable row level security/i);
  assert.match(schema, /alter table public\.planner_settings enable row level security/i);
  assert.match(schema, /alter table public\.push_subscriptions enable row level security/i);
  assert.match(schema, /alter table public\.push_delivery_log enable row level security/i);
  assert.match(schema, /alter table private\.planner_allowed_users enable row level security/i);
});

test('all CRUD policies bind access to the authenticated owner', () => {
  const policies = schema.match(/create policy[\s\S]*?;/gi) || [];
  assert.equal(policies.length, 14, 'expected owner-only policies for planner, push subscriptions, delivery status and allowlist');
  for (const policy of policies) {
    assert.match(policy, /to authenticated/i, 'policy must target authenticated role');
    assert.match(policy, /auth\.uid\(\)/i, 'policy must check the signed-in user');
  }
  assert.match(schema, /with check\s*\(\s*\(select auth\.uid\(\)\)\s*=\s*user_id\s+and\s+\(select public\.is_planner_allowed_user\(\)\)\s*\)/i);
});

test('anonymous users are not granted table access', () => {
  assert.match(schema, /revoke all on table public\.planner_items from anon, authenticated/i);
  assert.match(schema, /revoke all on table public\.planner_settings from anon, authenticated/i);
  assert.match(schema, /revoke all on table public\.push_subscriptions from anon, authenticated/i);
  assert.match(schema, /revoke all on table public\.push_delivery_log from anon, authenticated/i);
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
  assert.match(app, /remindBefore:reminderDate\?0:\(Number\(\$\('#itemReminder'\)\.value\)\|\|0\)/);
});

test('all multi-element event bindings use querySelectorAll rather than a single element', () => {
  const bindingLines = app.split('\n').filter(line => line.includes('.forEach(') && line.includes('addEventListener'));
  assert.ok(bindingLines.length > 10, 'expected dynamic and static event bindings');
  for (const line of bindingLines) assert.ok(line.includes('$$('), 'multi-element event binding must use querySelectorAll: ' + line);
  assert.ok(app.includes("$$('.tab').forEach"));
  assert.ok(app.includes("$$('[data-month]').forEach"));
  assert.ok(app.includes("$$('[data-date]').forEach"));
});

test('event editor cancel controls bypass native validation and close via method=dialog', () => {
  assert.match(html, /<form id="itemForm" method="dialog">/);
  assert.match(html, /id="closeItemDialog" type="submit" formnovalidate data-cancel-item value="cancel"/);
  assert.match(html, /type="submit" formnovalidate data-cancel-item value="cancel">Отмена/);
  assert.match(app, /if \(e\.submitter\?\.hasAttribute\('data-cancel-item'\)\) return;/);
  assert.match(app, /itemDialog\.addEventListener\('close'/);
  assert.match(app, /if\(event\.target===itemDialog\) itemDialog\.close\(\)/);
});
test('dynamic view buttons are scoped to the view container to avoid duplicate navigation listeners', () => {
  assert.match(app, /\$\$\('\[data-view\]', \$\('#view'\)\)\.forEach/);
});

test('push reminders are server-scheduled and the browser only holds a publishable key', () => {
  assert.ok(schema.includes('add column if not exists remind_before'));
  assert.ok(schema.includes('create table if not exists public.push_subscriptions'));
  assert.ok(schema.includes('create table if not exists public.push_delivery_log'));
  assert.ok(schema.includes('get_due_planner_reminders'));
  assert.ok(schema.includes('private.planner_allowed_users'));
  assert.ok(schema.includes('public.is_planner_allowed_user()'));
  assert.match(app, /cloud\.rpc\('is_planner_allowed_user'\)/);
  assert.ok(app.includes('togglePushNotifications'));
  assert.ok(app.includes('pushManager.subscribe'));
  assert.ok(html.includes('id="authGate"'));
  assert.ok(html.includes('id="togglePush"'));
  assert.ok(app.includes('sb_publishable_'));
  assert.doesNotMatch(app, /service_role|VAPID_PRIVATE_KEY/i);
});
