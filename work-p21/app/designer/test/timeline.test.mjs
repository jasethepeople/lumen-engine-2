/**
 * @lumen/app-designer — timeline editor model tests.
 * Keyframe CRUD, easing assignment, segment CRUD, camera lanes, undo/redo + cap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TimelineEditor,
  UndoStack,
  createCameraTrackLanes,
  createTimelineDocument,
} from '@lumen/app-designer';

function makeEditor() {
  const doc = createTimelineDocument({
    id: 'hero.track',
    sceneId: 'hero',
    target: 'hero-video-plane',
    driver: 'scroll',
    range: [0, 8],
  });
  return new TimelineEditor(doc);
}

test('addKeyframe assigns ids, keeps keyframes sorted by t', () => {
  const ed = makeEditor();
  ed.addKeyframe({ t: 4, value: 0.5 });
  const first = ed.addKeyframe({ t: 0, value: 0 });
  ed.addKeyframe({ t: 8, value: 1 });
  assert.deepEqual(ed.doc.keyframes.map((k) => k.t), [0, 4, 8]);
  assert.equal(first.id, ed.doc.keyframes[0].id);
});

test('addKeyframe rejects duplicate ids and invalid easings', () => {
  const ed = makeEditor();
  const k = ed.addKeyframe({ t: 0, value: 0 });
  assert.throws(() => ed.addKeyframe({ id: k.id, t: 1, value: 1 }), /duplicate/);
  assert.throws(() => ed.addKeyframe({ t: 2, value: 1, easingBezier: [2, 0, 0, 1] }), /invalid/);
  assert.throws(() => ed.addKeyframe({ t: 2, value: 1, easing: 'bounce' }), /invalid/);
});

test('moveKeyframe retimes and revalues; removeKeyframe deletes', () => {
  const ed = makeEditor();
  const a = ed.addKeyframe({ t: 0, value: 0 });
  const b = ed.addKeyframe({ t: 2, value: 10 });
  assert.equal(ed.moveKeyframe(b.id, 1, 20), true);
  assert.equal(ed.doc.keyframes[1].t, 1);
  assert.equal(ed.doc.keyframes[1].value, 20);
  assert.equal(ed.moveKeyframe('nope', 0), false);
  assert.equal(ed.removeKeyframe(a.id), true);
  assert.equal(ed.doc.keyframes.length, 1);
  assert.equal(ed.removeKeyframe(a.id), false);
});

test('setEasing writes named easing or bezier control points (bezier wins)', () => {
  const ed = makeEditor();
  const a = ed.addKeyframe({ t: 0, value: 0 });
  ed.addKeyframe({ t: 1, value: 1 });
  ed.setEasing(a.id, 'ease-in-out');
  assert.equal(ed.doc.keyframes[0].easing, 'ease-in-out');
  ed.setEasing(a.id, [0.65, 0, 0.35, 1]);
  assert.deepEqual(ed.doc.keyframes[0].easingBezier, [0.65, 0, 0.35, 1]);
  assert.equal(ed.doc.keyframes[0].easing, undefined);
  ed.setEasing(a.id, undefined);
  assert.equal(ed.doc.keyframes[0].easingBezier, undefined);
  assert.equal(ed.setEasing('nope', 'linear'), false);
  assert.throws(() => ed.setEasing(a.id, [0, 0, 2, 1]), /invalid/);
});

test('segment CRUD mirrors the engine TrackSegment shape', () => {
  const ed = makeEditor();
  ed.addSegment({ id: 'seg-1', from: 2, to: 4, keys: [{ t: 0, value: 0 }, { t: 1, value: 1, easing: 'linear' }] });
  assert.equal(ed.doc.segments.length, 1);
  assert.throws(() => ed.addSegment({ id: 'seg-1', from: 0, to: 1, keys: [] }), /duplicate/);
  assert.equal(ed.moveSegment('seg-1', 3, 5), true);
  assert.deepEqual([ed.doc.segments[0].from, ed.doc.segments[0].to], [3, 5]);
  assert.equal(ed.setSegmentKeys('seg-1', [{ t: 0.5, value: 42 }]), true);
  assert.equal(ed.doc.segments[0].keys[0].value, 42);
  assert.equal(ed.moveSegment('nope', 0, 1), false);
  assert.equal(ed.removeSegment('seg-1'), true);
  assert.equal(ed.doc.segments.length, 0);
});

test('camera track lanes: position + zoom documents for one camera node', () => {
  const lanes = createCameraTrackLanes('cam-1', { sceneId: 'intro', driver: 'time', range: [0, 6] });
  assert.equal(lanes.position.id, 'cam-1.position');
  assert.equal(lanes.zoom.id, 'cam-1.zoom');
  assert.equal(lanes.position.target, 'cam-1');
  const edPos = new TimelineEditor(lanes.position);
  const edZoom = new TimelineEditor(lanes.zoom);
  edPos.addKeyframe({ t: 0, value: [0, 0, 0] });
  edPos.addKeyframe({ t: 6, value: [10, 2, 0], easing: 'ease-in-out' });
  edZoom.addKeyframe({ t: 0, value: 1 });
  edZoom.addKeyframe({ t: 6, value: 2.5 });
  assert.equal(edPos.doc.keyframes.length, 2);
  assert.equal(edZoom.doc.keyframes.length, 2);
});

test('undo/redo restores document snapshots across mixed operations', () => {
  const ed = makeEditor();
  const a = ed.addKeyframe({ t: 0, value: 0 });
  ed.addKeyframe({ t: 8, value: 1, easing: 'ease-out' });
  ed.addSegment({ id: 's1', from: 2, to: 3, keys: [{ t: 0, value: 5 }] });
  assert.equal(ed.undoOnce(), true); // remove segment
  assert.equal(ed.doc.segments.length, 0);
  assert.equal(ed.undoOnce(), true); // remove 2nd keyframe
  assert.equal(ed.doc.keyframes.length, 1);
  assert.equal(ed.redoOnce(), true); // re-add 2nd keyframe
  assert.equal(ed.doc.keyframes.length, 2);
  assert.equal(ed.doc.keyframes[1].easing, 'ease-out');
  assert.equal(ed.redoOnce(), true); // re-add segment
  assert.equal(ed.doc.segments[0].id, 's1');
  // undo everything
  while (ed.undoOnce()) { /* drain */ }
  assert.equal(ed.doc.keyframes.length, 0);
  assert.equal(ed.undoOnce(), false);
  // redo everything
  while (ed.redoOnce()) { /* drain */ }
  assert.equal(ed.doc.keyframes.length, 2);
  assert.equal(ed.doc.keyframes[0].id, a.id);
});

test('a new edit clears the redo lane', () => {
  const ed = makeEditor();
  ed.addKeyframe({ t: 0, value: 0 });
  ed.addKeyframe({ t: 1, value: 1 });
  ed.undoOnce();
  ed.addKeyframe({ t: 2, value: 2 });
  assert.equal(ed.redoOnce(), false);
  assert.deepEqual(ed.doc.keyframes.map((k) => k.t), [0, 2]);
});

test('undo stack caps at 100 entries', () => {
  const stack = new UndoStack();
  for (let i = 0; i < 150; i++) stack.push({ n: i });
  assert.equal(stack.undoDepth, 100);
  // oldest entries dropped: draining reaches n=50 (150 - 100)
  let last;
  let cur = { n: 999 };
  while ((last = stack.undo(cur)) !== undefined) cur = last;
  assert.equal(cur.n, 50);
});

test('smoothing and motion mode setters are undoable', () => {
  const ed = makeEditor();
  ed.setSmoothing({ mode: 'spring', stiffness: 0.4, damping: 0.8 });
  ed.setMotionMode('reveal');
  assert.equal(ed.doc.smoothing.mode, 'spring');
  assert.equal(ed.doc.motion, 'reveal');
  ed.undoOnce();
  assert.equal(ed.doc.motion, undefined);
  ed.undoOnce();
  assert.equal(ed.doc.smoothing, undefined);
});
