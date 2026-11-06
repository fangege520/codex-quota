/* macOS JavaScript for Automation. Runs in the logged-in user's session. */
ObjC.import('AppKit');

function run([electronApp, runtime]) {
  ObjC.registerSubclass({
    name: 'CodexQuotaLaunchObserver',
    methods: {
      'applicationLaunched:': {
        types: ['void', ['id']],
        implementation(notification) {
          const application = notification.userInfo.objectForKey($.NSWorkspaceApplicationKey);
          const bundleId = ObjC.unwrap(application.bundleIdentifier);
          if (bundleId === 'com.openai.codex' || bundleId === 'com.openai.chat') {
            $.NSTask.launchedTaskWithLaunchPathArguments('/usr/bin/open', ['-g', '-n', '-a', electronApp, '--args', runtime]);
          }
        }
      }
    }
  });
  const center = $.NSWorkspace.sharedWorkspace.notificationCenter;
  const observer = $.CodexQuotaLaunchObserver.alloc.init;
  center.addObserverSelectorNameObject(observer, 'applicationLaunched:', $.NSWorkspaceDidLaunchApplicationNotification, $());
  $.NSRunLoop.currentRunLoop.run;
  center.removeObserver(observer);
}
