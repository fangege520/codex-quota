/* macOS JavaScript for Automation. Matches the selected bundle for status and restart. */
ObjC.import('AppKit');

function run([bundlePath, action]) {
  const bundle = $.NSURL.fileURLWithPath(bundlePath).URLByResolvingSymlinksInPath;
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  let other = false;
  for (let index = 0; index < Number(apps.count); index++) {
    const app = apps.objectAtIndex(index);
    if (ObjC.unwrap(app.bundleIdentifier) !== 'com.openai.codex' || app.isTerminated) continue;
    if (!app.bundleURL.URLByResolvingSymlinksInPath.isEqual(bundle)) {
      other = true;
      continue;
    }
    if (action === 'status') return 'running';
    if (!app.forceTerminate && !app.isTerminated) throw new Error('Codex could not be stopped');
  }
  if (action === 'status') return other ? 'other' : 'stopped';
}
