import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMenuStore } from './menu/menuStore';
import { buildMenus, type MenuState } from './menu/menuModel';
import type { MenuActions } from './menu/actions';
import type { MenuEntry, TopMenu } from './menu/menuTypes';
import {
  CLOSED_NAV, activeLeaf, menuByMnemonic, reduceMenuNav, type MenuNavState, type MenuNavStep,
} from './menu/nav';
import { MenuDialogs } from './menu/menuDialogs';
import { formatClockTime } from './timeFormat';
import { Icon } from './icons';
import { useProjectStore, useUIStore } from '../store/stores';

/** Top menu bar: dropdowns, submenus, check marks, shortcut column and keyboard navigation. */
export function Menubar({ actions }: { actions: MenuActions }) {
  const nav = useMenuStore(s => s.nav);
  const setNav = useMenuStore(s => s.setNav);
  const closeMenus = useMenuStore(s => s.closeMenus);
  const barRef = useRef<HTMLDivElement>(null);

  const project = useProjectStore(s => s.project);
  const recent = useProjectStore(s => s.recent);
  const autosaves = useProjectStore(s => s.autosaves);
  const clipboard = useProjectStore(s => s.clipboard);
  const history = useProjectStore(s => s.history);
  const layout = useUIStore(s => s.layout);
  const focus = useUIStore(s => s.focus);
  const propTab = useUIStore(s => s.propTab);
  const selection = useUIStore(s => s.selection);
  const showTemplatePanel = useUIStore(s => s.showTemplatePanel);
  const showScenePanel = useUIStore(s => s.showScenePanel);
  const showPropertiesPanel = useUIStore(s => s.showPropertiesPanel);
  const showTimeline = useUIStore(s => s.showTimeline);
  const autoSaveSeconds = useUIStore(s => s.autoSaveSeconds);
  const lastAutosaveAt = useUIStore(s => s.lastAutosaveAt);

  const menus = useMemo(() => {
    const state: MenuState = {
      projectName: project.meta.name,
      layout,
      focus,
      propTab,
      showTemplatePanel,
      showScenePanel,
      showPropertiesPanel,
      showTimeline,
      autoSaveSeconds,
      lastAutosaveAt,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.lastLabel,
      redoLabel: history.nextLabel,
      hasClipboard: clipboard !== null,
      selectedPanelCount: selection.filter(id => !!project.pattern.panels[id]).length,
      selectionCount: selection.length,
      panelCount: Object.keys(project.pattern.panels).length,
      referenceCount: (project.scene.referenceObjects ?? []).length,
      recent,
      autosaves,
    };
    return buildMenus(state, actions);
  }, [project, recent, autosaves, clipboard, history, layout, focus, propTab, selection,
    showTemplatePanel, showScenePanel, showPropertiesPanel, showTimeline,
    autoSaveSeconds, lastAutosaveAt, actions]);

  // A click anywhere outside the bar closes the open dropdown.
  useEffect(() => {
    if (nav.open === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) closeMenus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [nav.open, closeMenus]);

  // Arrows, Enter and Esc reach the bar before the app-wide shortcut handler.
  useEffect(() => {
    if (nav.open === null) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step = stepFor(e.key, nav);
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      if (step === 'run') {
        const leaf = activeLeaf(menus, nav);
        if (!leaf || leaf.disabled) return;
        if (leaf.children?.length) setNav(reduceMenuNav(nav, menus, { type: 'intoSub' }));
        else {
          leaf.run?.();
          closeMenus();
        }
        return;
      }
      if (step.type === 'intoSub' && !activeLeaf(menus, nav)?.children?.length) return;
      if (step.type === 'cycleMenu' && nav.sub !== null) return;
      setNav(reduceMenuNav(nav, menus, step));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [nav, menus, setNav, closeMenus]);

  // Alt plus the mnemonic letter toggles that dropdown.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const index = menuByMnemonic(menus, e.key);
      if (index === null) return;
      e.preventDefault();
      e.stopPropagation();
      const alreadyOpen = nav.open === index && nav.sub === null;
      setNav(alreadyOpen ? CLOSED_NAV : reduceMenuNav(CLOSED_NAV, menus, { type: 'openMenu', index }));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [menus, nav.open, nav.sub, setNav]);

  const openAt = (index: number) => setNav(reduceMenuNav(CLOSED_NAV, menus, { type: 'openMenu', index }));

  return (
    <>
      <div ref={barRef} style={styles.bar}>
        <div style={styles.logo}>OpenCloth</div>
        {menus.map((menu, index) => {
          const open = nav.open === index;
          return (
            <div
              key={menu.id}
              style={{ ...styles.menu, ...(open ? styles.menuOpen : null) }}
              onPointerEnter={() => { if (nav.open !== null && !open) openAt(index); }}
              onClick={() => (open ? closeMenus() : openAt(index))}
            >
              <span style={{ ...styles.menuLabel, ...(open ? styles.menuLabelActive : null) }} title={`Alt+${menu.mnemonic}`}>
                {menu.label}
              </span>
              {open && (
                <div style={styles.dropdown} onClick={e => e.stopPropagation()}>
                  {renderEntries(menu.entries, nav, 0, setNav, closeMenus, menus)}
                </div>
              )}
            </div>
          );
        })}

        <div style={styles.projectName}>{project.meta.name}</div>

        <div style={styles.spacer} />
        <div style={styles.status}>
          {autoSaveSeconds > 0
            ? `自动保存 ${autoSaveSeconds}s${lastAutosaveAt ? ` · ${formatClockTime(lastAutosaveAt)}` : ''}`
            : '自动保存 关闭'}
        </div>
      </div>
      <MenuDialogs />
    </>
  );
}

/** Key to navigation step; Enter is handled as its own signal. */
function stepFor(key: string, nav: MenuNavState): MenuNavStep | 'run' | null {
  if (nav.open === null) return null;
  switch (key) {
    case 'ArrowDown': return { type: 'step', delta: 1 };
    case 'ArrowUp': return { type: 'step', delta: -1 };
    case 'ArrowRight': return { type: 'intoSub' };
    case 'ArrowLeft': return nav.sub === null ? { type: 'cycleMenu', delta: -1 } : { type: 'outOfSub' };
    case 'Enter': case ' ': return 'run';
    case 'Escape': return nav.sub === null ? { type: 'close' } : { type: 'outOfSub' };
    default: return null;
  }
}

/** Rows of one dropdown or submenu, with hover-driven navigation. */
function renderEntries(
  entries: MenuEntry[],
  nav: MenuNavState,
  depth: 0 | 1,
  setNav: (nav: MenuNavState) => void,
  closeMenus: () => void,
  menus: TopMenu[],
): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === 'sep') {
      rows.push(<div key={`sep-${depth}-${index}`} style={styles.sep} />);
      return;
    }
    const hasChildren = !!entry.children?.length;
    const hovered = depth === 0
      ? (nav.sub === null ? nav.active === index : nav.sub === index)
      : nav.active === index;
    const expanded = depth === 0 && hasChildren && nav.sub === index;
    rows.push(
      <div
        key={entry.id}
        style={{
          ...styles.item,
          ...(entry.disabled ? styles.itemDisabled : null),
          ...(hovered && !entry.disabled ? styles.itemHover : null),
        }}
        onPointerEnter={() => {
          if (depth === 1) {
            setNav(reduceMenuNav(nav, menus, { type: 'hoverSub', index }));
            return;
          }
          setNav(reduceMenuNav(nav, menus, hasChildren
            ? { type: 'hoverParent', index }
            : { type: 'hoverRoot', index }));
        }}
        onClick={() => {
          if (entry.disabled) return;
          if (hasChildren && depth === 0) {
            setNav(reduceMenuNav(nav, menus, { type: 'intoSub' }));
            return;
          }
          entry.run?.();
          closeMenus();
        }}
      >
        <span style={styles.gutter}>{entry.checked && <Icon name="check" size={11} />}</span>
        <span style={styles.label}>{entry.label}</span>
        {entry.accel && <span style={styles.accel}>{entry.accel}</span>}
        {hasChildren && <Icon name="chevron-right" size={11} style={styles.caret} />}
        {expanded && (
          <Submenu
            entries={entry.children ?? []}
            nav={nav}
            setNav={setNav}
            closeMenus={closeMenus}
            menus={menus}
          />
        )}
      </div>,
    );
  });
  return rows;
}

interface SubmenuProps {
  entries: MenuEntry[];
  nav: MenuNavState;
  setNav: (nav: MenuNavState) => void;
  closeMenus: () => void;
  menus: TopMenu[];
}

/** Child list opened beside its parent row; moves to the left when the screen edge is close. */
function Submenu({ entries, nav, setNav, closeMenus, menus }: SubmenuProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current?.getBoundingClientRect();
    if (box && box.right > window.innerWidth - 8) setFlip(true);
  }, []);

  return (
    <div
      ref={boxRef}
      style={{ ...styles.submenu, ...(flip ? styles.submenuFlipped : null) }}
      onClick={e => e.stopPropagation()}
    >
      {renderEntries(entries, nav, 1, setNav, closeMenus, menus)}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 40, background: '#1a1a1e', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 2, position: 'relative' },
  logo: { fontWeight: 700, fontSize: 16, color: '#4da6ff', marginRight: 16, letterSpacing: 1 },
  menu: { position: 'relative', cursor: 'pointer', padding: '5px 10px', borderRadius: 4 },
  menuOpen: { background: '#2a4a6a' },
  menuLabel: { fontSize: 13, color: '#ccc' },
  menuLabelActive: { color: '#fff' },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#2a2a30',
    border: '1px solid #3a3a42', borderRadius: 4, minWidth: 250, zIndex: 1000,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', padding: '4px 0',
  },
  submenu: {
    position: 'absolute', top: -5, left: '100%', marginLeft: 6, background: '#2a2a30',
    border: '1px solid #3a3a42', borderRadius: 4, minWidth: 210, zIndex: 1001,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', padding: '4px 0',
  },
  submenuFlipped: { left: 'auto', right: '100%', marginLeft: 0, marginRight: 6 },
  item: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px 7px 8px', fontSize: 13,
    color: '#ccc', cursor: 'pointer', position: 'relative', whiteSpace: 'nowrap',
  },
  itemHover: { background: '#2a4a6a', color: '#fff' },
  itemDisabled: { color: '#5d5d66', cursor: 'default' },
  gutter: { width: 12, height: 12, flex: '0 0 auto', display: 'flex', alignItems: 'center', color: '#4da6ff' },
  label: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' },
  accel: { color: '#7d7d88', fontSize: 12, marginLeft: 18 },
  caret: { color: '#888', flex: '0 0 auto' },
  sep: { height: 1, background: '#3a3a42', margin: '4px 8px' },
  spacer: { flex: 1 },
  status: { fontSize: 11, color: '#777', marginRight: 14 },
  projectName: {
    position: 'absolute', left: '50%', top: 0, bottom: 0, transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', maxWidth: '34%', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none',
    fontSize: 12, color: '#888',
  },
};
