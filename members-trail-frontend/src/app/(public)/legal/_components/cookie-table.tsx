/* Cookie categories table — FRD 11.8 §2.
 * Server component: a semantic <table> rather than the client DataTable, so the
 * Cookie Policy page stays fully static and prints cleanly. */

import { Check, X } from "lucide-react";
import { cookieGroups, type CookieGroup } from "@/content/cookies";

const ORDER: CookieGroup["category"][] = [
  "Strictly necessary",
  "Functional",
  "Analytics",
  "Fraud prevention",
];

export function CookieTable() {
  return (
    <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Cookies and similar technologies used by Members Trail, grouped by category, with
            purpose, duration, whether they are first or third party, and whether they require your
            consent.
          </caption>
          <thead>
            <tr className="border-b border-border-default bg-surface-2">
              <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Name or group</th>
              <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Purpose</th>
              <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Duration</th>
              <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Party</th>
              <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Consent</th>
            </tr>
          </thead>
          {ORDER.map((category) => {
            const rows = cookieGroups.filter((c) => c.category === category);
            if (rows.length === 0) return null;
            return (
              <tbody key={category} className="border-b border-border-subtle last:border-b-0">
                <tr className="bg-surface-inset">
                  <th
                    scope="colgroup"
                    colSpan={5}
                    className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-secondary"
                  >
                    {category}
                  </th>
                </tr>
                {rows.map((c) => (
                  <tr key={`${category}-${c.name}`} className="border-t border-border-subtle align-top">
                    <th scope="row" className="px-4 py-3 text-left font-medium text-text-primary">
                      <span className="font-mono-num text-[0.8rem]">{c.name}</span>
                    </th>
                    <td className="px-4 py-3 leading-relaxed text-text-secondary">{c.purpose}</td>
                    <td className="tnum px-4 py-3 text-text-secondary">{c.duration}</td>
                    <td className="px-4 py-3 text-text-secondary">{c.party}</td>
                    <td className="px-4 py-3">
                      {c.consentRequired ? (
                        <span className="inline-flex items-center gap-1.5 text-good-400">
                          <Check className="size-3.5" aria-hidden />
                          Asked first
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-text-muted">
                          <X className="size-3.5" aria-hidden />
                          Not required
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
