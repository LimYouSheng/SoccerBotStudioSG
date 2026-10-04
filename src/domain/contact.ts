import { z } from "zod";
import {
  AGE_GROUPS,
  CONTACT_METHODS,
  EMERGENCY_RELATIONSHIPS,
  EXPERIENCE,
  RELATIONSHIPS,
} from "./catalog";
export const contactSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  contactMethod: z.string(),
  academy: z.string(),
  participant: z.string(),
  self: z.boolean(),
  relationship: z.string(),
  ageGroup: z.string(),
  experience: z.string(),
  additionalParticipants: z.string(),
  emergencySame: z.boolean(),
  emergencyName: z.string(),
  emergencyPhone: z.string(),
  emergencyRelationship: z.string(),
  requirements: z.string(),
  notes: z.string(),
});
export type ContactDetails = z.infer<typeof contactSchema>;
export type ContactErrors = Partial<Record<keyof ContactDetails, string>>;
export const blankContact = (): ContactDetails => ({
  name: "",
  email: "",
  phone: "",
  contactMethod: "email",
  academy: "",
  participant: "",
  self: true,
  relationship: "",
  ageGroup: "",
  experience: "",
  additionalParticipants: "",
  emergencySame: false,
  emergencyName: "",
  emergencyPhone: "",
  emergencyRelationship: "",
  requirements: "",
  notes: "",
});
export const validEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 120;
export const validPhone = (value: string) =>
  /^\+?[\d\s()-]{8,24}$/.test(value) &&
  value.replace(/\D/g, "").length >= 8 &&
  value.replace(/\D/g, "").length <= 15;
export const needsGuardian = (c: ContactDetails) =>
  ["child", "youth", "mixed"].includes(c.ageGroup);
export function normalizeContact(contact: ContactDetails): ContactDetails {
  const clean = Object.fromEntries(
    Object.entries(contact).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  ) as ContactDetails;
  if (clean.self) clean.emergencySame = false;
  if (clean.emergencySame) {
    clean.emergencyName = clean.name;
    clean.emergencyPhone = clean.phone;
  }
  return clean;
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
  if (!c.self && !nameOK(c.participant))
    errors.participant = "Enter the lead participant’s name.";
  if (!c.self && !(c.relationship in RELATIONSHIPS))
    errors.relationship = "Select your relationship.";
  if (!(c.ageGroup in AGE_GROUPS))
    errors.ageGroup = "Select the participant age group.";
  if (!(c.experience in EXPERIENCE))
    errors.experience = "Select the experience level.";
  if (!nameOK(c.emergencyName))
    errors.emergencyName = "Enter the emergency contact’s name.";
  if (!validPhone(c.emergencyPhone))
    errors.emergencyPhone = "Enter a valid emergency contact number.";
  else if (
    c.self &&
    c.emergencyPhone.replace(/\D/g, "") === c.phone.replace(/\D/g, "")
  )
    errors.emergencyPhone = "Provide a different number for emergencies.";
  if (
    !(c.emergencyRelationship in EMERGENCY_RELATIONSHIPS) ||
    (needsGuardian(c) &&
      !["parent", "guardian"].includes(c.emergencyRelationship))
  )
    errors.emergencyRelationship = needsGuardian(c)
      ? "Select parent or legal guardian."
      : "Select the emergency contact’s relationship.";
  for (const [key, max] of [
    ["additionalParticipants", 240],
    ["requirements", 300],
    ["notes", 300],
  ] as const)
    if (c[key].length > max)
      errors[key] = `Use no more than ${max} characters.`;
  return errors;
}
