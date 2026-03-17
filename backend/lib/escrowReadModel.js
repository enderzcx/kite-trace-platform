function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeEscrowState(value = '') {
  const state = normalizeText(value).toLowerCase();
  return ['funded', 'accepted', 'submitted', 'completed', 'rejected', 'expired'].includes(state) ? state : '';
}

function unixSecondsToIso(value = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return new Date(numeric * 1000).toISOString();
}

function isZeroBytes32(value = '') {
  const normalized = normalizeText(value).toLowerCase();
  return !normalized || /^0x0{64}$/.test(normalized);
}

function resolveState(localState = '', onchainState = '') {
  const normalizedLocal = normalizeText(localState).toLowerCase();
  const normalizedOnchain = normalizeEscrowState(onchainState);
  if (!normalizedOnchain) return normalizedLocal;
  if (['pending_approval', 'approval_rejected', 'approval_expired', 'failed'].includes(normalizedLocal)) {
    return normalizedLocal;
  }
  return normalizedOnchain || normalizedLocal;
}

export function mergeJobWithEscrowRead(job = {}, escrow = {}) {
  const safeJob = job && typeof job === 'object' ? { ...job } : {};
  if (!escrow || typeof escrow !== 'object' || !escrow.configured || !escrow.found) {
    return safeJob;
  }

  const onchainState = normalizeEscrowState(escrow.escrowState);
  const fundedAt = unixSecondsToIso(escrow.fundedAt);
  const acceptedAt = unixSecondsToIso(escrow.acceptedAt);
  const submittedAt = unixSecondsToIso(escrow.submittedAt);
  const resolvedAt = unixSecondsToIso(escrow.resolvedAt);
  const deadlineAt = unixSecondsToIso(escrow.deadlineAt);

  const next = {
    ...safeJob,
    state: resolveState(safeJob.state, onchainState),
    payer: normalizeText(escrow.requester || safeJob.payer),
    executor: normalizeText(escrow.executor || safeJob.executor),
    validator: normalizeText(escrow.validator || safeJob.validator),
    executorStakeAmount: normalizeText(escrow.executorStakeAmount || safeJob.executorStakeAmount),
    escrowState: onchainState || normalizeText(safeJob.escrowState),
    escrowAddress: normalizeText(escrow.contractAddress || safeJob.escrowAddress),
    escrowTokenAddress: normalizeText(escrow.tokenAddress || safeJob.escrowTokenAddress),
    resultHash: isZeroBytes32(escrow.resultHash)
      ? normalizeText(safeJob.resultHash || safeJob.submissionHash)
      : normalizeText(escrow.resultHash),
    expiresAt: normalizeText(safeJob.expiresAt || deadlineAt),
    fundedAt: normalizeText(fundedAt || safeJob.fundedAt),
    acceptedAt: normalizeText(acceptedAt || safeJob.acceptedAt),
    submittedAt: normalizeText(submittedAt || safeJob.submittedAt)
  };

  if (onchainState === 'completed') {
    next.validatedAt = normalizeText(resolvedAt || safeJob.validatedAt);
    next.completedAt = normalizeText(resolvedAt || safeJob.completedAt);
  } else if (onchainState === 'rejected') {
    next.validatedAt = normalizeText(resolvedAt || safeJob.validatedAt);
    next.rejectedAt = normalizeText(resolvedAt || safeJob.rejectedAt);
  } else if (onchainState === 'expired') {
    next.expiredAt = normalizeText(resolvedAt || safeJob.expiredAt);
  }

  return next;
}
