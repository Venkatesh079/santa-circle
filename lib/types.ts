export type Idea = { title: string; url: string; notes: string };
export type Recipient = {
  name: string;
  ideas: Idea[];
  interests: string;
  preferences: string;
};
export type Summary = {
  id: string;
  name: string;
  date: string;
  drawn: boolean;
  organizer: boolean;
};
export type Circle = Summary & {
  budget: number;
  currency: string;
  message: string;
  code: string | null;
  me: string;
  myEmail: string;
  ideas: Idea[];
  interests: string;
  preferences: string;
  revealed: boolean;
  members: {
    id: string;
    name: string;
    organizer: boolean;
    revealed: boolean | null;
  }[];
  pending: string[];
  exclusions: { a: string; b: string }[];
};
export type Result = {
  error?: string;
  success?: string;
  recipient?: Recipient;
};
export const budgetCurrency = "INR";
export function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));
}
const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: budgetCurrency,
});
export function budgetLabel(group: Pick<Circle, "budget" | "currency">) {
  return group.currency === budgetCurrency
    ? `${rupees.format(group.budget)} budget`
    : "INR budget not set";
}
