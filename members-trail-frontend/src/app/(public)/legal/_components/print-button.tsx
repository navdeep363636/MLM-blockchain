"use client";

/* Print affordance for legal documents — FRD 11.
 * Client-only because it calls window.print(); the document itself stays a
 * server component. Print styles live on the layout via `print:` variants. */

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Printer className="size-4" />}
      onClick={() => window.print()}
      className="print:hidden"
    >
      {label}
    </Button>
  );
}
