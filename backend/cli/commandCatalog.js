export const COMMAND_CATALOG = {
  auth: {
    description: 'Wallet identity and AA session readiness',
    actions: {
      login: { batch: 'Batch 1: Auth And Session Readiness', implemented: true },
      whoami: { batch: 'Batch 1: Auth And Session Readiness', implemented: true },
      session: { batch: 'Batch 1: Auth And Session Readiness', implemented: true }
    }
  },
  session: {
    description: 'User authorization for backend-executed AA sessions',
    actions: {
      authorize: { batch: 'V3-C: User-Authorized Session Grants', implemented: true }
    }
  },
  config: {
    description: 'Inspect resolved CLI runtime configuration',
    actions: {
      show: { batch: 'Batch 0: CLI Skeleton And Runtime Contract', implemented: true }
    }
  },
  buy: {
    description: 'Lightweight negotiated-buy lane',
    actions: {
      request: { batch: 'Batch 2: Buy Lane', implemented: true },
      direct: { batch: 'V2-A: Direct Buy Slice', implemented: true }
    }
  },
  template: {
    description: 'Reusable direct-buy templates',
    actions: {
      list: { batch: 'V2-A: Template Lifecycle', implemented: true },
      resolve: { batch: 'V2-A: Template Lifecycle', implemented: true },
      show: { batch: 'V2-A: Template Lifecycle', implemented: true },
      publish: { batch: 'V2-A: Template Lifecycle', implemented: true },
      revoke: { batch: 'V2-A: Template Lifecycle', implemented: true },
      activate: { batch: 'V2-A: Template Lifecycle', implemented: true },
      expire: { batch: 'V2-A: Template Lifecycle', implemented: true }
    }
  },
  provider: {
    description: 'Versioned provider onboarding and discovery surfaces',
    actions: {
      list: { batch: 'V3-A: Platform Surface Contract', implemented: true },
      register: { batch: 'V3-A: Platform Surface Contract', implemented: true },
      show: { batch: 'V3-A: Platform Surface Contract', implemented: true },
      'identity-challenge': { batch: 'V3-B: Identity-Linked Provider Onboarding', implemented: true },
      'register-identity': { batch: 'V3-B: Identity-Linked Provider Onboarding', implemented: true },
      'import-identity': { batch: 'V3-B: Identity-Linked Provider Onboarding', implemented: true },
      approve: { batch: 'V3-B: Provider Approval And Discovery Policy', implemented: true },
      suspend: { batch: 'V3-B: Provider Approval And Discovery Policy', implemented: true }
    }
  },
  capability: {
    description: 'Versioned capability publishing and discovery surfaces',
    actions: {
      list: { batch: 'V3-A: Platform Surface Contract', implemented: true },
      publish: { batch: 'V3-A: Platform Surface Contract', implemented: true },
      show: { batch: 'V3-A: Platform Surface Contract', implemented: true }
    }
  },
  discovery: {
    description: 'Ranked provider-capability discovery surfaces',
    actions: {
      select: { batch: 'V3-B: Ranked Multi-Provider Discovery', implemented: true },
      compare: { batch: 'V3-B: Ranked Multi-Provider Discovery', implemented: true },
      'recommend-buy': { batch: 'V3-B: Ranked Multi-Provider Discovery', implemented: true }
    }
  },
  job: {
    description: 'Minimal ERC-8183-aware job lane',
    actions: {
      create: { batch: 'Batch 4: Minimal ERC-8183 Job Lane', implemented: true },
      fund: { batch: 'Batch 4: Minimal ERC-8183 Job Lane', implemented: true },
      submit: { batch: 'Batch 4: Minimal ERC-8183 Job Lane', implemented: true },
      show: { batch: 'Batch 4: Minimal ERC-8183 Job Lane', implemented: true },
      complete: { batch: 'V2-C: Deeper ERC-8183 Fulfillment', implemented: true },
      reject: { batch: 'V2-C: Deeper ERC-8183 Fulfillment', implemented: true },
      expire: { batch: 'V2-C: Deeper ERC-8183 Fulfillment', implemented: true }
    }
  },
  trust: {
    description: 'Trust-signal inspection and publication surfaces',
    actions: {
      reputation: { batch: 'V2-C: ERC-8004 Trust-Signal Expansion', implemented: true },
      validations: { batch: 'V2-C: ERC-8004 Trust-Signal Expansion', implemented: true },
      publish: { batch: 'V3-A: Trust Publication Contract', implemented: true },
      publications: { batch: 'V3-A: Trust Publication Contract', implemented: true }
    }
  },
  flow: {
    description: 'Shared workflow inspection surfaces',
    actions: {
      status: { batch: 'Batch 3: Shared Flow And Artifact Surfaces', implemented: true },
      show: { batch: 'Batch 3: Shared Flow And Artifact Surfaces', implemented: true },
      history: { batch: 'Batch 3: Shared Flow And Artifact Surfaces', implemented: true }
    }
  },
  artifact: {
    description: 'Receipt and evidence retrieval',
    actions: {
      receipt: { batch: 'Batch 3: Shared Flow And Artifact Surfaces', implemented: true },
      evidence: { batch: 'Batch 3: Shared Flow And Artifact Surfaces', implemented: true }
    }
  },
  evidence: {
    description: 'Public evidence inspection by trace id',
    actions: {
      get: { batch: 'MVP Public Audit Surface', implemented: true }
    }
  },
  system: {
    description: 'Operational helpers for fresh validation runs',
    actions: {
      'start-fresh': { batch: 'V3-A: Fresh Process Validation Contract', implemented: true }
    }
  }
};

export function listCommandFamilies() {
  return Object.entries(COMMAND_CATALOG).map(([family, meta]) => ({
    family,
    description: meta.description,
    actions: Object.keys(meta.actions)
  }));
}

export function lookupCommand(family = '', action = '') {
  const familyMeta = COMMAND_CATALOG[family];
  if (!familyMeta) return null;
  const actionMeta = familyMeta.actions[action];
  if (!actionMeta) return null;
  return {
    family,
    action,
    description: familyMeta.description,
    ...actionMeta
  };
}
