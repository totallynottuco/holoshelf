import { BadgeCheck } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { InstalledUpdateRelease } from "../../shared/ipc";

interface InstalledUpdateDialogProps {
  release: InstalledUpdateRelease;
  onDismiss: () => void | Promise<void>;
}

type ReleaseNoteBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export function InstalledUpdateDialog({ release, onDismiss }: InstalledUpdateDialogProps) {
  const dismissButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dismissButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void onDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss]);

  const notes = parseReleaseNotes(release.releaseNotes);
  const releaseDate = formatReleaseDate(release.releaseDate);

  return (
    <div
      className="installed-update-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          void onDismiss();
        }
      }}
    >
      <section
        className="installed-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="installed-update-title"
      >
        <header className="installed-update-header">
          <span className="installed-update-mark" aria-hidden="true">
            <BadgeCheck size={24} strokeWidth={2} />
          </span>
          <div>
            <span className="installed-update-eyebrow">Update installed</span>
            <h2 id="installed-update-title">What&apos;s new in Holoshelf {release.version}</h2>
          </div>
        </header>

        <div className="installed-update-notes">
          {notes.length > 0 ? (
            notes.map((block, index) => renderReleaseNoteBlock(block, index))
          ) : (
            <p>No release notes were provided for this update.</p>
          )}
        </div>

        <footer className="installed-update-footer">
          <span>{releaseDate ? `Released ${releaseDate}` : release.releaseName ?? "Holoshelf update"}</span>
          <button ref={dismissButtonRef} type="button" onClick={() => void onDismiss()}>
            Got it
          </button>
        </footer>
      </section>
    </div>
  );
}

function parseReleaseNotes(value: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of value.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const listMatch = /^[-*]\s+(.+)$/u.exec(line);
    if (listMatch) {
      listItems.push(listMatch[1]);
      continue;
    }

    flushList();
    const headingMatch = /^#{1,6}\s+(.+)$/u.exec(line);
    blocks.push(
      headingMatch ? { type: "heading", text: headingMatch[1] } : { type: "paragraph", text: line }
    );
  }
  flushList();
  return blocks;
}

function renderReleaseNoteBlock(block: ReleaseNoteBlock, index: number): ReactNode {
  if (block.type === "heading") {
    return <h3 key={`heading-${index}`}>{renderInlineMarkdown(block.text)}</h3>;
  }
  if (block.type === "list") {
    return (
      <ul key={`list-${index}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
  }
  return <p key={`paragraph-${index}`}>{renderInlineMarkdown(block.text)}</p>;
}

function renderInlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/gu).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
}

function formatReleaseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
