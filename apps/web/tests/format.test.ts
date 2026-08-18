import { describe, expect, it } from "vitest";
import { congestionToken, formatCount, formatPcu, formatPercent } from "@/lib/format";

/**
 * docs/06 §5: the Indian lakh/crore grouping is mandatory. "12,84,700" not
 * "1,284,700". Getting this wrong is the single most obvious tell that a
 * product wasn't built for India, and a government audience spots it instantly.
 */
describe("Indian digit grouping", () => {
  it("groups lakhs correctly in English", () => {
    expect(formatCount(1284700, "en")).toBe("12,84,700");
  });

  it("groups lakhs correctly in Hindi", () => {
    expect(formatCount(1284700, "hi")).toBe("12,84,700");
  });

  it("never produces Western thousands grouping", () => {
    expect(formatCount(1284700, "en")).not.toBe("1,284,700");
  });

  it("formats crores", () => {
    expect(formatCount(35000000, "en")).toBe("3,50,00,000");
  });

  it("formats PCU to one decimal", () => {
    expect(formatPcu(8205.34, "en")).toBe("8,205.3");
  });

  it("formats percentages", () => {
    expect(formatPercent(0.587, "en")).toBe("58.7%");
  });
});

/**
 * docs/06 §1: the congestion ramp is fixed, published, and used identically
 * everywhere. Boundaries are inclusive at the top of each band.
 */
describe("congestion ramp", () => {
  it.each([
    [0, "free"],
    [25, "free"],
    [26, "light"],
    [50, "light"],
    [51, "moderate"],
    [70, "moderate"],
    [71, "severe"],
    [85, "severe"],
    [86, "critical"],
    [100, "critical"],
  ])("index %i maps to the %s band", (index, band) => {
    expect(congestionToken(index)).toBe(`var(--congestion-${band})`);
  });
});
