import { z } from "zod";
import { CONTACT_METHODS } from "./catalog";
export const contactSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  contactMethod: z.string(),
  academy: z.string(),
});
export type ContactDetails = z.infer<typeof contactSchema>;
export type ContactErrors = Partial<Record<keyof ContactDetails, string>>;
export const blankContact = (): ContactDetails => ({
  name: "",
  email: "",
  phone: "",
  contactMethod: "email",
  academy: "",
});
export const validEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 120;
export const validPhone = (value: string) =>
  /^\+?[\d\s()-]{8,24}$/.test(value) &&
  value.replace(/\D/g, "").length >= 8 &&
  value.replace(/\D/g, "").length <= 15;
export function normalizeContact(contact: ContactDetails): ContactDetails {
  return Object.fromEntries(
    Object.entries(contactSchema.parse(contact)).map(([key, value]) => [
      key,
      value.trim(),
    ]),
  ) as ContactDetails;
}
export function contactErrors(
  contact: ContactDetails,
  verifiedEmail?: string,
): ContactErrors {
  const c = normalizeContact(contact),
    errors: ContactErrors = {};
  const nameOK = (value: string) => value.length >= 2 && value.length <= 80;
  if (!nameOK(c.name)) errors.name = "Enter the booking contact’s full name.";
  if (!validEmail(c.email)) errors.email = "Enter a valid email address.";
  else if (verifiedEmail && c.email !== verifiedEmail)
    errors.email = "Use your verified email address.";
  if (!validPhone(c.phone)) errors.phone = "Enter a valid mobile number.";
  if (!(c.contactMethod in CONTACT_METHODS))
    errors.contactMethod = "Select a contact method.";
  if (c.academy.length > 120)
    errors.academy = "Use no more than 120 characters.";
  return errors;
}
