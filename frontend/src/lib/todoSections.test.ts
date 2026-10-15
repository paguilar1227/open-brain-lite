// @vitest-environment node
// Sectioning for the Todos view: top-level todos bucket by `section`; subtasks
// follow their parent; completed top-levels collapse into the Done bucket.
import { describe, it, expect } from 'vitest';
import { groupTodosBySection } from './todoSections';
import type { Todo } from '../types';

let seq = 0;
function todo(p: Partial<Todo>): Todo {
  seq += 1;
  return {
    id: p.id ?? `t${seq}`,
    title: p.title ?? `todo ${seq}`,
    status: p.status ?? 'not_started',
    priority: p.priority ?? 'p3',
    parent_id: p.parent_id ?? null,
    project_id: null,
    section: p.section ?? null,
    tags: p.tags ?? [],
    pinned: false,
    due_at: null,
    created_at: `2026-01-0${(seq % 9) + 1}T00:00:00.000Z`,
    comments: 0,
    manual_order: p.manual_order ?? null,
  };
}

describe('groupTodosBySection', () => {
  it('buckets top-level todos by section, alpha order, Ungrouped last', () => {
    const todos = [
      todo({ id: 'a', section: 'Work' }),
      todo({ id: 'b', section: null }),
      todo({ id: 'c', section: 'Home' }),
    ];
    const { sections } = groupTodosBySection(todos, { mode: 'manual' });
    expect(sections.map((s) => s.name)).toEqual(['Home', 'Work', null]);
    expect(sections.find((s) => s.name === 'Work')!.topIds).toEqual(['a']);
  });

  it('pulls completed top-levels into the Done bucket, out of their section', () => {
    const todos = [
      todo({ id: 'open', section: 'Work', status: 'not_started' }),
      todo({ id: 'done', section: 'Work', status: 'done' }),
    ];
    const { sections, done } = groupTodosBySection(todos, { mode: 'manual' });
    const work = sections.find((s) => s.name === 'Work')!;
    expect(work.topIds).toEqual(['open']);
    expect(done.map((r) => r.todo.id)).toEqual(['done']);
  });

  it('keeps subtasks with their parent (never sectioned independently)', () => {
    const todos = [
      todo({ id: 'parent', section: 'Work' }),
      todo({ id: 'child', parent_id: 'parent' }),
    ];
    const { sections } = groupTodosBySection(todos, { mode: 'manual' });
    const work = sections.find((s) => s.name === 'Work')!;
    expect(work.topIds).toEqual(['parent']); // only the parent is a sortable unit
    expect(work.rows.map((r) => r.todo.id)).toEqual(['parent', 'child']); // child nested in
  });

  it('keeps an empty extra section visible so todos can be dropped into it', () => {
    const todos = [todo({ id: 'a', section: null })];
    const { sections } = groupTodosBySection(todos, { mode: 'manual', extraSections: ['Later'] });
    expect(sections.map((s) => s.name)).toContain('Later');
    expect(sections.find((s) => s.name === 'Later')!.topIds).toEqual([]);
  });
});
