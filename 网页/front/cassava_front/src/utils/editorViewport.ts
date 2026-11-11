import { workspaceStorageKey } from './workspaceContext';
export interface EditorView { zoom: number; x: number; y: number }
export function saveEditorView(view: EditorView) {
  try { sessionStorage.setItem(workspaceStorageKey('editor-view'), JSON.stringify(view)); } catch { /* Optional view memory. */ }
}
export function readEditorView(): EditorView | null {
  try {
    const view = JSON.parse(sessionStorage.getItem(workspaceStorageKey('editor-view')) || 'null');
    return view && Number.isFinite(view.zoom) && view.zoom >= .02 && view.zoom <= 4 && [view.x, view.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1) ? view : null;
  } catch { return null; }
}
