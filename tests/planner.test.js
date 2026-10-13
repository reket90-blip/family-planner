'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013152214_add_absolute_reminder_schedule.sql'), 'utf8');
const anonymousMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013160000_allow_anonymous_planner_users.sql'), 'utf8');

function extractDateOrdinal() {
  const match = app.match(/const dateOrdinal = value => \{[\s\S]*?\n  \};/);
  assert.ok(match, 'dateOrdinal helper should exist in app.js');
  const expression = match[0].replace(/^\s*const dateOrdinal = /, '').replace(/;\s*$/, '');
  return vm.runInNewContext('(' + expression + ')');
}

function extractWeekText() {
  const match = app.match(/function weekText\(week\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'weekText helper should exist in app.js');
  return vm.runInNewContext('(' + match[0] + ')');
}

test('date arithmetic uses calendar days, including leap day', () => {
  const dateOrdinal = extractDateOrdinal();
  assert.equal(dateOrdinal('2026-10-13') - dateOrdinal('2026-10-12'), 1);
  assert.equal(dateOrdinal('2024-03-01') - dateOrdinal('2024-02-28'), 2);
  assert.equal(dateOrdinal('not-a-date'), Number.NaN);
});

test('gestational week labels have correct Russian forms', () => {
  const weekText = extractWeekText();
  assert.equal(weekText(1), '1 неделя');
  assert.equal(weekText(2), '2 недели');
  assert.equal(weekText(5), '5 недель');
  assert.equal(weekText(11), '11 недель');
  assert.equal(weekText(24), '24 недели');
});

test('calendar date/time and exact reminder date/time are captured and mapped to Supabase', () => {
  assert.match(html, /id="itemDate"[^>]*type="date"/);
  assert.match(html, /id="itemTime"[^>]*type="time"/);
  assert.match(html, /id="itemReminderDate"[^>]*type="date"/);
  assert.match(html, /id="itemReminderTime"[^>]*type="time"/);
  assert.match(app, /reminder_date: item\.reminderDate/);
  assert.match(app, /reminder_time: item\.reminderDate \? \(item\.reminderTime \|\| '09:00'\)/);
  assert.match(app, /reminderDate: row\.reminder_date/);
  assert.match(app, /reminderTime: row\.reminder_time/);
  assert.match(app, /if\(reminderTime && !reminderDate\)/);
});

test('pregnancy weeks are displayed on Today and in a 42-week calendar', () => {
  assert.match(app, /\$\{renderPregnancySummary\(\)\}/);
  assert.match(app, /Array\.from\(\{length:42\}/);
  assert.match(app, /data-doctor-reminder/);
  assert.match(app, /type="date" name="pregnancyStart"/);
  assert.match(app, /type="date" name="dueDate"/);
});

test('the planner opens without email and attempts private anonymous cloud sign-in', () => {
  assert.match(html, /id="authGate" class="auth-gate hidden" aria-hidden="true"/);
  assert.match(html, /id="appShell"/);
  assert.match(app, /const guestMode = false/);
  assert.match(app, /cloud\.auth\.signInAnonymously/);
  assert.match(app, /Почта не нужна/);
  assert.match(app, /Сохранено на устройстве/);
  assert.doesNotMatch(html, /id="signUpForm"|id="registerForm"/);
});
test('the top brand returns to Today and public registration stays absent', () => {
  assert.match(app, /\$\('\.brand'\)\.addEventListener\('click'.*setView\('today'\)/);
  assert.doesNotMatch(html, /id="signUpForm"|id="registerForm"/);
});

test('anonymous planner sessions can use the private per-user data policies', () => {
  for (const source of [schema, anonymousMigration]) {
    assert.match(source, /auth\.jwt\(\)\s*->>\s*'is_anonymous'/i);
    assert.match(source, /planner_allowed_users/);
  }
  assert.match(app, /if \(!guestMode\) queueCloudSync\(\)/);
  assert.match(app, /localStorage\.setItem\(STORE_KEY, JSON\.stringify\(items\)\)/);
});

test('adding an event saves it locally immediately and renders it without waiting for the cloud', () => {
  assert.match(app, /\$\('#itemForm'\)\.addEventListener\('submit'/);
  assert.match(app, /items\.push\(\{id:crypto\.randomUUID/);
  assert.match(app, /saveItems\(\);editingId=null;itemDialog\.close\(\);render\(\)/);
  assert.match(app, /function openNotificationEvent/);
});

test('database scheduler supports exact reminder timestamps and relative reminders', () => {
  for (const source of [schema, migration]) {
    assert.match(source, /add column if not exists reminder_date date/i);
    assert.match(source, /add column if not exists reminder_time time/i);
    assert.match(source, /when i\.reminder_date is not null then/i);
    assert.match(source, /make_interval\(mins => i\.remind_before\)/i);
    assert.match(source, /interval '3 minutes'/i);
  }
});

test('service worker invalidates old cache, refreshes app.js, and opens the event referenced by a push', () => {
  assert.match(worker, /family-planner-v14/);
  assert.match(worker, /app\.js\?v=20261013-9/);
  assert.match(html, /app\.js\?v=20261013-9/);
  assert.match(app, /new URLSearchParams\(location\.search\)\.get\('event'\)/);
  assert.match(manifest, /"start_url": "\.\/"/);
  assert.doesNotMatch(manifest, /guest=1/);
});

test('push controls expose a real server-side test action', () => {
  assert.match(html, /id="testPush"/);
  assert.match(app, /callPushFunction\(\{action:'test'\}\)/);
});
