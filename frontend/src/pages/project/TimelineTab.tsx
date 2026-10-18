import { onHostEvent } from '../../lib/host';
import { Fragment, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { TimelineCursor, TimelineEvent, TimelineTagMatch } from '@open-brain/shared';
import { listProjectTimeline, listSessionTimeline } from '../../lib/api';
import { Icons } from '../../components/Icons';

const actionLabels: Record<TimelineEvent['action'], string> = {
  uploaded: 'Uploaded', created: 'Created', edited: 'Edited', archived: 'Archived', restored: 'Restored', deleted: 'Deleted',
};
const fieldLabels: Record<string, string> = {
  content: 'text', project_ids: 'projects', project_id: 'project', source_url: 'source URL', blob_url: 'file',
  parent_id: 'parent task', due_date: 'due date', pinned_at: 'pin',
};

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = [];
  let start = 0;
  let found = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  while (found !== -1) {
    parts.push(<Fragment key={start}>{text.slice(start, found)}<mark>{text.slice(found, found + query.length)}</mark></Fragment>);
    start = found + query.length;
    found = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(), start);
  }
  return <>{parts}{text.slice(start)}</>;
}

function TagFilter({ available, selected, tagMatch, onChange }: { available: string[] | null; selected: string[]; tagMatch: TimelineTagMatch; onChange: (tags: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!event.composedPath().includes(root.current!)) setOpen(false); };
    const stopDown = onHostEvent('mousedown', closeOutside);
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => stopDown();
  }, [open]);
  return <div className="timeline-tag-filter" ref={root} onBlur={event => {
    // Safari pointer clicks on buttons can blur a checkbox without assigning
    // a new focused element. The outside-mousedown handler covers that case.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); }
  }}>
    <button ref={button} type="button" className="btn" aria-label="Filter by tags" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}><Icons.Tag />{selected.length ? `Tags · ${selected.length}` : 'All tags'}<span aria-hidden="true">⌄</span></button>
    {open && <div id={id} className="timeline-tag-menu" role="group" aria-label="Filter timeline tags">
      <div className="timeline-tag-menu-heading"><span>{tagMatch === 'all' ? 'Match all selected tags' : 'Match any selected tag'}</span><button type="button" className="btn btn-sm" disabled={!selected.length} onClick={() => onChange([])}>Clear tags</button></div>
      {available === null ? <p role="status">Loading tags…</p> : available.length ? <div className="timeline-tag-options">{available.map(tag => <label key={tag}>
        <input type="checkbox" checked={selected.includes(tag)} onChange={event => onChange(event.target.checked ? [...selected, tag].sort() : selected.filter(value => value !== tag))} />
        <span>#{tag}</span>
      </label>)}</div> : <p>No tags in this timeline yet.</p>}
    </div>}
  </div>;
}

function TimelineResults({ projectId, sessionId, search, tags, tagMatch, onAvailableTags }: { projectId?: string; sessionId?: string; search: string; tags: string[]; tagMatch: TimelineTagMatch; onAvailableTags: (tags: string[]) => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ first: 0, last: 0 });
  const scroll = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLLIElement>(null);
  const timeline = useInfiniteQuery({
    queryKey: [sessionId?'session-timeline':'project-timeline', sessionId??projectId, tags, tagMatch],
    initialPageParam: null as TimelineCursor | null,
    queryFn: ({ pageParam, signal }) => sessionId ? listSessionTimeline(sessionId, '', pageParam, signal, tags, tagMatch) : listProjectTimeline(projectId!, '', pageParam, signal, tags, tagMatch),
    getNextPageParam: page => page.next_cursor,
    staleTime: 0,
  });
  const events = useMemo(() => timeline.data?.pages.flatMap(page => page.events) ?? [], [timeline.data]);
  const matches = useInfiniteQuery({
    queryKey: ['timeline-matches', sessionId??projectId, search, tags, tagMatch],
    initialPageParam: null as TimelineCursor | null,
    queryFn: ({ pageParam, signal }) => sessionId ? listSessionTimeline(sessionId, search, pageParam, signal, tags, tagMatch) : listProjectTimeline(projectId!, search, pageParam, signal, tags, tagMatch),
    getNextPageParam: page => page.next_cursor,
    enabled: Boolean(search),
    staleTime: 0,
  });
  const matchingEvents = useMemo(() => matches.data?.pages.flatMap(page => page.events) ?? [], [matches.data]);
  const currentId = search ? matchingEvents[activeIndex]?.id : undefined;
  const total = search ? matches.data?.pages[0]?.total ?? 0 : timeline.data?.pages[0]?.total ?? 0;
  const timelineTotal = timeline.data?.pages[0]?.total ?? 0;
  useEffect(() => {
    if (timeline.data) onAvailableTags(timeline.data.pages[0].available_tags);
  }, [timeline.data, onAvailableTags]);
  const updatePosition = useCallback(() => {
    const container = scroll.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const visible = [...container.querySelectorAll<HTMLElement>('[data-event-id]')].flatMap((element, index) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom ? [index + 1] : [];
    });
    const first = visible[0] ?? 0, last = visible.at(-1) ?? 0;
    setPosition(previous => previous.first === first && previous.last === last ? previous : { first, last });
  }, []);
  useEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [events, updatePosition]);

  useEffect(() => {
    if (!search || !currentId) return;
    if (!events.some(event => event.id === currentId)) {
      if (timeline.hasNextPage && !timeline.isFetchingNextPage && !timeline.isFetchNextPageError) void timeline.fetchNextPage();
      return;
    }
    if (!active.current || !scroll.current) return;
    const item = active.current;
    const container = scroll.current;
    const top = container.scrollTop + item.getBoundingClientRect().top - container.getBoundingClientRect().top
      - (container.clientHeight - item.clientHeight) / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [currentId, events, search, timeline.hasNextPage, timeline.isFetchingNextPage, timeline.isFetchNextPageError, timeline.fetchNextPage]);

  async function nextMatch() {
    if (activeIndex + 1 >= total) return;
    if (activeIndex + 1 >= matchingEvents.length) {
      const result = await matches.fetchNextPage();
      if (result.isError) return;
    }
    setActiveIndex(index => index + 1);
  }

  return <>
    <div className="timeline-status">
      <span role="status" aria-live="polite">{timeline.isPending ? 'Loading timeline…' : search ? matches.isPending ? 'Finding matches…' : total ? `Match ${activeIndex + 1} of ${total}` : 'No matching events' : `${total} events · newest first`}</span>
      <div className="row-flex gap-2">
        {search && <>
          <button type="button" className="btn btn-sm" aria-label="Previous match" disabled={activeIndex === 0} onClick={() => setActiveIndex(index => index - 1)}>Previous</button>
          <button type="button" className="btn btn-sm" aria-label="Next match" disabled={activeIndex + 1 >= total || matches.isFetchingNextPage} onClick={() => void nextMatch()}>Next</button>
        </>}
        <button type="button" className="btn btn-sm" disabled={timeline.isFetching} onClick={() => { setActiveIndex(0); void timeline.refetch(); if (search) void matches.refetch(); }}>Refresh</button>
      </div>
    </div>
    {search && matches.isError && <p role="alert">Search failed. <button className="btn btn-sm" onClick={() => matches.refetch()}>Retry search</button></p>}
    <div className="timeline-window">
    <div ref={scroll} className="timeline-scroll" role="region" aria-label={sessionId?'Session timeline':'Project timeline'} tabIndex={0} onScroll={updatePosition}>
      {timeline.isPending ? <p className="timeline-empty">Loading events…</p> : timeline.isError && !events.length ? <div role="alert" className="timeline-empty"><p>Couldn’t load the timeline.</p><button className="btn" onClick={() => timeline.refetch()}>Try again</button></div> : !events.length ? <p className="timeline-empty">{tags.length ? 'No events match these tags. Clear the tag filter to see all events.' : 'No events yet. Upload a document or add a note or task to start this timeline.'}</p> : <ol className="timeline-list">
        {events.map((event, index) => {
          const date = new Date(event.occurred_at);
          const day = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
          const previousDay = index ? new Date(events[index - 1].occurred_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;
          const current = event.id === currentId;
          const action = event.reconstructed && event.action === 'edited' ? 'Last known update' : actionLabels[event.action];
          return <li key={event.id} ref={current ? active : undefined} className={`timeline-event${current ? ' current' : ''}`} aria-current={current ? 'true' : undefined} data-event-id={event.id}>
            {day !== previousDay && <h3 className="timeline-day">{day}</h3>}
            <article className="timeline-card">
              <div className="timeline-event-head"><span className={`timeline-action ${event.action}`}><Highlight text={action} query={search} /></span>
                <time dateTime={event.occurred_at} title={date.toLocaleString()}>{date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time></div>
              <h4><Highlight text={event.title} query={search} /></h4>
              <p className="page-subtle"><Highlight text={event.entity_type === 'todo_comment' ? 'Task comment' : event.entity_type} query={search} />
                {!sessionId && <> · <span className="timeline-origin"><Highlight text={event.session_id ? `Session: ${event.session_name ?? 'Untitled session'}` : 'Project-level'} query={search} /></span></>}
                {event.changed_fields.length > 0 && <> · <Highlight text={`Changed ${event.changed_fields.map(field => fieldLabels[field] ?? field).join(', ')}`} query={search} /></>}
                {event.reconstructed && <> · <Highlight text="Existing history" query={search} /></>}
              </p>
              {event.tags.length > 0 && <ul className="timeline-event-tags" aria-label="Artifact tags">{event.tags.map(tag => <li key={tag}>#<Highlight text={tag} query={search} /></li>)}</ul>}
            </article>
          </li>;
        })}
      </ol>}
      {timeline.isFetchNextPageError && <p role="alert">Older events could not be loaded. Try again below.</p>}
      {timeline.hasNextPage && <button type="button" className="btn timeline-more" disabled={timeline.isFetchingNextPage} onClick={() => void timeline.fetchNextPage()}>{timeline.isFetchingNextPage ? 'Loading…' : 'Load older events'}</button>}
    </div>
    {timelineTotal > 0 && <div className="timeline-position" role="meter" aria-label="Timeline position" aria-valuemin={1} aria-valuemax={timelineTotal} aria-valuenow={position.first || 1}
      aria-valuetext={position.first ? `Events ${position.first}–${position.last} of ${timelineTotal}` : `${timelineTotal} events`}>
      <span className="timeline-position-thumb" style={{ top: `min(${(Math.max(1, position.first) - 1) / timelineTotal * 100}%, calc(100% - 12px))`, height: `${Math.max(1, position.last - position.first + 1) / timelineTotal * 100}%` }} />
    </div>}
    </div>
    <p className="timeline-position-label">{timelineTotal > 0 ? <>{position.first ? `${position.first}–${position.last} of ${timelineTotal}` : `${timelineTotal} events`}<span>Newest first</span></> : '\u00a0'}</p>
  </>;
}

export function TimelineTab({ projectId, sessionId }: { projectId?: string; sessionId?: string }) {
  const [search, setSearch] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<TimelineTagMatch>('all');
  const [availableTags, setAvailableTags] = useState<string[] | null>(null);
  const query = useDeferredValue(search.trim());
  return <section className="project-timeline" aria-label="Timeline">
    <div className="timeline-heading"><div><h2>{sessionId?'Session timeline':'Project timeline'}</h2><p className="page-subtle">{sessionId ? 'Uploads, edits, and deletions, in order.' : 'Activity from this project and all its sessions. Tags with the same name share one filter.'} Older history includes creation and the last known update only.</p></div></div>
    <div className="timeline-controls"><div className="timeline-search"><Icons.Search /><input aria-label="Search timeline" placeholder="Search this timeline…" value={search} onChange={event => setSearch(event.target.value)} />
      {search && <button type="button" className="btn btn-sm" aria-label="Clear timeline search" onClick={() => setSearch('')}>Clear</button>}
    </div><div className="home-tag-filter-mode timeline-tag-mode" role="group" aria-label="Match selected tags">
      <button type="button" className={`home-tag-filter-mode-btn${tagMatch === 'all' ? ' active' : ''}`} aria-pressed={tagMatch === 'all'} title="Match every selected tag" onClick={() => setTagMatch('all')}>AND</button>
      <button type="button" className={`home-tag-filter-mode-btn${tagMatch === 'any' ? ' active' : ''}`} aria-pressed={tagMatch === 'any'} title="Match any selected tag" onClick={() => setTagMatch('any')}>OR</button>
    </div><TagFilter available={availableTags} selected={tags} tagMatch={tagMatch} onChange={setTags} /></div>
    <TimelineResults key={`${sessionId??projectId}:${query}:${JSON.stringify(tags)}:${tagMatch}`} projectId={projectId} sessionId={sessionId} search={query} tags={tags} tagMatch={tagMatch} onAvailableTags={setAvailableTags} />
  </section>;
}
