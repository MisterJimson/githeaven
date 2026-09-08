import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { startSpan } from "./performance";
import { startForegroundTiming } from "./timing";
import { FileCode2, Search } from "lucide-react";

import {
  buildQuickIndex,
  searchQuickIndex,
  type QuickItem,
} from "./quickSearch";
export { fuzzyScore, type QuickItem } from "./quickSearch";

const rowHeight = 44;
const viewportHeight = 352;

export function QuickOpen({
  mode,
  items,
  onClose,
  onPick,
  onReady,
}: {
  mode: "commands" | "files";
  items: QuickItem[];
  onClose: () => void;
  onPick: (item: QuickItem) => void;
  onReady?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const queryTiming = useRef<(() => number | null) | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [top, setTop] = useState(0);
  const index = useMemo(() => {
    const finish = startSpan("search.index");
    const result = buildQuickIndex(items);
    finish();
    return result;
  }, [items]);
  const results = useMemo(() => {
    const finish = startSpan("search.rank");
    const result = searchQuickIndex(index, query, mode);
    finish();
    return result;
  }, [index, query, mode]);
  const selected = Math.min(active, Math.max(0, results.length - 1));
  const start = Math.max(0, Math.floor(top / rowHeight) - 3);
  const end = Math.min(results.length, start + 16);

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = dialog.current!;
    modal.showModal();
    input.current?.focus();
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => ready.current?.());
    });
    return () => {
      cancelAnimationFrame(frame);
      modal.close();
      previous?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const finish = queryTiming.current;
    if (!finish) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (queryTiming.current === finish) {
          finish();
          queryTiming.current = null;
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [results, query]);

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
              queryTiming.current = startForegroundTiming("ui.palette-query");
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
