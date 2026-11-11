import { beforeEach, describe, expect, it } from 'vitest';
import { readEditorView, saveEditorView } from './editorViewport';
import { setWorkspaceUser } from './workspaceContext';
beforeEach(() => sessionStorage.clear());
describe('review view memory', () => {
  it('remembers the normalized image center for continuous review', () => {
    saveEditorView({ zoom: .58, x: .3, y: .4 }); expect(readEditorView()).toEqual({ zoom: .58, x: .3, y: .4 });
  });
  it('isolates accounts and rejects invalid viewport values', () => {
    setWorkspaceUser('a'); saveEditorView({ zoom: .5, x: .2, y: .2 });
    setWorkspaceUser('b'); expect(readEditorView()).toBeNull();
    saveEditorView({ zoom: 100, x: .2, y: .2 }); expect(readEditorView()).toBeNull();
    setWorkspaceUser();
  });
});
