export type User = { id: string; name: string; admin: boolean; wishlist: string };
export type UserRow = Omit<User, "admin"> & { admin: number; password_hash: string; recovery_question: string | null; recovery_answer_hash: string | null };
export type Match = { name: string; wishlist: string };
export class AppError extends Error {
  readonly code = "SANTA_VALIDATION";
  name = "AppError";
}

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
