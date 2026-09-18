import { describe, expect, it } from "vitest";
import { parsePostalLookup, isIndia } from "./geo";

describe("pincode lookup", () => {
  it("maps India Post offices to city and state", () => {
    const loc = parsePostalLookup(
      [
        {
          Status: "Success",
          PostOffice: [{ Name: "Bangalore G.P.O.", District: "Bangalore", State: "Karnataka", Country: "India", Block: "Bangalore North" }]
        }
      ],
      "560001"
    );
    expect(loc).toEqual(
      expect.objectContaining({ pincode: "560001", city: "Bangalore", state: "Karnataka", country: "India" })
    );
  });

  it("returns null when the postal API has no offices", () => {
    expect(parsePostalLookup([{ Status: "Error", PostOffice: null }], "999999")).toBeNull();
  });

  it("treats empty country as India", () => {
    expect(isIndia("")).toBe(true);
    expect(isIndia("India")).toBe(true);
    expect(isIndia("United Arab Emirates")).toBe(false);
  });
});
