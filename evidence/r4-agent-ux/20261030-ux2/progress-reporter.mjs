export default class ProgressReporter {
  onTestModuleQueued(module) { process.stderr.write("[QUEUED] " + module.moduleId + "\n"); }
  onTestModuleCollected(module) { process.stderr.write("[COLLECTED] " + module.moduleId + "\n"); }
  onTestModuleEnd(module) { process.stderr.write("[ENDED] " + module.moduleId + "\n"); }
}
