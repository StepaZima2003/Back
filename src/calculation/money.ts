export interface WeightedAllocationInput {
  id: string;
  weight: number;
  capAmountMinor?: number | null;
}

export interface WeightedAllocationResult {
  allocations: Map<string, number>;
  unallocatedMinor: number;
}

export function allocateByWeights(amountMinor: number, items: WeightedAllocationInput[]): WeightedAllocationResult {
  const allocations = new Map<string, number>();
  for (const item of items) {
    allocations.set(item.id, 0);
  }

  if (amountMinor === 0 || items.length === 0) {
    return { allocations, unallocatedMinor: amountMinor };
  }

  if (amountMinor < 0) {
    const positive = allocateByWeights(Math.abs(amountMinor), items);
    for (const [id, amount] of positive.allocations) {
      allocations.set(id, -amount);
    }
    return { allocations, unallocatedMinor: -positive.unallocatedMinor };
  }

  let remaining = amountMinor;
  let active = items.filter((item) => item.weight > 0);

  while (active.length > 0 && remaining > 0) {
    const provisional = allocateWithoutCaps(remaining, active);
    const capped = active.filter((item) => {
      const cap = item.capAmountMinor;
      return cap !== undefined && cap !== null && provisional.get(item.id)! > cap;
    });

    if (capped.length === 0) {
      for (const [id, amount] of provisional) {
        allocations.set(id, (allocations.get(id) ?? 0) + amount);
      }
      remaining = 0;
      break;
    }

    for (const item of capped) {
      const cap = Math.max(0, item.capAmountMinor ?? 0);
      allocations.set(item.id, (allocations.get(item.id) ?? 0) + cap);
      remaining -= cap;
    }

    const cappedIds = new Set(capped.map((item) => item.id));
    active = active.filter((item) => !cappedIds.has(item.id));
  }

  return { allocations, unallocatedMinor: remaining };
}

function allocateWithoutCaps(amountMinor: number, items: WeightedAllocationInput[]): Map<string, number> {
  const allocations = new Map<string, number>();
  const weightSum = items.reduce((sum, item) => sum + item.weight, 0);

  if (weightSum <= 0) {
    for (const item of items) {
      allocations.set(item.id, 0);
    }
    return allocations;
  }

  const raw = items.map((item) => {
    const exact = (amountMinor * item.weight) / weightSum;
    const floor = Math.floor(exact);
    return {
      id: item.id,
      floor,
      fractional: exact - floor
    };
  });

  let allocated = raw.reduce((sum, item) => sum + item.floor, 0);
  let remainder = amountMinor - allocated;
  raw.sort((a, b) => b.fractional - a.fractional || a.id.localeCompare(b.id));

  for (const item of raw) {
    const extra = remainder > 0 ? 1 : 0;
    allocations.set(item.id, item.floor + extra);
    allocated += extra;
    remainder -= extra;
  }

  return allocations;
}

