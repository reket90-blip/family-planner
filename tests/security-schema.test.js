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
