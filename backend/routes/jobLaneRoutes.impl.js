import { createJobApprovalHelpers } from './jobLane/jobApprovalHelpers.js';
import { createJobExpiryExecutor } from './jobLane/jobExpiryExecutor.js';
import { registerJobMutationContinuation, registerJobMutationRoutes } from './jobLane/jobMutationRoutes.js';
import { registerJobReadRoutes } from './jobLane/jobReadRoutes.js';
import { createSharedJobStateHelpers } from './jobLane/sharedJobState.js';

export { createJobExpiryExecutor } from './jobLane/jobExpiryExecutor.js';

export function registerJobLaneRoutes(app, deps) {
  const sharedHelpers = createSharedJobStateHelpers(deps);
  const approvalHelpers = createJobApprovalHelpers(deps, sharedHelpers);
  const executeJobExpiry = createJobExpiryExecutor({
    readJobs: deps.readJobs,
    upsertJobRecord: deps.upsertJobRecord,
    expireEscrowJob: deps.expireEscrowJob,
    publishJobLifecycleAnchorOnChain: deps.publishJobLifecycleAnchorOnChain,
    anchorRegistryRequired: Boolean(process.env.ERC8183_JOB_ANCHOR_REGISTRY)
  });

  const routeContext = {
    app,
    deps,
    helpers: {
      ...sharedHelpers,
      ...approvalHelpers,
      buildJobView: (job = {}) => sharedHelpers.buildJobView(job, approvalHelpers.buildApprovalPolicySnapshot),
      buildJobAuditView: (job = {}) => sharedHelpers.buildJobAuditView(job, approvalHelpers.buildApprovalPolicySnapshot),
      buildPublicJobAuditView: (job = {}) =>
        sharedHelpers.buildPublicJobAuditView(job, approvalHelpers.buildApprovalPolicySnapshot),
      executeJobExpiry
    }
  };

  registerJobMutationRoutes(routeContext);
  registerJobMutationContinuation(routeContext);
  registerJobReadRoutes(routeContext);
}
