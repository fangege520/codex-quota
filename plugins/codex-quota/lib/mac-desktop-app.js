/* macOS JavaScript for Automation. Finds and controls the Codex-enabled desktop app. */
ObjC.import('AppKit');

function run([action, bundlePath]) {
  const identifier = 'com.openai.codex';
  const workspace = $.NSWorkspace.sharedWorkspace;
  const apps = workspace.runningApplications;
  const running = [];
  for (let index = 0; index < Number(apps.count); index++) {
    const app = apps.objectAtIndex(index);
    if (ObjC.unwrap(app.bundleIdentifier) === identifier && !app.isTerminated) running.push(app);
  }
  if (action === 'discover') {
    const urls = workspace.URLsForApplicationsWithBundleIdentifier(identifier);
    const installed = [];
    for (let index = 0; index < Number(urls.count); index++) {
      installed.push(ObjC.unwrap(urls.objectAtIndex(index).path));
    }
    return JSON.stringify({ running: running.map(app => ObjC.unwrap(app.bundleURL.path)), installed });
  }
  const bundle = $.NSURL.fileURLWithPath(bundlePath).URLByResolvingSymlinksInPath;
  const selected = running.filter(app => app.bundleURL.URLByResolvingSymlinksInPath.isEqual(bundle));
  if (action === 'status') return selected.length ? 'running' : running.length ? 'other' : 'stopped';
  for (const app of selected) {
    if (!app.forceTerminate && !app.isTerminated) throw new Error('Codex could not be stopped');
  }
}
