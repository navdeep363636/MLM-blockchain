import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { API_BASE, API_ORIGIN } from "@/lib/api/client";

export const metadata: Metadata = {
  title: {
    default: "Members Trail — Play. Earn. Stake.",
    template: "%s · Members Trail",
  },
  description:
    "Skill-based gaming on BNB Smart Chain. Earn Points through gameplay, convert to MTT, stake for revenue-funded yield. Referrals are an optional, capped bonus — never required to earn.",
  applicationName: "Members Trail",
  openGraph: {
    title: "Members Trail — Play. Earn. Stake.",
    description: "Skill-based play-to-earn gaming with revenue-funded rewards on BNB Smart Chain.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14110f" },
    { media: "(prefers-color-scheme: light)", color: "#fdfcfb" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Preconnect so the refresh below does not pay for DNS + TLS itself. */}
        <link rel="preconnect" href={API_ORIGIN} crossOrigin="use-credentials" />
        {/* Starts the session restore during HTML parse instead of after hydration.
            Measured on a 4x-throttled cold /admin: the module-level bootstrap in
            client.ts could not run until the app bundle evaluated, which put
            POST /auth/refresh at 593ms on a document whose scripts had all landed
            by 217ms. Every authenticated request on the page queues behind it.
            The promise is parked on window and adopted by refreshSession(), so
            React never issues a second one - refresh tokens are single-use.

            Gated on mt_session, a readable companion the server sets next to the
            httpOnly refresh cookie. Without it this fired on every document -
            the marketing pages, the login screen, every anonymous visitor - and
            spent a rate-limit allowance that a signed-in member then needed.

            The status travels with the body. A 429 or a 502 has to be
            distinguishable from a 401 downstream, or a rate limit reads as a
            logout. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var B=${JSON.stringify(API_BASE)};` +
              `if(document.cookie.indexOf("mt_session=1")<0){window.__mtSession=null;window.__mtProfile=null;}else{` +
              `var s=fetch(B+"/auth/refresh",{method:"POST",credentials:"include",` +
              `headers:{"Content-Type":"application/json"},body:"{}"})` +
              `.then(function(r){return r.ok?r.json().then(function(j){return{status:r.status,body:j}},` +
              `function(){return{status:r.status,body:null}}):{status:r.status,body:null}})` +
              `.catch(function(){return{status:0,body:null}});` +
              `window.__mtSession=s;` +
              /* Chained here rather than left to React: the guards on every
                 dashboard route hold their content until the profile lands, so
                 this one request is what the reader is waiting on. */
              `window.__mtProfile=s.then(function(o){var t=o&&o.body&&o.body.tokens&&o.body.tokens.accessToken;if(!t)return null;` +
              `return fetch(B+"/users/me",{headers:{Authorization:"Bearer "+t}})` +
              `.then(function(r){return r.ok?r.json():null})}).catch(function(){return null});` +
              `}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
