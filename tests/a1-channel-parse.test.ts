import { describe, expect, it } from "vitest";
import { InvalidChannelRefError, parseChannelRef } from "@/server/channel/parse";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  TokenDecryptionError,
} from "@/server/channel/crypto";

describe("parseChannelRef", () => {
  it("parses a raw UC… channel id", () => {
    expect(parseChannelRef("UCfixture00000000000000a1")).toEqual({
      kind: "id",
      value: "UCfixture00000000000000a1",
    });
  });

  it("parses @handles and bare handles", () => {
    expect(parseChannelRef("@deepdivecasey")).toEqual({ kind: "handle", value: "@deepdivecasey" });
    expect(parseChannelRef("deepdivecasey")).toEqual({ kind: "handle", value: "@deepdivecasey" });
  });

  it("parses /channel/ URLs", () => {
    expect(parseChannelRef("https://www.youtube.com/channel/UCfixture00000000000000a1")).toEqual({
      kind: "id",
      value: "UCfixture00000000000000a1",
    });
  });

  it("parses handle URLs with and without scheme", () => {
    expect(parseChannelRef("https://youtube.com/@casey.makes_films")).toEqual({
      kind: "handle",
      value: "@casey.makes_films",
    });
    expect(parseChannelRef("youtube.com/@deepdivecasey")).toEqual({
      kind: "handle",
      value: "@deepdivecasey",
    });
  });

  it("parses legacy /c/ and /user/ URLs as handle lookups", () => {
    expect(parseChannelRef("https://www.youtube.com/c/DeepDiveCasey")).toEqual({
      kind: "handle",
      value: "@DeepDiveCasey",
    });
    expect(parseChannelRef("https://www.youtube.com/user/oldschoolname")).toEqual({
      kind: "handle",
      value: "@oldschoolname",
    });
  });

  it("rejects non-YouTube URLs and garbage", () => {
    expect(() => parseChannelRef("https://vimeo.com/@someone")).toThrow(InvalidChannelRefError);
    expect(() => parseChannelRef("https://www.youtube.com/watch?v=abc123")).toThrow(
      InvalidChannelRefError,
    );
    expect(() => parseChannelRef("  ")).toThrow(InvalidChannelRefError);
    expect(() => parseChannelRef("!!")).toThrow(InvalidChannelRefError);
  });
});

describe("refresh-token encryption", () => {
  const secret = "test-secret-for-a1";

  it("round-trips and produces the v1 format with a fresh IV each time", () => {
    const token = "1//0refresh-token-value";
    const enc1 = encryptRefreshToken(token, secret);
    const enc2 = encryptRefreshToken(token, secret);
    expect(enc1.startsWith("v1.")).toBe(true);
    expect(enc1.split(".")).toHaveLength(4);
    expect(enc1).not.toBe(enc2); // random IV
    expect(enc1).not.toContain(token);
    expect(decryptRefreshToken(enc1, secret)).toBe(token);
    expect(decryptRefreshToken(enc2, secret)).toBe(token);
  });

  it("rejects tampered ciphertext and wrong keys", () => {
    const enc = encryptRefreshToken("secret-token", secret);
    const parts = enc.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from("evil").toString("base64url")}`;
    expect(() => decryptRefreshToken(tampered, secret)).toThrow(TokenDecryptionError);
    expect(() => decryptRefreshToken(enc, "a-different-secret")).toThrow(TokenDecryptionError);
    expect(() => decryptRefreshToken("garbage", secret)).toThrow(TokenDecryptionError);
  });
});
