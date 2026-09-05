import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Search } from "lucide-react";

export interface QuickItem {
  id: string;
  label: string;
  detail?: string;
  kind: "command" | "file" | "branch" | "commit" | "worktree" | "index";
  value: string;
}

// Consecutive characters, filename matches and word boundaries rank highest.
export function fuzzyScore(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return 0;
  let cursor = 0,
    previous = -2,
    score = 0;
  const basename = haystack.lastIndexOf("/") + 1;
  for (const char of needle) {
    const index = haystack.indexOf(char, cursor);
    if (index < 0) return -Infinity;
    score += 10 + (index === previous + 1 ? 16 : 0);
    if (index === 0 || /[\s/._-]/.test(haystack[index - 1])) score += 14;
    if (index >= basename) score += 4;
    score -= (index - cursor) * 0.15;
    previous = index;
    cursor = index + 1;
  }
  return score - text.length * 0.01;
}

const rowHeight = 44;
const viewportHeight = 352;

export function QuickOpen({
  mode,
  items,
  onClose,
  onPick,
}: {
  mode: "commands" | "files";
  items: QuickItem[];
  onClose: () => void;
  onPick: (item: QuickItem) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [top, setTop] = useState(0);
  const results = useMemo(() => {
    const priority = (item: QuickItem) =>
      mode === "commands" && item.kind === "command" ? 0 : 1;
    if (!query.trim())
      return [...items].sort((a, b) => priority(a) - priority(b));
    return items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(item.label, query),
          fuzzyScore(
            item.kind === "file"
              ? (item.detail ?? item.label)
              : `${item.detail ?? ""} ${item.label}`,
            query,
          ) - 8,
        ),
      }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => priority(a.item) - priority(b.item) || b.score - a.score)
      .map(({ item }) => item);
  }, [items, query, mode]);
  const selected = Math.min(active, Math.max(0, results.length - 1));
  const start = Math.max(0, Math.floor(top / rowHeight) - 3);
  const end = Math.min(results.length, start + 16);

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = dialog.current!;
    modal.showModal();
    input.current?.focus();
    return () => {
      modal.close();
      previous?.focus();
    };
  }, []);

  function move(next: number) {
    next = Math.max(0, Math.min(results.length - 1, next));
    setActive(next);
    const list = scroll.current;
    if (!list) return;
    if (next * rowHeight < list.scrollTop) list.scrollTop = next * rowHeight;
    else if ((next + 1) * rowHeight > list.scrollTop + viewportHeight)
      list.scrollTop = (next + 1) * rowHeight - viewportHeight;
    setTop(list.scrollTop);
  }
  function pick(item: QuickItem) {
    dialog.current?.close();
    onClose();
    onPick(item);
  }
  return (
    <dialog
      ref={dialog}
      className="quick-open"
      aria-label={mode === "files" ? "Go to file" : "Command palette"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="quick-open-content">
        <div className="quick-open-input">
          {mode === "files" ? <FileCode2 size={18} /> : <Search size={18} />}
          <input
            ref={input}
            role="combobox"
            aria-label={
              mode === "files" ? "Find file" : "Find command or destination"
            }
            aria-expanded="true"
            aria-controls="quick-results"
            aria-autocomplete="list"
            aria-activedescendant={
              results[selected] && selected >= start && selected < end
                ? `quick-result-${selected}`
                : undefined
            }
            placeholder={
              mode === "files"
                ? "Search files by name or path…"
                : "Search commands, branches, commits, files…"
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setTop(0);
              if (scroll.current) scroll.current.scrollTop = 0;
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                move(selected + (event.key === "ArrowDown" ? 1 : -1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (results[selected]) pick(results[selected]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div
          ref={scroll}
          id="quick-results"
          role="listbox"
          aria-label="Results"
          className="quick-results"
          onScroll={(event) => setTop(event.currentTarget.scrollTop)}
        >
          {results.length ? (
            <div
              style={{
                height: results.length * rowHeight,
                position: "relative",
              }}
            >
              {results.slice(start, end).map((item, offset) => {
                const index = start + offset;
                return (
                  <div
                    key={item.id}
                    id={`quick-result-${index}`}
                    role="option"
                    aria-selected={selected === index}
                    className="quick-result"
                    style={{
                      position: "absolute",
                      top: index * rowHeight,
                      height: rowHeight,
                    }}
                    onMouseMove={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(item)}
                  >
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <small className="quick-result-kind">
                      {item.kind === "file"
                        ? "File"
                        : item.kind === "command"
                          ? "Command"
                          : item.kind === "worktree"
                            ? "Unstaged"
                            : item.kind === "index"
                              ? "Staged"
                              : item.kind === "branch"
                                ? "Branch / tag"
                                : "Commit"}
                    </small>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="quick-empty">
              {items.length
                ? "No matches"
                : "Open a repository to browse files"}
            </div>
          )}
        </div>
        <div className="quick-open-footer">
          <span>↑ ↓ to navigate</span>
          <span>↵ to open</span>
          <span>{mode === "files" ? "⌘K commands" : "⌘P files"}</span>
        </div>
      </div>
    </dialog>
  );
}
