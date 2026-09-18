import { useRef, useState, type ChangeEvent } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";

export function CatalogThumb({
  src,
  alt,
  className,
  size = "md"
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const dim = size === "sm" ? "h-9 w-9" : size === "lg" ? "aspect-[4/3] w-full" : "h-16 w-16";
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        className={cn("shrink-0 rounded-lg bg-paper-2 object-cover", dim, className)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-lg bg-paper-2 text-muted", dim, className)} aria-hidden>
      <ImageIcon size={size === "lg" ? 28 : size === "sm" ? 14 : 18} strokeWidth={1.5} />
    </span>
  );
}

export function CatalogImagePicker({
  label,
  src,
  onFile,
  onClear
}: {
  label: string;
  src?: string | null;
  onFile: (file: File | null) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    onFile(file);
    e.target.value = "";
  }

  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-ink-2">{label}</p>
      <div className="flex items-center gap-3">
        <CatalogThumb src={src} size="md" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => input.current?.click()}>
            Upload
          </Button>
          {src ? (
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>
              Remove
            </Button>
          ) : null}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
      </div>
      <p className="mt-1 text-[12px] text-muted">Optional. PNG, JPEG or WebP, up to 5 MB. Placeholder shows until you add a photo.</p>
    </div>
  );
}
