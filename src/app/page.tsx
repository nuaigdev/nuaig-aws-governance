import { redirect } from "next/navigation";

/**
 * The portal has no marketing page — the root is just an entry point.
 * `/buckets` is behind the auth guard, which sends a signed-out visitor to
 * sign-in with a `next` parameter so they land where they were headed.
 */
export default function RootPage() {
  redirect("/buckets");
}
