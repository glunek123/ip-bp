export const workflowChangedEvent = 'dev-cor:workflow-changed';

export function notifyWorkflowChanged(): void {
  globalThis.window.dispatchEvent(new Event(workflowChangedEvent));
}
