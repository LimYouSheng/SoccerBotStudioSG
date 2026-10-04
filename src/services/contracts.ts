import type { InstructorId } from "@/domain/catalog";
import type {
  Attempt,
  Booking,
  BookingDraft,
  Outcome,
  Slot,
} from "@/domain/booking";
export type AvailableSlot = Slot & { available: boolean };
export interface BookingService {
  instructors(slots: Slot[]): InstructorId[];
  availability(date: string): AvailableSlot[];
  checkout(
    draft: BookingDraft,
    previous: Attempt | null,
    simulateConflict?: boolean,
  ): Attempt;
  pay(attempt: Attempt, outcome: Outcome): Attempt;
  check(attempt: Attempt): Attempt;
  resolve(attempt: Attempt, now?: number): Attempt;
}
export interface EnquiryService {
  submit(values: Enquiry): Promise<{ email: string; delivered: false }>;
}
export type Enquiry = {
  name: string;
  email: string;
  phone: string;
  organisation: string;
  purpose: string;
  guests: string;
  date: string;
  time: string;
  message: string;
};
export type VerifiedIdentity = { email: string; expiresAt: number };
export type AuthChallenge = {
  email: string;
  expiresAt: number;
  used: boolean;
  attempts: number;
};
export interface IdentityService {
  read(): VerifiedIdentity | null;
  challenge(email: string): AuthChallenge;
  verify(
    challenge: AuthChallenge,
    code: string,
    remember: boolean,
  ): VerifiedIdentity;
  signOut(): void;
  profile(email: string): BookingDraft["contact"] | null;
  saveProfile(draft: BookingDraft): void;
}
export interface AssistantService {
  reply(text: string, booking: Booking | null): string;
}
