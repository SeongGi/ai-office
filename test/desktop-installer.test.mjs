// 데스크톱 앱 설치·삭제 로직(desktop/installer.cjs)을 확인한다. 실제 ditto/codesign/
// iconutil/PlistBuddy/Electron은 부르지 않고, 순수 함수와 가짜 run/fs만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { resolveTemplateApp, iconsetFiles, buildAppStubSource, isOurApp, plistEdits, installApp, uninstallApp, destApp, BUNDLE_ID, APP_NAME } =
  createRequire(import.meta.url)('../desktop/installer.cjs');

const FAKE_ELECTRON_BIN = '/fake/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const FAKE_ELECTRON_APP = '/fake/repo/node_modules/electron/dist/Electron.app';

// ------------------------------------------------------------ 순수 함수

test('resolveTemplateApp: 올바른 구조면 Electron.app 경로를 돌려준다', () => {
  const r = resolveTemplateApp(FAKE_ELECTRON_BIN);
  assert.equal(r.ok, true);
  assert.equal(r.path, FAKE_ELECTRON_APP);
});

test('resolveTemplateApp: 구조가 다르면 에러', () => {
  const r = resolveTemplateApp('/fake/repo/node_modules/electron/dist/weird/Electron');
  assert.equal(r.ok, false);
  assert.match(r.error, /electron 패키지 구조가 예상과 달라요/);
});

test('iconsetFiles: macOS iconset 규칙에 맞는 10개 항목', () => {
  const files = iconsetFiles();
  assert.equal(files.length, 10);
  const bySize = Object.fromEntries(files.map((f) => [f.name, f.size]));
  assert.deepEqual(bySize, {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024,
  });
});

test('buildAppStubSource: 공백과 작은따옴표가 섞인 경로도 올바른 JS 문자열 리터럴을 만든다', () => {
  const weirdPath = "/Users/오 '공백' 폴더/ai-office";
  const source = buildAppStubSource(weirdPath);
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /require\(/);
  assert.ok(source.includes(JSON.stringify(`${weirdPath}/desktop/main.cjs`)));
});

test('isOurApp: BUNDLE_ID와 같을 때만 true', () => {
  assert.equal(isOurApp(BUNDLE_ID), true);
  assert.equal(isOurApp('com.other.app'), false);
  assert.equal(isOurApp(null), false);
});

test('plistEdits: 이름·식별자·버전이 들어간 목록', () => {
  const edits = plistEdits({ version: '1.2.3' });
  const byKey = Object.fromEntries(edits.map((e) => [e.key, e.value]));
  assert.equal(byKey.CFBundleName, APP_NAME);
  assert.equal(byKey.CFBundleDisplayName, APP_NAME);
  assert.equal(byKey.CFBundleIdentifier, BUNDLE_ID);
  assert.equal(byKey.CFBundleExecutable, APP_NAME);
  assert.equal(byKey.CFBundleIconFile, 'icon');
  assert.equal(byKey.CFBundleShortVersionString, '1.2.3');
  assert.equal(byKey.CFBundleVersion, '1.2.3');
  for (const e of edits) assert.equal(e.type, 'string');
});

// ------------------------------------------------------------ 가짜 run/fs로 installApp/uninstallApp

/** 가짜 run: 기본은 전부 성공, failOn에 적은 명령 이름은 상태 코드 1을 돌려준다. */
function makeFakeRun({ failOn = [], identifier = BUNDLE_ID } = {}) {
  const calls = [];
  const run = (cmd, args = [], opts) => {
    calls.push([cmd, args, opts]);
    if (cmd === '/usr/libexec/PlistBuddy' && args[1] === 'Print :CFBundleIdentifier') {
      return { status: 0, stdout: `${identifier}\n`, stderr: '' };
    }
    const label = cmd === '/usr/libexec/PlistBuddy' ? `PlistBuddy:${args[1]}` : cmd;
    if (failOn.includes(label) || failOn.includes(cmd)) return { status: 1, stdout: '', stderr: 'boom' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

/** 가짜 fs: 실제 디스크를 전혀 건드리지 않는, 경로 문자열만 다루는 메모리 모델. */
function makeFakeFs({ existingPaths = [] } = {}) {
  const existsPaths = new Set(existingPaths);
  const files = new Map();
  const calls = [];
  let tmpCounter = 0;
  return {
    calls,
    existsPaths,
    existsSync(p) {
      calls.push(['existsSync', p]);
      if (p === FAKE_ELECTRON_BIN) return true;
      return existsPaths.has(p);
    },
    mkdtempSync(prefix) {
      calls.push(['mkdtempSync', prefix]);
      tmpCounter += 1;
      const dir = `${prefix}${tmpCounter}`;
      existsPaths.add(dir);
      return dir;
    },
    mkdirSync(p) {
      calls.push(['mkdirSync', p]);
      existsPaths.add(p);
    },
    writeFileSync(p, data) {
      calls.push(['writeFileSync', p]);
      files.set(p, data);
      existsPaths.add(p);
    },
    readFileSync(p) {
      calls.push(['readFileSync', p]);
      if (files.has(p)) return files.get(p);
      if (p.endsWith('package.json')) return JSON.stringify({ version: '9.9.9' });
      throw new Error(`no such file: ${p}`);
    },
    renameSync(from, to) {
      calls.push(['renameSync', from, to]);
      existsPaths.delete(from);
      existsPaths.add(to);
    },
    rmSync(p) {
      calls.push(['rmSync', p]);
      existsPaths.delete(p);
      for (const q of [...existsPaths]) if (q.startsWith(`${p}/`)) existsPaths.delete(q);
    },
  };
}

test('installApp: 성공 경로, 새 앱을 만들고 destApp 위치로 옮긴다', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, true);
  assert.equal(result.path, destApp());
  assert.ok(fakeFs.existsPaths.has(destApp()));
  const cmds = fakeFs.calls.filter((c) => c[0] === 'renameSync').map((c) => c[2]);
  assert.ok(cmds.includes(destApp()), '최종적으로 destApp 위치로 rename 되어야 한다');
});

test('installApp: ditto 실패 시 임시 폴더를 지우고 기존 설치는 그대로 둔다', () => {
  const existing = destApp();
  const { run } = makeFakeRun({ failOn: ['ditto'] });
  const fakeFs = makeFakeFs({ existingPaths: [existing] });
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, false);
  assert.match(result.error, /ditto/);
  // 기존 앱은 그대로 남아 있어야 한다(식별자가 같아 설치를 진행했지만, ditto 단계에서 실패했다).
  assert.ok(fakeFs.existsPaths.has(existing));
  // mkdtempSync로 만든 임시 폴더는 지워졌어야 한다.
  const tmpRootCalls = fakeFs.calls.filter((c) => c[0] === 'mkdtempSync');
  assert.equal(tmpRootCalls.length, 1);
  const rmCalls = fakeFs.calls.filter((c) => c[0] === 'rmSync').map((c) => c[1]);
  assert.ok(rmCalls.some((p) => p.startsWith(tmpRootCalls[0][1])), '임시 폴더를 정리해야 한다');
});

test('installApp: codesign 실패 시에도 롤백한다', () => {
  const { run } = makeFakeRun({ failOn: ['codesign'] });
  const fakeFs = makeFakeFs();
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, false);
  assert.match(result.error, /codesign/);
  assert.equal(fakeFs.existsPaths.has(destApp()), false);
});

test('installApp: codesign 검증 실패 시 --deep으로 다시 서명해 성공할 수 있다', () => {
  const { run, calls } = makeFakeRun({ failOn: ['PlistBuddy:never'] }); // 아무것도 안 걸리는 더미
  let verifyCalled = false;
  const wrappedRun = (cmd, args, opts) => {
    if (cmd === 'codesign' && args.includes('--verify')) {
      verifyCalled = true;
      return { status: 1, stdout: '', stderr: '' }; // 첫 서명 검증은 실패
    }
    return run(cmd, args, opts);
  };
  const fakeFs = makeFakeFs();
  const result = installApp({ run: wrappedRun, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(verifyCalled, true);
  assert.equal(result.ok, true);
  const codesignCalls = calls.filter((c) => c[0] === 'codesign');
  assert.ok(codesignCalls.some((c) => c[1].includes('--deep')), '검증 실패 후 --deep으로 다시 서명해야 한다');
});

test('installApp: 기존 설치 식별자가 다르면 설치를 멈추고 아무 것도 건드리지 않는다', () => {
  const existing = destApp();
  const { run } = makeFakeRun({ identifier: 'com.someone.else' });
  const fakeFs = makeFakeFs({ existingPaths: [existing] });
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, false);
  assert.match(result.error, /이미 다른 앱이 있어서/);
  assert.ok(fakeFs.existsPaths.has(existing));
  assert.equal(
    fakeFs.calls.some((c) => c[0] === 'mkdtempSync'),
    false,
    '식별자 확인에서 멈췄으면 임시 폴더를 만들지도 않아야 한다',
  );
});

test('installApp: version에 큰따옴표가 있으면 plist 적용 전에 멈춘다', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const repoPkgPath = fakeFs.readFileSync; // no-op, just to keep lint happy
  void repoPkgPath;
  // package.json을 큰따옴표 섞인 버전으로 덮어써서 읽게 한다.
  const original = fakeFs.readFileSync.bind(fakeFs);
  fakeFs.readFileSync = (p) => {
    if (p.endsWith('package.json') && !p.includes('ai-office-desktop-app')) return JSON.stringify({ version: '1.0.0"beta' });
    return original(p);
  };
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, false);
  assert.match(result.error, /큰따옴표/);
  assert.equal(
    fakeFs.calls.some((c) => c[0] === 'writeFileSync' && c[1].endsWith('icon_16x16.png')),
    false,
    '아이콘을 만들기 전에 멈춰야 한다',
  );
});

test('installApp: rename이 EXDEV로 실패하면 ditto로 옮긴다', () => {
  const { run: baseRun, calls } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const originalRename = fakeFs.renameSync.bind(fakeFs);
  fakeFs.renameSync = (from, to) => {
    if (to === destApp()) {
      const err = new Error('cross-device link');
      err.code = 'EXDEV';
      throw err;
    }
    return originalRename(from, to);
  };
  // 실제 ditto는 외부 명령이라 대상 경로를 디스크에 만든다. 가짜 run에서도 같은 효과를 낸다.
  const run = (cmd, args, opts) => {
    const result = baseRun(cmd, args, opts);
    if (cmd === 'ditto' && args[1] === destApp()) fakeFs.existsPaths.add(args[1]);
    return result;
  };
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, true);
  assert.ok(fakeFs.existsPaths.has(destApp()));
  const dittoCalls = calls.filter((c) => c[0] === 'ditto');
  assert.equal(dittoCalls.length, 2, '템플릿 복사 1회 + EXDEV 폴백 1회');
});

test('uninstallApp: 설치돼 있지 않으면 성공으로 보되 removed는 false', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const result = uninstallApp({ run, fs: fakeFs, platform: 'darwin' });
  assert.deepEqual(result, { ok: true, removed: false });
});

test('uninstallApp: 우리 앱이면 지운다', () => {
  const existing = destApp();
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs({ existingPaths: [existing] });
  const result = uninstallApp({ run, fs: fakeFs, platform: 'darwin' });
  assert.deepEqual(result, { ok: true, removed: true });
  assert.equal(fakeFs.existsPaths.has(existing), false);
});

test('uninstallApp: 우리 앱이 아니면 지우지 않는다', () => {
  const existing = destApp();
  const { run } = makeFakeRun({ identifier: 'com.someone.else' });
  const fakeFs = makeFakeFs({ existingPaths: [existing] });
  const result = uninstallApp({ run, fs: fakeFs, platform: 'darwin' });
  assert.equal(result.ok, false);
  assert.ok(fakeFs.existsPaths.has(existing), '우리 앱이 아니면 그대로 남아야 한다');
});

test('uninstallApp: darwin이 아니면 바로 멈춘다(installApp과 동일한 가드)', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs({ existingPaths: [destApp()] });
  const result = uninstallApp({ run, fs: fakeFs, platform: 'linux' });
  assert.equal(result.ok, false);
  assert.match(result.error, /macOS에서만/);
  assert.ok(fakeFs.existsPaths.has(destApp()), '플랫폼 가드에서 멈췄으면 아무 것도 지우지 않아야 한다');
});

test('installApp: darwin이 아니면 바로 멈춘다', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'win32' });
  assert.equal(result.ok, false);
  assert.match(result.error, /macOS에서만/);
  assert.equal(
    fakeFs.calls.some((c) => c[0] === 'mkdtempSync'),
    false,
    '플랫폼 가드에서 멈췄으면 설치 작업을 시작하지도 않아야 한다',
  );
});

test('installApp: 성공 후 tmpRoot 전체(icon.iconset 포함)가 더 이상 존재하지 않는다', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, true);
  const tmpRootCalls = fakeFs.calls.filter((c) => c[0] === 'mkdtempSync');
  assert.equal(tmpRootCalls.length, 1);
  const tmpRoot = tmpRootCalls[0][1];
  const leftover = [...fakeFs.existsPaths].filter((p) => p === tmpRoot || p.startsWith(`${tmpRoot}/`));
  assert.deepEqual(leftover, [], `tmpRoot 밑에 아무 것도 남지 않아야 하는데 남았다: ${leftover.join(', ')}`);
});

test('installApp: package.json의 version이 문자열이 아니면 설치를 멈춘다', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const original = fakeFs.readFileSync.bind(fakeFs);
  fakeFs.readFileSync = (p) => {
    if (p.endsWith('package.json') && !p.includes('ai-office-desktop-app')) return JSON.stringify({ version: undefined });
    return original(p);
  };
  const result = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(result.ok, false);
  assert.match(result.error, /version/);
  assert.equal(
    fakeFs.calls.some((c) => c[0] === 'writeFileSync' && c[1].endsWith('icon_16x16.png')),
    false,
    '아이콘을 만들기 전에 멈춰야 한다',
  );
});

test('installApp: 이미 설치된(우리 앱) 상태에서 다시 설치하면 덮어써진다(재설치)', () => {
  const { run } = makeFakeRun();
  const fakeFs = makeFakeFs();
  const first = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(first.ok, true);
  assert.ok(fakeFs.existsPaths.has(destApp()));

  const second = installApp({ run, fs: fakeFs, electronBin: FAKE_ELECTRON_BIN, platform: 'darwin' });
  assert.equal(second.ok, true);
  assert.equal(second.path, destApp());
  assert.ok(fakeFs.existsPaths.has(destApp()), '두 번째 설치 후에도 destApp이 있어야 한다');

  const tmpRootCalls = fakeFs.calls.filter((c) => c[0] === 'mkdtempSync');
  assert.equal(tmpRootCalls.length, 2, '재설치도 새 임시 폴더를 쓴다');
  for (const [, tmpRoot] of tmpRootCalls) {
    const leftover = [...fakeFs.existsPaths].filter((p) => p === tmpRoot || p.startsWith(`${tmpRoot}/`));
    assert.deepEqual(leftover, [], `재설치 후에도 tmpRoot가 남아있으면 안 된다: ${leftover.join(', ')}`);
  }
});
