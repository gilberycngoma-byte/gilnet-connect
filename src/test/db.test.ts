import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { read, remove, useStored, write } from "@/lib/db";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("offline store fallback", () => {
  it("keeps local writes readable when browser storage is full", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });

    write("gilnet_offline_test_quota", [{ id: "local-1" }], false);

    expect(read("gilnet_offline_test_quota", [])).toEqual([{ id: "local-1" }]);
    expect(warn).toHaveBeenCalledWith("GILNET localStorage write failed", expect.any(DOMException));
  });

  it("does not resurrect a removed value when local removal fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    write("gilnet_offline_test_remove", ["kept"], false);
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("Storage is unavailable");
    });

    remove("gilnet_offline_test_remove");

    expect(read("gilnet_offline_test_remove", [])).toEqual([]);
  });

  it("uses the list fallback when stored data is not an array", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("gilnet_offline_test_shape", JSON.stringify({ unexpected: true }));

    expect(read("gilnet_offline_test_shape", [])).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "GILNET stored list data is invalid",
      "gilnet_offline_test_shape",
    );
  });

  it("keeps stored list hooks from exposing non-array data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = "gilnet_offline_test_hook_shape";
    localStorage.setItem(key, JSON.stringify({ unexpected: true }));
    const fallback: unknown[] = [];

    const { result } = renderHook(() => useStored<unknown[]>(key, fallback));

    expect(result.current).toBe(fallback);
    expect(warn).toHaveBeenCalledWith("GILNET stored list data is invalid", key);
  });
});
