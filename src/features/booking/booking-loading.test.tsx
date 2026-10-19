import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BookingLoading, BookingLoadingProvider } from "./booking-loading";

test("overlapping booking reads share one full-page loader and preserve the mounted form", () => {
  function Screen({ first, second }: { first: boolean; second: boolean }) {
    return (
      <BookingLoadingProvider>
        <input aria-label="Contact name" defaultValue="" />
        {first && <BookingLoading label="Preparing booking" />}
        {second && <BookingLoading label="Reading calendar" />}
      </BookingLoadingProvider>
    );
  }
  const view = render(<Screen first={false} second={false} />);
  const input = screen.getByLabelText("Contact name");
  fireEvent.change(input, { target: { value: "Retained name" } });
  view.rerender(<Screen first second />);
  expect(document.querySelectorAll(".page-loading")).toHaveLength(1);
  expect(
    screen.getByText(
      "Please don’t close or refresh this page while we finish.",
    ),
  ).toBeVisible();
  expect(document.querySelector(".booking-loading-inline")).toBeNull();
  expect(input.parentElement).toHaveAttribute("inert");
  view.rerender(<Screen first={false} second />);
  expect(
    screen.getByRole("status", { name: "Reading calendar" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Contact name")).toBe(input);
  view.rerender(<Screen first={false} second={false} />);
  expect(document.querySelector(".page-loading")).toBeNull();
  expect(input).toHaveValue("Retained name");
  expect(input.parentElement).not.toHaveAttribute("inert");
});

test("unmounting a pending booking screen releases the overlay and existing page inert state", () => {
  const main = document.createElement("main");
  main.id = "main";
  main.inert = false;
  document.body.append(main);
  const view = render(
    <BookingLoadingProvider>
      <BookingLoading label="Checking booking" />
    </BookingLoadingProvider>,
    { container: main },
  );
  expect(main.inert).toBe(true);
  view.unmount();
  expect(main.inert).toBe(false);
  expect(document.querySelector(".booking-flow-overlay")).toBeNull();
  main.remove();
});

test("display loading leaves navigation interactive while payment loading still locks the page", () => {
  const view = render(
    <BookingLoadingProvider>
      <button>Continue as guest</button>
      <BookingLoading compact overlay={false} label="Reading calendar" />
    </BookingLoadingProvider>,
  );
  const button = screen.getByRole("button", { name: "Continue as guest" });
  expect(button.closest("[inert]")).toBeNull();
  expect(document.querySelector(".booking-flow-overlay")).toBeNull();
  expect(screen.getByRole("status")).toHaveClass("booking-loading-inline");
  view.rerender(
    <BookingLoadingProvider>
      <button>Continue as guest</button>
      <BookingLoading compact overlay={false} label="Reading calendar" />
      <BookingLoading compact label="Opening secure payment…" />
    </BookingLoadingProvider>,
  );
  expect(button.closest("[inert]")).not.toBeNull();
  expect(document.querySelectorAll(".booking-flow-overlay")).toHaveLength(1);
});
