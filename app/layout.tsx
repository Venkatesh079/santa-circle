import type { Metadata } from "next";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/dm-serif-display/latin-400-italic.css";
import "./globals.css";
import { Header, Footer } from "@/components/chrome";
import { Snowfall } from "@/components/snowfall";
import { currentUser } from "@/lib/auth";
import { store } from "@/lib/db";
import { WishlistSession } from "@/components/wishlist-session";
export const metadata: Metadata = {
  title: {
    default: "Santa Circle · Secret Santa gift exchanges",
    template: "%s · Santa Circle",
  },
  description:
    "Organize a Secret Santa exchange with private matches, shared wishlists and a little holiday magic.",
};
const themeScript =
  "try{document.documentElement.dataset.theme=localStorage.getItem('santa-theme')||'light'}catch{}";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const sessionKey = user ? `${user.id}:${store().drawRevision()}` : "guest";
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Snowfall />
        <WishlistSession key={sessionKey} initialWishlist={user?.wishlist || ""}>
          <Header signedIn={Boolean(user)} />
          <main id="main">{children}</main>
          <Footer />
        </WishlistSession>
      </body>
    </html>
  );
}
