import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";

type Tree = { [k: string]: string | Tree };

function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? [key] : leafKeys(v, key);
  });
}

/**
 * docs/03 §7 and docs/02 rule 7: Hindi is a first-class language, not a
 * translation layer. Parity is a build gate, not an aspiration — a missing
 * Hindi key means a screen silently falls back to English in front of an
 * audience that will notice.
 */
describe("bilingual message catalogues", () => {
  const enKeys = leafKeys(en as Tree).sort();
  const hiKeys = leafKeys(hi as Tree).sort();

  it("have identical key sets", () => {
    expect(hiKeys).toEqual(enKeys);
  });

  it("have no empty Hindi strings", () => {
    const empty = leafKeys(hi as Tree).filter((k) => {
      const value = k.split(".").reduce<unknown>((o, part) => (o as Tree)[part], hi);
      return typeof value === "string" && value.trim().length === 0;
    });
    expect(empty).toEqual([]);
  });

  it("actually contain Devanagari in the Hindi catalogue", () => {
    const devanagari = /[ऀ-ॿ]/;
    const untranslated = leafKeys(hi as Tree).filter((k) => {
      const value = k.split(".").reduce<unknown>((o, part) => (o as Tree)[part], hi);
      return typeof value === "string" && !devanagari.test(value);
    });
    expect(untranslated).toEqual([]);
  });
});
