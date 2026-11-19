// A right click's menu: a short list of deeds next to the pointer, kept inside the window. Esc, a press elsewhere
// or a deed closes it; arrow keys move between the lines. Rendered from App.tsx, outside the middle column.
import { Icon } from '@lonca/ui';
import { motion } from 'motion/react';
import { type KeyboardEvent, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type ContextMenu, type MenuItem, useApp } from '../store';

const GAP = 8;

/** Where a menu opens for a right click: at the pointer, or under the element when a key opened it. */
export function menuAt(e: MouseEvent<HTMLElement>): { x: number; y: number } {
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + 16, y: r.bottom };
}

/** Opens a context menu for a right click. */
export function openMenu(e: MouseEvent<HTMLElement>, label: string, items: MenuItem[]): void {
  e.preventDefault();
  useApp.setState({ menu: { ...menuAt(e), label, items }, profileCard: undefined });
}

export function ContextMenuView({ menu }: { menu: ContextMenu }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const close = () => useApp.setState({ menu: undefined });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const left = Math.max(GAP, Math.min(menu.x, window.innerWidth - el.offsetWidth - GAP));
    const top = Math.max(GAP, Math.min(menu.y, window.innerHeight - el.offsetHeight - GAP));
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    const shut = () => useApp.setState({ menu: undefined });
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && shut();
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return;
      shut();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', shut);
    window.addEventListener('resize', shut);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', shut);
      window.removeEventListener('resize', shut);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const lines = [...(box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (lines.length === 0) return;
    const at = lines.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? lines.length - 1
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + lines.length) % lines.length;
    lines[next]?.focus();
  };

  return (
    <motion.div
      ref={box}
      className="cmenu"
      role="menu"
      aria-label={menu.label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      initial={{ opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 620, damping: 38 } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
    >
      {menu.items.map((item, i) =>
        'rule' in item ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never move while the menu is open
          <hr key={`rule-${i}`} className="cmenu__rule" />
        ) : 'heading' in item ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never move while the menu is open
          <div key={`heading-${i}`} className="cmenu__heading" role="presentation">
            {item.heading}
          </div>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never move while the menu is open
          <Line key={`item-${i}`} item={item} onDone={close} />
        ),
      )}
    </motion.div>
  );
}

function Line({ item, onDone }: { item: Extract<MenuItem, { run: () => void }>; onDone: () => void }) {
  const icon = item.checked ? 'check' : item.icon;
  const inner = (
    <>
      <span className="cmenu__icon" aria-hidden="true">
        {icon && <Icon name={icon} size={14} />}
      </span>
      <span className="grow">{item.label}</span>
    </>
  );
  const props = {
    type: 'button' as const,
    className: `cmenu__item ${item.danger ? 'is-danger' : ''}`,
    onClick: () => {
      onDone();
      item.run();
    },
  };
  return item.checked === undefined ? (
    <button role="menuitem" {...props}>
      {inner}
    </button>
  ) : (
    <button role="menuitemradio" aria-checked={item.checked} {...props}>
      {inner}
    </button>
  );
}
