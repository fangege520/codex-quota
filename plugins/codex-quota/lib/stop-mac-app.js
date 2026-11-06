/* macOS JavaScript for Automation. Stops only the selected desktop app. */
ObjC.import('AppKit');

function run([bundlePath]) {
  const bundle = $.NSURL.fileURLWithPath(bundlePath).URLByResolvingSymlinksInPath;
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  for (let index = 0; index < Number(apps.count); index++) {
    const app = apps.objectAtIndex(index);
    const id = ObjC.unwrap(app.bundleIdentifier);
    if ((id === 'com.openai.codex' || id === 'com.openai.chat') &&
        app.bundleURL.URLByResolvingSymlinksInPath.isEqual(bundle) &&
        !app.forceTerminate && !app.isTerminated) {
      throw new Error('Codex could not be stopped');
    }
  }
}
