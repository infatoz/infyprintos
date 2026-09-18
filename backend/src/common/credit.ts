export function creditAvailable(creditLimit: number, outstanding: number) {
  return Math.max(0, Number(creditLimit || 0) - Number(outstanding || 0));
}

export function wouldExceedCredit(opts: {
  creditLimit: number;
  outstanding: number;
  additionalBalance: number;
  creditHold: boolean;
  prepaidRequiresFullPay: boolean;
  balanceDue: number;
  lifecycleStatus?: string;
}) {
  if (opts.lifecycleStatus === "blocked") return { blocked: true, reason: "Customer is blocked" as const };
  if (opts.creditHold) return { blocked: true, reason: "Customer is on credit hold" as const };
  if (opts.prepaidRequiresFullPay && opts.balanceDue > 0) {
    return { blocked: true, reason: "Prepaid customers must pay in full before confirmation" as const };
  }
  if (opts.creditLimit > 0 && opts.outstanding + opts.additionalBalance > opts.creditLimit) {
    return { blocked: true, reason: "Credit limit exceeded" as const };
  }
  return { blocked: false as const, reason: null };
}
