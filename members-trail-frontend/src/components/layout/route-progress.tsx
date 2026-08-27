"use client";

/* ============================================================================
 * Navigation progress indicator.
 *
 * THE PROBLEM
 * -----------
 * A `loading.tsx` boundary covers the case where a route segment has work to do.
 * But there is a window BEFORE that — between the click and the router
 * committing — where the App Router is fetching the RSC payload and still
 * rendering the old page. On a warm prefetch that is a few milliseconds. On a
 * cold one, a slow connection, or a dev server compiling on demand, it is
 * hundreds of milliseconds to seconds of a page that looks like it ignored the
 * click.
 *
 * WHY THIS IS NOT A REACT COMPONENT
 * ---------------------------------
 * It was, and it did not work. Measured on a throttled production navigation
 * (6x CPU, 800ms RTT):
 *
 *     click                 174ms
 *     imperative DOM node   279ms   <- painted over the old page
 *     React-rendered bar   1134ms   <- same instant the URL committed
 *
 * The App Router runs navigation inside `startTransition`. While that
 * transition render is pending, React defers re-rendering everything else,
 * including a component whose only job is to say the transition has started. So
 * a React-rendered indicator is structurally incapable of appearing before the
 * navigation it announces has already finished — it renders exactly once it is
 * useless, and every attempt to fix it by moving state around fails for the
 * same reason.
 *
 * An acknowledgement of a click must not be queued behind the work it is
 * acknowledging. So the indicator is plain DOM, written directly in the click
 * handler and driven by timers, entirely outside React's scheduler. It paints
 * on the next frame no matter what React is doing. React's only involvement is
 * a component that installs the listeners and reports, via `usePathname`, that
 * the navigation committed — an effect that runs after commit, which is exactly
 * when completion should be signalled.
 *
 * Styles are inline rather than Tailwind classes: these nodes never appear in
 * JSX, so the class scanner would not emit rules for them.
 *
 * WHY A DOCUMENT-LEVEL LISTENER
 * -----------------------------
 * There is no public "the router is navigating" signal. The alternative is
 * replacing every `<Link>` in ~100 files with a reporting wrapper — a lot of
 * churn and one forgotten import away from a dead spot. A capture-phase
 * listener on `document` sees every click on every internal anchor, including
 * ones added later by code that knows nothing about this file.
 * `startRouteProgress()` is exported for the few places that navigate via
 * `router.push`.
 * ========================================================================== */

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Below this, a transition is imperceptible and a flashing bar is just noise. */
const SHOW_AFTER_MS = 90;
/**
 * Past this, a 2px hairline is not enough. On `next dev` a first visit to an
 * uncompiled route takes 12-21 seconds while Next compiles it, and for all of
 * that time the previous page sits there looking frozen behind a thread of
 * colour nobody notices. Same story on a bad connection. After 400ms the reader
 * gets something they cannot miss.
 */
const ESCALATE_AFTER_MS = 400;
/**
 * A navigation that never lands must not strand the indicator on screen — a
 * redirect back to the same URL, for instance, gives `usePathname` nothing to
 * notice. 60s is a safety net for that, not a guess at how long slow is; a
 * shorter ceiling gave up mid-compile and restored the frozen screen this
 * exists to prevent.
 */
const MAX_MS = 60_000;

type Timer = ReturnType<typeof setTimeout> | null;

let host: HTMLDivElement | null = null;
let fill: HTMLDivElement | null = null;
let scrim: HTMLDivElement | null = null;
let showT: Timer = null;
let heavyT: Timer = null;
let maxT: Timer = null;
let doneT: Timer = null;
let active = false;

function build() {
  if (host || typeof document === "undefined") return;

  host = document.createElement("div");
  host.setAttribute("data-route-progress", "");
  /* pointer-events:none on purpose. This is feedback, not a modal — blocking
     the UI would also block the back button and the nav, which is precisely
     what someone reaches for when a page is taking too long. */
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;pointer-events:none;display:none";

  const track = document.createElement("div");
  track.style.cssText =
    "position:absolute;top:0;left:0;right:0;height:2px;overflow:hidden";

  fill = document.createElement("div");
  /* Deliberately not a fake percentage crawling to 90%. It eases toward a
     ceiling it never reaches while work is outstanding, then completes. A bar
     that pretends to know how far along it is starts lying the moment a
     request takes longer than average. */
  fill.style.cssText =
    "height:100%;width:0;" +
    "background:linear-gradient(90deg,var(--color-brand-600),var(--accent) 60%,var(--color-brand-300));" +
    "box-shadow:0 0 10px 1px var(--accent-ring)";
  track.appendChild(fill);

  scrim = document.createElement("div");
  scrim.setAttribute("role", "status");
  scrim.setAttribute("aria-live", "polite");
  scrim.setAttribute("aria-label", "Loading page");
  scrim.style.cssText =
    "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
    "background:color-mix(in oklab, var(--surface-0) 62%, transparent)";

  const card = document.createElement("div");
  card.style.cssText =
    "display:flex;align-items:center;gap:.75rem;padding:.875rem 1.25rem;border-radius:1rem;" +
    "border:1px solid var(--border-default);background:var(--surface-1);" +
    "box-shadow:var(--shadow-e4),inset 0 1px 0 0 var(--rim-light)";

  const spinner = document.createElement("span");
  spinner.setAttribute("aria-hidden", "true");
  spinner.style.cssText =
    "width:1rem;height:1rem;flex-shrink:0;border-radius:9999px;" +
    "border:2px solid var(--accent);border-top-color:transparent;" +
    "animation:nav-spin .6s linear infinite";

  const label = document.createElement("span");
  label.style.cssText =
    "font-size:.875rem;font-weight:500;color:var(--text-secondary)";
  label.textContent = "Loading…";

  card.append(spinner, label);
  scrim.appendChild(card);
  host.append(track, scrim);
  document.body.appendChild(host);
}

function clearTimers() {
  for (const t of [showT, heavyT, maxT, doneT]) if (t) clearTimeout(t);
  showT = heavyT = maxT = doneT = null;
}

/**
 * Clear every per-link pending affordance. Those are applied imperatively too
 * (see nav-link.tsx) and for the same reason, so they have to be torn down
 * imperatively as well — a React effect would clean up on the wrong frame.
 */
function clearLinkClaims() {
  if (typeof document === "undefined") return;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-nav-pending]"))) {
    el.removeAttribute("data-nav-pending");
    const claimed = el.dataset.navClaimed;
    if (claimed) {
      el.classList.remove(...claimed.split(" ").filter(Boolean));
      delete el.dataset.navClaimed;
    }
  }
}

function hide() {
  clearLinkClaims();
  if (host) host.style.display = "none";
  if (scrim) scrim.style.display = "none";
  if (fill) {
    fill.style.animation = "none";
    fill.style.transition = "none";
    fill.style.width = "0";
    fill.style.opacity = "1";
  }
  active = false;
}

function showBar() {
  if (!host || !fill) return;
  host.style.display = "block";
  fill.style.transition = "none";
  fill.style.opacity = "1";
  fill.style.animation = "none";
  /* Force a reflow so a repeat navigation restarts the animation rather than
     inheriting the finished state of the previous one. */
  void fill.offsetWidth;
  fill.style.animation =
    "route-progress 1.4s cubic-bezier(0.2,0.8,0.2,1) forwards";
  active = true;
}

function showScrim() {
  if (!host || !scrim) return;
  host.style.display = "block";
  scrim.style.display = "flex";
  scrim.style.animation = "fade-in 140ms ease-out";
  active = true;
}

/** Start the indicator. Call immediately before a programmatic `router.push`. */
export function startRouteProgress() {
  build();
  clearTimers();
  hide();
  showT = setTimeout(showBar, SHOW_AFTER_MS);
  heavyT = setTimeout(showScrim, ESCALATE_AFTER_MS);
  maxT = setTimeout(hide, MAX_MS);
}

/** The URL changed: run the bar out to full so it reads as finished, not cancelled. */
function completeRouteProgress() {
  clearTimers();
  if (!active) {
    hide();
    return;
  }
  clearLinkClaims();
  if (scrim) scrim.style.display = "none";
  if (fill) {
    fill.style.animation = "none";
    fill.style.transition = "width 140ms ease-out, opacity 180ms ease-out 100ms";
    void fill.offsetWidth;
    fill.style.width = "100%";
    fill.style.opacity = "0";
  }
  doneT = setTimeout(hide, 300);
}

export function RouteProgress() {
  const pathname = usePathname();
  /* The string, not the object: `useSearchParams()` returns a fresh instance
     every render, so depending on the object would re-run the effect below
     constantly. */
  const search = useSearchParams()?.toString() ?? "";

  useEffect(() => {
    build();

    const onClick = (e: MouseEvent) => {
      /* Modified clicks open a new tab — this page is not navigating. */
      if (
        e.defaultPrevented || e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
      ) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      const target = anchor.getAttribute("target");
      if (!href || (target && target !== "_self")) return;
      /* Same-document jumps, mailto:, tel:, downloads — not route changes. */
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      /* Clicking the link you are already on is not a navigation. */
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;

      startRouteProgress();
    };

    /* Back/forward is a navigation too, and popstate is the only signal. */
    const onPop = () => startRouteProgress();

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  /* This effect runs after the navigation commits — which is precisely the
     moment completion should be signalled. */
  useEffect(() => {
    completeRouteProgress();
  }, [pathname, search]);

  useEffect(() => () => { clearTimers(); hide(); }, []);

  return null;
}
