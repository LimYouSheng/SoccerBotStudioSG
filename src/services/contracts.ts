import type {
  Attempt,
  Booking,
  BookingDraft,
  Outcome,
  Session,
} from "@/domain/booking";
export type AvailableSlot = Session & { available: boolean };
export type BookingMode = "demo" | "live";
export type BookingOperation =
  "availability" | "checkout" | "pay" | "check" | "resolve";
export type BookingRequest = { signal?: AbortSignal };
export type AvailabilityInput = BookingRequest & {
  date: string;
  players: number;
};
export type CheckoutInput = BookingRequest & {
  draft: BookingDraft;
  previous: Attempt | null;
};
export type PayInput = BookingRequest & { attempt: Attempt; outcome: Outcome };
export type AttemptInput = BookingRequest & { attempt: Attempt };
export type ResolveInput = AttemptInput & { now?: number };
export interface BookingService {
  readonly mode: BookingMode;
  readonly operations: Readonly<
    Record<BookingOperation, "demo" | "unavailable">
  >;
  availability(input: AvailabilityInput): Promise<AvailableSlot[]>;
  checkout(input: CheckoutInput): Promise<Attempt>;
  pay(input: PayInput): Promise<Attempt>;
  check(input: AttemptInput): Promise<Attempt>;
  resolve(input: ResolveInput): Promise<Attempt>;
}
export type BookingErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "conflict"
  | "unavailable"
  | "temporarily_unavailable"
  | "cancelled";
export class BookingServiceError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BookingServiceError";
  }
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
