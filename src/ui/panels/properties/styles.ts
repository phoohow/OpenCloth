/** Styles for the properties-editor frame, its tab rail and the note rows inside the tabs. */
export const styles: Record<string, React.CSSProperties> = {
  editor: { display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' },
  body: { flex: 1, minWidth: 0, overflowY: 'auto', padding: '6px 6px 10px' },
  objectName: {
    fontSize: 'var(--oc-fs-micro)', color: '#4da6ff', padding: '2px 4px 6px', borderBottom: '1px solid #333', marginBottom: 7,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  note: { fontSize: 'var(--oc-fs-note)', color: '#777', lineHeight: 1.5, margin: '5px 2px 1px' },
  action: {
    alignSelf: 'flex-start', margin: '2px', padding: '3px 10px', background: '#2a2a30',
    border: '1px solid #4a4a54', borderRadius: 3, color: '#ddd', cursor: 'pointer',
    fontSize: 'var(--oc-fs-micro)',
  },
  rail: {
    flex: '0 0 auto', width: 30, display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', justifyContent: 'center', gap: 2, padding: '0 3px',
    background: '#26262b', borderRight: '1px solid #333',
  },
  tab: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26,
    background: 'transparent', border: '1px solid transparent', borderLeft: '2px solid transparent',
    borderRadius: 3, color: '#ccc', cursor: 'pointer', fontSize: 12,
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  },
  tabActive: {
    background: '#2a4a6a', border: '1px solid #3d6f9e', borderLeft: '2px solid #4da6ff',
  },
  tabDisabled: { opacity: 0.3, cursor: 'default' },
};
