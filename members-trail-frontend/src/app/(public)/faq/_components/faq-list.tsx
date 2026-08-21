"use client";

import { useMemo, useState } from "react";
import { SearchX } from "lucide-react";
import { Accordion, EmptyState, PillTabs, SearchInput } from "@/components/ui";
import { FAQ_CATEGORIES, type FaqItem } from "./faq-data";

export function FaqList() {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");

  const all = useMemo<FaqItem[]>(
    () => FAQ_CATEGORIES.flatMap((c) => c.items.map((i) => ({ ...i, category: c.label }))),
    [],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((i) => {
      if (cat !== "all" && i.category !== cat) return false;
      if (!needle) return true;
      return i.q.toLowerCase().includes(needle) || i.a.toLowerCase().includes(needle);
    });
  }, [all, cat, q]);

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <PillTabs
          value={cat}
          onValueChange={setCat}
          items={[
            { value: "all", label: "All", count: all.length },
            ...FAQ_CATEGORIES.map((c) => ({ value: c.label, label: c.label, count: c.items.length })),
          ]}
        />
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Search questions…"
          className="w-full lg:max-w-xs"
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          className="mt-8 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
          icon={<SearchX />}
          title="No questions match that search"
          description="Try a different term, or contact support directly and we'll answer it."
          action={{ label: "Contact support", href: "/contact" }}
        />
      ) : (
        <>
          <p className="mt-6 text-xs text-text-muted">
            {shown.length} {shown.length === 1 ? "question" : "questions"}
            {cat !== "all" && ` in ${cat}`}
          </p>
          <Accordion
            className="mt-3"
            defaultOpen={0}
            items={shown.map((i) => ({
              title: i.q,
              content: (
                <>
                  <p className="whitespace-pre-line">{i.a}</p>
                  {cat === "all" && (
                    <p className="mt-3 text-xs font-medium uppercase tracking-wider text-text-muted">
                      {i.category}
                    </p>
                  )}
                </>
              ),
            }))}
          />
        </>
      )}
    </div>
  );
}
