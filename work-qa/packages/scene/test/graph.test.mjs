import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SceneGraph } from '../dist/graph.js';

function node(id, children = [], overrides = {}) {
  return {
    id,
    kind: 'group',
    transform: { position: [0, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] },
    layer: 0,
    visible: true,
    bindings: [],
    children,
    ...overrides,
  };
}

function buildTree() {
  const child = node('child', [], { transform: { position: [0, 2, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] } });
  const grand = node('grand', [], { transform: { position: [0, 0, 5], rotationQuat: [0, 0, 0, 1], scale: [2, 2, 2] } });
  child.children.push(grand);
  const root = node('root', [child], { transform: { position: [10, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] } });
  return { root, child, grand };
}

test('builds hierarchy, find/traverse/parents', () => {
  const { root } = buildTree();
  const g = new SceneGraph([root]);
  assert.equal(g.size, 3);
  assert.equal(g.find('child')?.id, 'child');
  assert.equal(g.parentIdOf('grand'), 'child');
  assert.deepEqual(g.ids(), ['root', 'child', 'grand']);
  const depths = [];
  g.traverse((n, d) => depths.push(`${n.id}:${d}`));
  assert.deepEqual(depths, ['root:0', 'child:1', 'grand:2']);
});

test('world transforms compose parent scale/rotation/position', () => {
  const { root } = buildTree();
  const g = new SceneGraph([root]);
  g.recomputeAll();
  assert.deepEqual(g.getWorldTransform('root').position, [10, 0, 0]);
  assert.deepEqual(g.getWorldTransform('child').position, [10, 2, 0]);
  // grand: scale 2 inherited, position [0,0,5] unaffected by scale above it.
  assert.deepEqual(g.getWorldTransform('grand').position, [10, 2, 5]);
  assert.deepEqual(g.getWorldTransform('grand').scale, [2, 2, 2]);
});

test('dirty flags: only dirty subtrees recompute', () => {
  const { root } = buildTree();
  const sibling = node('sibling', [node('sib-child')]);
  const g = new SceneGraph([root, sibling]);
  assert.equal(g.recomputeAll(), 5);
  assert.equal(g.dirtyCount, 0);
  // No changes -> nothing recomputed.
  assert.equal(g.updateWorldTransforms(), 0);
  // Dirty a leaf: only it recomputes.
  g.setLocalTransform('grand', { position: [1, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.equal(g.updateWorldTransforms(), 1);
  assert.deepEqual(g.getWorldTransform('grand').position, [11, 2, 0]);
  // Dirty 'child': child + grand recompute, sibling subtree skipped.
  g.setLocalTransform('child', { position: [0, 5, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.equal(g.updateWorldTransforms(), 2);
  assert.deepEqual(g.getWorldTransform('child').position, [10, 5, 0]);
  assert.deepEqual(g.getWorldTransform('grand').position, [11, 5, 0]);
});

test('add/remove/reparent maintain links and dirtiness', () => {
  const g = new SceneGraph([node('a'), node('b')]);
  g.recomputeAll();
  g.addNode('a', node('c', [], { transform: { position: [1, 0, 0], rotationQuat: [0, 0, 0, 1], scale: [1, 1, 1] } }));
  assert.equal(g.parentIdOf('c'), 'a');
  assert.throws(() => g.addNode('a', node('c')), /duplicate/);
  g.reparent('c', 'b');
  assert.equal(g.parentIdOf('c'), 'b');
  assert.equal(g.find('a').children.length, 0);
  assert.equal(g.find('b').children.length, 1);
  assert.throws(() => g.reparent('b', 'c'), /cycle/);
  g.updateWorldTransforms();
  const removed = g.removeNode('b');
  assert.equal(removed.id, 'b');
  assert.equal(g.size, 1);
  assert.equal(g.find('c'), undefined);
  assert.equal(g.removeNode('missing'), undefined);
});

test('serialize/deserialize round-trips and detaches', () => {
  const { root } = buildTree();
  const g = new SceneGraph([root]);
  const json = g.serialize();
  const g2 = SceneGraph.deserialize(JSON.parse(JSON.stringify(json)));
  assert.equal(g2.size, 3);
  assert.deepEqual(g2.ids(), ['root', 'child', 'grand']);
  g2.find('child').transform.position = [99, 0, 0];
  assert.notDeepEqual(g.find('child').transform.position, [99, 0, 0]);
});
