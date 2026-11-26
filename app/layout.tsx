import type { Metadata } from "next";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/dm-serif-display/latin-400-italic.css";
import "./globals.css";
import { Header, Footer } from "@/components/chrome";
export const metadata: Metadata = {
  title: {
    default: "Santa Circle · Secret Santa gift exchanges",
    template: "%s · Santa Circle",
  },
  description:
    "Organize a Secret Santa exchange with private matches, shared wishlists and a little holiday magic.",
};
const themeScript =
  "try{document.documentElement.dataset.theme=localStorage.getItem('santa-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{}";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
