// Small bits of state shared by the desktop app and the hooks, kept in ~/.ai-office
// (새 폴더가 없고 옛 이름 폴더만 있으면 그것을 계속 쓴다. 규칙은 shared/env.cjs에 있다).
const fs = require('node:fs');
const path = require('node:path');
const { stateDir } = require('../shared/env.cjs');

const DIR = stateDir();
const SNOOZE = path.join(DIR, 'snoozed-until');
const LOCK = path.join(DIR, 'launch.lock');

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

/** Stop hooks from opening the app for `hours`. */
function snooze(hours) {
  ensureDir();
  fs.writeFileSync(SNOOZE, String(Date.now() + hours * 3600_000));
}

function isSnoozed() {
  try {
    return Date.now() < Number(fs.readFileSync(SNOOZE, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Only one hook may launch the app at a time: parallel subagents fire many
 * hooks at once. Returns true if this process won the right to launch.
 */
function takeLaunchLock(staleMs = 20_000) {
  ensureDir();
  try {
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age < staleMs) return false;
    fs.unlinkSync(LOCK);
  } catch {
    /* no lock yet */
  }
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { DIR, snooze, isSnoozed, takeLaunchLock };
