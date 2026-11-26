export function canCreateGroup(user?: { email?: string; email_confirmed_at?: string; is_anonymous?: boolean } | null) {
  return !!user?.email_confirmed_at && !user.is_anonymous &&
    user.email?.toLowerCase() === "venkatesh.chappavarapu7@gmail.com";
}
