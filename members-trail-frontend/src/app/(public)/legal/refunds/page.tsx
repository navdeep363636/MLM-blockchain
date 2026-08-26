/* L-06 · Refund & Cancellation Policy — FRD 11.6 */
import { LegalDocFromApi } from "../_components/fetch-doc";

export const metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "When in-app purchases are refundable, how cancelled tournaments and prize pools are handled, why token conversions are irreversible, what a chargeback does to your account and to your upline's commission, and how to request a refund.",
};

export default function RefundsPage() {
  return <LegalDocFromApi slug="refunds" />;
}
