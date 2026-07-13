import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

type FindResult = {
  active: number;
  total: number;
};

type BrowserMatch = {
  range: Range;
  element: HTMLElement;
};

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

const ALL_HIGHLIGHT = "holoshelf-find-match";
const ACTIVE_HIGHLIGHT = "holoshelf-find-active";

function highlightApi(): { registry: HighlightRegistry; HighlightClass: HighlightConstructor } | null {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const HighlightClass = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
  return registry && HighlightClass ? { registry, HighlightClass } : null;
}

function clearBrowserHighlights(): void {
  const api = highlightApi();
  api?.registry.delete(ALL_HIGHLIGHT);
  api?.registry.delete(ACTIVE_HIGHLIGHT);
}

function visibleTextMatches(query: string): BrowserMatch[] {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery || !document.body) return [];

  const matches: BrowserMatch[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    const element = node.parentElement;
    if (
      element &&
      text.trim() &&
      !element.closest(".app-find-bar, script, style, noscript, textarea, [hidden], [aria-hidden='true']") &&
      element.getClientRects().length > 0
    ) {
      const normalizedText = text.toLocaleLowerCase();
      let offset = normalizedText.indexOf(normalizedQuery);
      while (offset >= 0) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + query.length);
        matches.push({ range, element });
        offset = normalizedText.indexOf(normalizedQuery, offset + Math.max(1, query.length));
      }
    }
    node = walker.nextNode();
  }
  return matches;
}

function applyBrowserHighlights(matches: BrowserMatch[], activeIndex: number): void {
  clearBrowserHighlights();
  const api = highlightApi();
  if (!api || matches.length === 0) return;

  api.registry.set(ALL_HIGHLIGHT, new api.HighlightClass(...matches.map((match) => match.range)));
  const activeMatch = matches[activeIndex];
  if (activeMatch) {
    api.registry.set(ACTIVE_HIGHLIGHT, new api.HighlightClass(activeMatch.range));
    activeMatch.element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  }
}

export function FindInPageBar() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const browserMatchesRef = useRef<BrowserMatch[]>([]);
  const browserActiveIndexRef = useRef(0);
  const latestNativeRequestIdRef = useRef(0);
  const mutationTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindResult>({ active: 0, total: 0 });
  const nativeFind = Boolean(window.holoshelf && !highlightApi());

  const runBrowserSearch = useCallback((text: string, preferredIndex = 0) => {
    const matches = visibleTextMatches(text);
    const activeIndex = matches.length === 0 ? 0 : Math.min(Math.max(preferredIndex, 0), matches.length - 1);
    browserMatchesRef.current = matches;
    browserActiveIndexRef.current = activeIndex;
    applyBrowserHighlights(matches, activeIndex);
    setResult({ active: matches.length === 0 ? 0 : activeIndex + 1, total: matches.length });
  }, []);

  const runNativeSearch = useCallback(async (text: string, forward = true, findNext = false) => {
    if (!text) return;
    const response = await api.invoke("app:find-in-page", { text, forward, findNext });
    latestNativeRequestIdRef.current = Math.max(latestNativeRequestIdRef.current, response.requestId);
  }, []);

  const clearSearch = useCallback(() => {
    browserMatchesRef.current = [];
    browserActiveIndexRef.current = 0;
    clearBrowserHighlights();
    setResult({ active: 0, total: 0 });
    if (nativeFind) {
      void api.invoke("app:find-in-page:stop", { action: "clearSelection" }).catch(() => undefined);
    }
  }, [nativeFind]);

  const close = useCallback(() => {
    clearSearch();
    setOpen(false);
  }, [clearSearch]);

  const move = useCallback(
    (forward: boolean) => {
      if (!query) return;
      if (nativeFind) {
        void runNativeSearch(query, forward, true).catch(() => undefined);
        return;
      }
      const matches = browserMatchesRef.current;
      if (matches.length === 0) return;
      const direction = forward ? 1 : -1;
      const nextIndex = (browserActiveIndexRef.current + direction + matches.length) % matches.length;
      browserActiveIndexRef.current = nextIndex;
      applyBrowserHighlights(matches, nextIndex);
      setResult({ active: nextIndex + 1, total: matches.length });
    },
    [nativeFind, query, runNativeSearch]
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
        window.requestAnimationFrame(() => inputRef.current?.select());
      } else if (open && event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (open && event.key === "F3") {
        event.preventDefault();
        move(!event.shiftKey);
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [close, move, open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!nativeFind) return;
    return api.onFindInPageResult((nextResult) => {
      if (nextResult.requestId < latestNativeRequestIdRef.current) return;
      latestNativeRequestIdRef.current = nextResult.requestId;
      setResult({ active: nextResult.activeMatchOrdinal, total: nextResult.matches });
    });
  }, [nativeFind]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (!query) {
        clearSearch();
      } else if (nativeFind) {
        void runNativeSearch(query).catch(() => setResult({ active: 0, total: 0 }));
      } else {
        runBrowserSearch(query);
      }
    }, 70);
    return () => window.clearTimeout(timer);
  }, [clearSearch, nativeFind, open, query, runBrowserSearch, runNativeSearch]);

  useEffect(() => {
    if (!open || !query || !document.body) return;
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.every((mutation) => {
          const targetElement =
            mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          return Boolean(targetElement?.closest(".app-find-bar"));
        })
      ) {
        return;
      }
      if (mutationTimerRef.current !== null) window.clearTimeout(mutationTimerRef.current);
      mutationTimerRef.current = window.setTimeout(() => {
        if (nativeFind) {
          void runNativeSearch(query).catch(() => undefined);
        } else {
          runBrowserSearch(query, browserActiveIndexRef.current);
        }
      }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (mutationTimerRef.current !== null) {
        window.clearTimeout(mutationTimerRef.current);
        mutationTimerRef.current = null;
      }
    };
  }, [nativeFind, open, query, runBrowserSearch, runNativeSearch]);

  useEffect(() => () => clearSearch(), [clearSearch]);

  if (!open) return null;

  return (
    <>
      <style>{`
        ::highlight(${ALL_HIGHLIGHT}) {
          color: inherit;
          background: rgba(255, 213, 86, 0.55);
        }

        ::highlight(${ACTIVE_HIGHLIGHT}) {
          color: #101318;
          background: #ffcf45;
        }
      `}</style>
      <div className="app-find-bar" role="search" aria-label="Find on page">
      <Search size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        aria-label="Find text"
        placeholder="Find"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            move(!event.shiftKey);
          }
        }}
      />
      <span className="app-find-count" aria-live="polite">
        {query ? `${result.active}/${result.total}` : "0/0"}
      </span>
      <button type="button" onClick={() => move(false)} aria-label="Previous match" title="Previous match" disabled={result.total === 0}>
        <ChevronUp size={14} />
      </button>
      <button type="button" onClick={() => move(true)} aria-label="Next match" title="Next match" disabled={result.total === 0}>
        <ChevronDown size={14} />
      </button>
      <button type="button" onClick={close} aria-label="Close find" title="Close find">
        <X size={14} />
      </button>
      </div>
    </>
  );
}
