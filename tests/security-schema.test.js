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
