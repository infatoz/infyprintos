import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Modal, Textarea } from "@/components/ui";

export type WhatsappShare = {
  logId: string;
  event: string;
  to: string;
  toE164?: string;
  body: string;
  waMe: string;
  status?: string;
};

export function pickWhatsapp(data: unknown): WhatsappShare | null {
  if (!data || typeof data !== "object") return null;
  const row = data as { whatsapp?: WhatsappShare; share?: { waMe?: string; vars?: unknown } };
  if (row.whatsapp?.body || row.whatsapp?.waMe) return row.whatsapp;
  return null;
}

function waUrl(share: WhatsappShare, body: string) {
  const e164 = share.toE164 || share.to.replace(/\D/g, "");
  if (!e164) return share.waMe;
  return `https://wa.me/${e164}?text=${encodeURIComponent(body)}`;
}

export function WhatsAppShareModal({
  share,
  title = "Share on WhatsApp",
  onClose
}: {
  share: WhatsappShare;
  title?: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState(share.body);
  const [marking, setMarking] = useState(false);
  const url = waUrl(share, body);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function openAndMark() {
    if (!url) {
      toast.error("Customer has no WhatsApp number");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    if (!share.logId) return;
    setMarking(true);
    try {
      await api.post(`/notifications/logs/${share.logId}/mark-sent`);
    } catch {
      /* opening WhatsApp still succeeded */
    } finally {
      setMarking(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-3 text-[13px] text-muted">
        Nothing is sent automatically. Open WhatsApp, review the message, then send it to the customer.
      </p>
      <p className="mb-2 text-[12px] text-ink-2">
        To: <span className="font-mono">{share.to || "No number on file"}</span>
        <span className="ml-2 capitalize text-muted">{share.event.replaceAll("_", " ")}</span>
      </p>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[140px]" />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyText()}>
          <Copy size={14} /> Copy
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Skip
        </Button>
        <Button type="button" onClick={() => void openAndMark()} disabled={!url || marking}>
          <ExternalLink size={14} /> {marking ? "Opening…" : "Open WhatsApp"}
        </Button>
      </div>
    </Modal>
  );
}
