import { ENQUIRY_TYPES } from "@/domain/catalog";
import { validEmail, validPhone } from "@/domain/contact";
import { isDate, todaySG } from "@/domain/dates";
import type { EnquiryService } from "../contracts";
export const demoEnquiryService: EnquiryService = {
  async submit(value) {
    if (
      value.name.trim().length < 2 ||
      value.name.length > 100 ||
      !validEmail(value.email.trim()) ||
      !validPhone(value.phone.trim())
    )
      throw new Error("Check your name, email and contact number.");
    if (
      !ENQUIRY_TYPES.includes(value.purpose) ||
      !value.message.trim() ||
      value.message.length > 2000
    )
      throw new Error("Choose an enquiry type and describe your requirements.");
    if (
      value.guests &&
      (!/^\d+$/.test(value.guests) || +value.guests < 1 || +value.guests > 999)
    )
      throw new Error("Enter a guest count from 1 to 999.");
    if (value.date && (!isDate(value.date) || value.date < todaySG()))
      throw new Error("Choose today or a future date.");
    return { email: value.email.trim(), delivered: false };
  },
};
