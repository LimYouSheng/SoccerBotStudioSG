import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { EnquiryPage } from "./enquiry-page";

test("enquiry waits for hydration then preserves entered details through submission", async () => {
  const container = document.createElement("div");
  const markup = new DOMParser().parseFromString(
    renderToString(<EnquiryPage />),
    "text/html",
  );
  container.append(...markup.body.childNodes);
  document.body.append(container);
  const name = screen.getByLabelText("Full name", { exact: false });
  const controls = container.querySelectorAll(
    "input, select, textarea, button",
  );
  expect(controls).toHaveLength(10);
  for (const control of controls) expect(control).toBeDisabled();

  const hydrationErrors: unknown[] = [];
  await act(async () => {
    render(<EnquiryPage />, {
      container,
      hydrate: true,
      onRecoverableError: (error) => hydrationErrors.push(error),
    });
  });
  expect(hydrationErrors).toEqual([]);
  expect(screen.getByLabelText("Full name", { exact: false })).toBe(name);
  for (const control of controls) expect(control).toBeEnabled();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Send enquiry" }));
  expect(name).toBeInvalid();
  expect(screen.queryByText("Preview · No enquiry sent.")).toBeNull();
  fireEvent.change(name, { target: { value: "Demo Customer" } });
  fireEvent.change(screen.getByLabelText("Email address", { exact: false }), {
    target: { value: "demo@example.com" },
  });
  expect(name).toHaveValue("Demo Customer");
  fireEvent.change(screen.getByLabelText("Contact number", { exact: false }), {
    target: { value: "+65 8123 4567" },
  });
  await user.selectOptions(
    screen.getByLabelText("Enquiry type", { exact: false }),
    "Corporate booking",
  );
  fireEvent.change(
    screen.getByLabelText("Your requirements", { exact: false }),
    {
      target: { value: "A group session for our team." },
    },
  );
  await user.click(screen.getByRole("button", { name: "Send enquiry" }));
  expect(await screen.findByText("Preview · No enquiry sent.")).toBeVisible();
  expect(screen.getByText("demo@example.com")).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Send another enquiry" }),
  );
  expect(screen.getByLabelText("Full name", { exact: false })).toHaveValue("");
  expect(screen.getByRole("button", { name: "Send enquiry" })).toBeEnabled();
});
