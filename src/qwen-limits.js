// GPU memory is expressed in decimal GB. Preserve decimal digits until after flooring.
export const DEFAULT_LIMITS = Object.freeze({
  noteTokens: 2048, questionTokens: 4096, contextTokens: 32768, gpuGB: ""
});

export function validateLimits(raw) {
  const limits = {};
  for (const field of ["contextTokens", "noteTokens", "questionTokens"]) {
    const n = Number(raw[field]);
    if (!Number.isSafeInteger(n) || n < 1) {
      throw new Error("Token limits must be positive whole numbers.");
    }
    limits[field] = n;
  }
  if (Math.max(limits.noteTokens, limits.questionTokens) >= limits.contextTokens) {
    throw new Error("Each reply budget must leave room for the prompt in the context window.");
  }
  const input = String(raw.gpuGB ?? "").trim();
  limits.gpuGB = "";
  if (input) {
    if (!/^(?:\d{1,9}(?:\.\d*)?|\.\d+)$/.test(input)) {
      throw new Error("Enter a positive GPU budget in decimal GB, or leave it blank for automatic.");
    }
    const [whole, frac = ""] = input.split(".");
    limits.gpuGB = Number(whole || "0") + "." + frac.padEnd(2, "0").slice(0, 2);
    if (limits.gpuGB === "0.00") throw new Error("The GPU budget rounds down to 0.00 GB.");
  }
  return limits;
}
