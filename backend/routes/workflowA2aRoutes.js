import { registerWorkflowRunRoutes } from './workflowRunRoutes.js';
import { registerReceiptEvidenceRoutes } from './receiptEvidenceRoutes.js';
import { registerA2aTaskNetworkRoutes } from './a2aTaskNetworkRoutes.js';

export function registerWorkflowA2aRoutes(app, deps) {
  registerWorkflowRunRoutes(app, deps);
  registerReceiptEvidenceRoutes(app, deps);
  registerA2aTaskNetworkRoutes(app, deps);
}
