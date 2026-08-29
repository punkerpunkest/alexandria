// THE LEDGER — what is owed, and what is due back.
//
// `Alexandria - Glossary`: "The loop is not the ledger. The loop is the cycle: module, ask,
// interactive. The ledger is what records what is owed, what was tried, and what is due
// back. Scheduling a return is the ledger's job, never the core loop's."
//
// THE NARROW VERSION, which is what the PoC needs and no more. Settled with Jordan 28 Aug.
// It records results, derives what is owed, counts it for the strip, and hands one back at
// a boundary. It does NOT do spacing — "days later" is the ledger's real job and cannot be
// demonstrated inside one session, so a returning item comes back at the next boundary. It
// does not feed results into generation, and it does not model mastery; both are real and
// both are deferred, and pretending otherwise would put a number on a screen that nothing
// earned.
//
// NOTHING HERE GENERATES. The rung drop is already paid for: `readInteractive` carries a
// card set even when it picks an engine, because a cold engine has to be REPLACED rather
// than waited for. So a skipped sandbox already has its recall cards written, and a skipped
// micro set already has the cards nobody reached. One mechanism, two triggers.

export const VERSION = 1;

export const empty = () => ({ version: VERSION, results: [], owed: [] });

// The two owe signals, and they are already in the contracts rather than invented here.
// `src/engine.js`: on a scored engine `completed: false` means the student left mid-task.
// `micro.js` has no such flag because a card set is not scored as a unit — its signal is the
// set being left, which the runtime reports as `skipped`.
export function owedFrom(record) {
  if (!record || typeof record !== 'object') return null;
  const item = record.item ?? {};
  const set = Array.isArray(item.set) ? item.set : [];

  if (record.producer === 'sandbox') {
    // An UNSCORED engine has no `completed` key at all and cannot owe: there was no task to
    // leave unfinished, so exploration that ends is exploration that happened. Checking
    // `=== false` rather than falsiness is what keeps the two cases apart.
    if (record.result?.completed !== false) return null;
    if (!set.length) return null;                 // nothing to bring back, so nothing is owed
    return {
      kind: 'sandbox',
      engine: item.engine?.id ?? null,
      // The board's sentence, and the rung drop is said out loud because otherwise coming
      // back as cards reads as a downgrade rather than as the point.
      notice: `You skipped the ${item.engine?.name ?? 'sandbox'} earlier. `
            + 'Here it is as recall, one rung down.',
      cardType: item.cardType,
      set,
    };
  }

  if (record.producer === 'micro') {
    if (!record.skipped) return null;
    // Only what they did not reach. Returning a card they already answered spends the
    // student's time to tell us something we recorded the first time.
    const left = set.slice(Math.max(0, record.answered ?? 0));
    if (!left.length) return null;                // skipped on the last card is not a debt
    return {
      kind: 'micro',
      engine: null,
      notice: `You left this set earlier. Here ${left.length === 1 ? 'is the card' : `are the ${left.length} cards`} you did not reach.`,
      cardType: item.cardType,
      set: left,
    };
  }

  return null;
}

// Deterministic and content-derived, so the same abandoned item cannot be owed twice —
// skipping a returning item leaves ONE debt rather than adding a second. There is no clock
// here on purpose: `Date.now()` in the id would make every skip a new debt.
export function owedId(owed) {
  const seed = `${owed.kind}:${owed.engine ?? ''}:${owed.set.map((c) => c.front).join('|')}`;
  let h = 2166136261;                                            // FNV-1a, 32-bit
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Fold one result into the ledger and hand back the next state. Pure: the caller owns
 * reading and writing the file, so this is testable without a disk.
 */
export function record(ledger, entry, at) {
  const next = {
    version: VERSION,
    results: [...(ledger?.results ?? []), { at, ...entry }],
    owed: [...(ledger?.owed ?? [])],
  };

  // A RETURNING ITEM SETTLES OR AGES A DEBT. It can never mint one, and this returns early
  // for that reason rather than as a shortcut. Falling through to `owedFrom` was the first
  // version and the ledger fixture caught it: a returning set that gets skipped is a skipped
  // micro set, so it minted a SECOND debt beside the one it came from — and a different one
  // each time, because the returned set is only the cards nobody reached and hashes
  // differently from the original. The count would have climbed on every avoidance.
  if (entry.returningId) {
    if (!entry.skipped) {
      next.owed = next.owed.filter((o) => o.id !== entry.returningId);
    } else {
      // Older, not doubled. `returns` is the only thing that tells "never done" apart from
      // "avoided twice", and a spacing schedule will want it.
      next.owed = next.owed.map((o) => (o.id === entry.returningId
        ? { ...o, returns: (o.returns ?? 0) + 1 } : o));
    }
    return next;
  }

  const owed = owedFrom(entry);
  if (!owed) return next;

  const id = owedId(owed);
  // Copied rather than mutated: `record` is pure, and the caller still holds the ledger it
  // passed in.
  if (next.owed.some((o) => o.id === id)) {
    next.owed = next.owed.map((o) => (o.id === id ? { ...o, returns: (o.returns ?? 0) + 1 } : o));
    return next;
  }
  next.owed = [...next.owed, { id, at, returns: 0, ...owed }];
  return next;
}

export const dueCount = (ledger) => (ledger?.owed ?? []).length;

// Oldest first. A debt that keeps being pushed behind newer ones is a debt the product has
// decided not to collect.
export const nextOwed = (ledger) => (ledger?.owed ?? [])[0] ?? null;

// What the runtime needs to play it, in the shape `playSet` already takes. `kind` is the
// word in the set header — board `80:2` reads RETURNING where a fresh set reads RECALL.
export function playable(owed) {
  if (!owed) return null;
  return {
    returningId: owed.id,
    kind: 'RETURNING',
    notice: owed.notice,
    cardType: owed.cardType,
    set: owed.set,
  };
}
