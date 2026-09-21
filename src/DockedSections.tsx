import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown } from "lucide-react";

type Item = { key: string };
export interface DockGroup<T> {
  key: string;
  title: string;
  count: number;
  items: T[];
}
const storageKey = "githeaven.sidebar-section-heights";
function initialWeights(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1]) &&
          entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}
function SectionList<T extends Item>({
  group,
  renderItem,
  selectedKey,
}: {
  group: DockGroup<T>;
  renderItem: (item: T) => ReactNode;
  selectedKey?: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: group.items.length,
    getScrollElement: () => scroll.current,
    getItemKey: (i) => group.items[i].key,
    estimateSize: () => 22,
    overscan: 4,
    initialRect: { width: 223, height: 220 },
  });
  useEffect(() => {
    const index = group.items.findIndex((item) => item.key === selectedKey);
    if (index >= 0) virtual.scrollToIndex(index, { align: "auto" });
  }, [selectedKey, group.items, virtual]);
  return (
    <div className="dock-list" ref={scroll} aria-label={`${group.title} list`}>
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((item) => (
          <div
            key={item.key}
            style={{
              position: "absolute",
              top: item.start,
              height: item.size,
              width: "100%",
            }}
          >
            {renderItem(group.items[item.index])}
          </div>
        ))}
      </div>
    </div>
  );
}
export function DockedSections<T extends Item>({
  groups,
  collapsed,
  onToggle,
  renderItem,
  selectedKey,
}: {
  groups: DockGroup<T>[];
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  renderItem: (item: T) => ReactNode;
  selectedKey?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [weights, setWeights] = useState(initialWeights);
  const weight = (key: string) => weights[key] ?? 1;
  const flexible = groups.filter((g) => !collapsed[g.key] && g.count > 0);
  const resize = (
    a: string,
    b: string,
    delta: number,
    heights: number[],
    original: Record<string, number>,
  ) => {
    const total = heights[0] + heights[1];
    if (total <= 96) return;
    const first = Math.max(48, Math.min(total - 48, heights[0] + delta));
    const sum = (original[a] ?? 1) + (original[b] ?? 1);
    const next = {
      ...original,
      [a]: (sum * first) / total,
      [b]: (sum * (total - first)) / total,
    };
    setWeights(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };
  return (
    <div className="branch-docks" ref={root} aria-label="Branches and tags">
      {groups.map((group) => {
        const index = flexible.findIndex((g) => g.key === group.key);
        const next = index >= 0 ? flexible[index + 1] : undefined;
        const heights = () =>
          [group.key, next!.key].map(
            (key) =>
              root.current
                ?.querySelector<HTMLElement>(`[data-section="${key}"]`)
                ?.getBoundingClientRect().height ?? 0,
          );
        return (
          <Fragment key={group.key}>
            <section
              data-section={group.key}
              className="branch-dock"
              style={{
                flex:
                  collapsed[group.key] || !group.count
                    ? "0 0 auto"
                    : `${weight(group.key)} 1 0px`,
                minHeight: collapsed[group.key] ? 26 : 48,
              }}
            >
              <button
                className="section-label branch-group"
                aria-expanded={!collapsed[group.key]}
                onClick={() => onToggle(group.key)}
              >
                <span>
                  <ChevronDown
                    size={11}
                    style={{
                      transform: collapsed[group.key]
                        ? "rotate(-90deg)"
                        : undefined,
                    }}
                  />
                  {group.title}
                </span>
                <span>{group.count}</span>
              </button>
              {!collapsed[group.key] && (
                <SectionList
                  group={group}
                  renderItem={renderItem}
                  selectedKey={selectedKey}
                />
              )}
            </section>
            {next && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize ${group.title} and ${next.title}`}
                tabIndex={0}
                className="dock-resizer"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    return;
                  event.preventDefault();
                  resize(
                    group.key,
                    next.key,
                    event.key === "ArrowDown" ? 20 : -20,
                    heights(),
                    weights,
                  );
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  const target = event.currentTarget;
                  const start = event.clientY,
                    sizes = heights(),
                    original = weights;
                  target.setPointerCapture(event.pointerId);
                  const move = (e: PointerEvent) =>
                    resize(
                      group.key,
                      next.key,
                      e.clientY - start,
                      sizes,
                      original,
                    );
                  const stop = () => {
                    target.removeEventListener("pointermove", move);
                    target.removeEventListener("lostpointercapture", stop);
                  };
                  target.addEventListener("pointermove", move);
                  target.addEventListener("lostpointercapture", stop);
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
