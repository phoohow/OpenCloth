import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '@/store';

beforeEach(() => {
  useUIStore.setState({ activeTool: 'select', focus: '3d' });
});

describe('toggleTool', () => {
  it('arms a 3D tool and focuses its pane', () => {
    useUIStore.getState().toggleTool('pin');
    expect(useUIStore.getState().activeTool).toBe('pin');
    expect(useUIStore.getState().focus).toBe('3d');
  });

  it('releases the armed tool on a second pick without losing the pane focus', () => {
    useUIStore.getState().toggleTool('pin');
    useUIStore.getState().toggleTool('pin');
    expect(useUIStore.getState().activeTool).toBe('select');
    expect(useUIStore.getState().focus).toBe('3d');
  });

  it('swapping tools arms the new one instead of releasing', () => {
    useUIStore.getState().toggleTool('pin');
    useUIStore.getState().toggleTool('measure3d');
    expect(useUIStore.getState().activeTool).toBe('measure3d');
  });

  it('leaves setTool as a plain arm for the 2D toolbar', () => {
    useUIStore.getState().setTool('line');
    useUIStore.getState().setTool('line');
    expect(useUIStore.getState().activeTool).toBe('line');
    expect(useUIStore.getState().focus).toBe('2d');
  });
});
