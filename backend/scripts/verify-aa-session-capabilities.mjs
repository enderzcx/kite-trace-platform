import assert from 'assert/strict';

import {
  DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION,
  deriveAaAccountCapabilities
} from '../lib/aaConfig.js';
import { assertAaJobLaneCapability } from '../lib/escrowHelpers.js';
import { createSessionRuntimeHelpers } from '../lib/sessionRuntimeHelpers.js';

const PAYMENT_ONLY_V2_VERSION = 'GokiteAccountV2-session-userop';

function normalizeAddress(value = '') {
  return String(value || '').trim().toLowerCase();
}

function main() {
  const v2Snapshot = deriveAaAccountCapabilities({
    accountVersion: PAYMENT_ONLY_V2_VERSION
  });
  assert.equal(v2Snapshot.accountVersionTag, PAYMENT_ONLY_V2_VERSION);
  assert.equal(v2Snapshot.accountCapabilities.sessionPayment, true);
  assert.equal(v2Snapshot.accountCapabilities.sessionGenericExecute, false);
  assert.equal(v2Snapshot.requiredForJobLane, 'sessionGenericExecute');

  const v3Snapshot = deriveAaAccountCapabilities({
    accountVersionTag: DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION
  });
  assert.equal(v3Snapshot.accountVersionTag, DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION);
  assert.equal(v3Snapshot.accountCapabilities.sessionPayment, true);
  assert.equal(v3Snapshot.accountCapabilities.sessionGenericExecute, true);

  const helpers = createSessionRuntimeHelpers({
    normalizeAddress,
    readJsonObject: () => ({}),
    writeJsonObject: () => {},
    readJsonArray: () => [],
    writeJsonArray: () => {},
    sessionRuntimePath: 'memory://session-runtime',
    sessionRuntimeIndexPath: 'memory://session-runtime-index',
    sessionAuthorizationsPath: 'memory://session-authorizations',
    envSessionPrivateKey: '',
    envSessionAddress: '',
    envSessionId: ''
  });

  const sanitizedV2Runtime = helpers.sanitizeSessionRuntime({
    owner: '0xf02fe12689e5026707d1be150b268e0fa5a37320',
    aaWallet: '0xc2ce58da6c102e61bdd104fa2ec21836b6d11659',
    sessionAddress: '0x6c0e66d26466794f12dad3d51301e0e581ab7358',
    sessionPrivateKey: '0x' + '11'.repeat(32),
    sessionId: '0x' + '22'.repeat(32),
    accountVersion: PAYMENT_ONLY_V2_VERSION
  });
  assert.equal(sanitizedV2Runtime.accountVersionTag, PAYMENT_ONLY_V2_VERSION);
  assert.equal(sanitizedV2Runtime.accountCapabilities.sessionPayment, true);
  assert.equal(sanitizedV2Runtime.accountCapabilities.sessionGenericExecute, false);

  let v2Error = null;
  try {
    assertAaJobLaneCapability({
      runtime: sanitizedV2Runtime,
      role: 'requester',
      roleAddress: sanitizedV2Runtime.aaWallet,
      runtimeOwner: sanitizedV2Runtime.owner,
      runtimeAddress: sanitizedV2Runtime.aaWallet,
      requiredAccountVersionTag: DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION
    });
  } catch (error) {
    v2Error = error;
  }
  assert.ok(v2Error, 'expected V2 job-lane capability check to fail');
  assert.equal(v2Error.code, 'aa_session_execute_not_supported');

  const v3Capability = assertAaJobLaneCapability({
    runtime: {
      ...sanitizedV2Runtime,
      accountVersion: DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION,
      accountVersionTag: DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION,
      accountCapabilities: {
        sessionPayment: true,
        sessionGenericExecute: true
      }
    },
    role: 'requester',
    roleAddress: sanitizedV2Runtime.aaWallet,
    runtimeOwner: sanitizedV2Runtime.owner,
    runtimeAddress: sanitizedV2Runtime.aaWallet,
    requiredAccountVersionTag: DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION
  });
  assert.equal(v3Capability.supportsSessionGenericExecute, true);
  assert.equal(v3Capability.aaMethod, 'executeWithSession');

  console.log(
    JSON.stringify(
      {
        ok: true,
        v2Snapshot,
        v3Snapshot,
        v2RejectedCode: v2Error.code,
        v3Capability
      },
      null,
      2
    )
  );
}

main();
