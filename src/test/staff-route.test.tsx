import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { manageStaff } = vi.hoisted(() => ({ manageStaff: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock("@/components/gpm/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/gpm/AttendancePanel", () => ({ AttendancePanel: () => null }));
vi.mock("@/components/gpm/AttendanceShiftSettings", () => ({
  AttendanceShiftSettings: () => null,
}));
vi.mock("@/components/gpm/AttendanceNetworkSettings", () => ({
  AttendanceNetworkSettings: () => null,
}));
vi.mock("@/lib/auth", () => ({
  useSession: () => ({ property_code: "TEST001", role: "Admin", token: "admin-id" }),
}));
vi.mock("@/lib/staff.functions", () => ({ manageStaff }));

import { StaffPage } from "@/routes/staff";

beforeEach(() => {
  manageStaff.mockReset();
  manageStaff.mockImplementation(({ data }: { data: { action: string } }) =>
    data.action === "list"
      ? Promise.resolve([])
      : Promise.reject(new Error("Email service unavailable")),
  );
});

describe("staff management form", () => {
  it("submits valid staff details and shows email failures beside the form", async () => {
    render(<StaffPage />);

    fireEvent.change(screen.getByLabelText("Staff full name"), {
      target: { value: "Amina Banda" },
    });
    fireEvent.change(screen.getByLabelText("Staff email"), {
      target: { value: "staff@company.example" },
    });

    const addButton = screen.getByRole("button", { name: "Add staff" });
    const form = addButton.closest("form");
    if (!form) throw new Error("The Add staff button must be inside a form.");

    fireEvent.click(addButton);

    await waitFor(() => {
      expect(manageStaff).toHaveBeenCalledWith({
        data: {
          action: "create",
          name: "Amina Banda",
          email: "staff@company.example",
          role: "Maintenance",
        },
      });
      expect(within(form).getByRole("alert")).toHaveTextContent("Email service unavailable");
    });
  });

  it("explains that new staff receive a generated password by email", async () => {
    manageStaff.mockImplementation(({ data }: { data: { action: string } }) =>
      Promise.resolve(data.action === "list" ? [] : {}),
    );
    render(<StaffPage />);

    fireEvent.change(screen.getByLabelText("Staff full name"), {
      target: { value: "Amina Banda" },
    });
    fireEvent.change(screen.getByLabelText("Staff email"), {
      target: { value: "staff@company.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "generated login password was requested",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Account > Edit Profile > Change Password",
    );
  });

  it("does not submit a malformed staff email address", async () => {
    render(<StaffPage />);

    fireEvent.change(screen.getByLabelText("Staff full name"), {
      target: { value: "Amina Banda" },
    });
    fireEvent.change(screen.getByLabelText("Staff email"), {
      target: { value: "staff@company" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));

    await waitFor(() => {
      expect(manageStaff).toHaveBeenCalledWith({ data: { action: "list" } });
    });
    expect(manageStaff).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "create" }) }),
    );
  });
});
